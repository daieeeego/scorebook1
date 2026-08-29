/* ------------------------------------------------------------------
   ルールエンジン（純粋関数のみ）
   盤面は保存せず、イベント列を畳み込んで導出する

   要件定義 v0.2 §6.1 / §6.3 に対応。
   選手交代を入れるため lineup を背番号の配列から
   LineupSlot { order, entries[] } へ拡張している。
------------------------------------------------------------------ */

export const POS = { 1: "投", 2: "捕", 3: "一", 4: "二", 5: "三", 6: "遊", 7: "左", 8: "中", 9: "右" };
export const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const BASE = ["一塁", "二塁", "三塁", "本塁"];
export const SIDES = ["away", "home"];

export const HOLD_PRESETS = [
  "守備が混乱した",
  "走者がどこまで行ったか不明",
  "審判の判定が不明",
  "打球の落下点が見えず",
  "映像で確認する",
];

/* 投球結果。k = 保存する名称 / l = 画面表示（記法規約 §2 の語）
   見逃しと空振りを分けるのは、三振を K（見逃し三振）と SO（空振り三振）に
   書き分けるために最後の投球の種別が要るため（記法規約 §5） */
export const PITCH_OPTIONS = [
  { k: "ボール", l: "ボール" },
  { k: "見逃し", l: "見逃しストライク" },
  { k: "空振り", l: "空振り" },
  { k: "ファール", l: "ファール" },
];

const isStrike = (r) => r === "見逃し" || r === "空振り" || r === "ストライク";
const isFoul = (r) => r === "ファール" || r === "ファウル";

/* k = 保存する名称 / l = 画面表示（記法規約 §7 の語） */
export const RUNNER_REASONS = [
  { k: "盗塁", l: "盗塁", out: false },
  { k: "暴投", l: "ワイルドピッチ", out: false },
  { k: "捕逸", l: "パスボール", out: false },
  { k: "けん制の悪送球", l: "けん制の悪送球", out: false },
  { k: "盗塁失敗", l: "盗塁アウト", out: true },
  { k: "けん制でアウト", l: "けん制でタッチアウト", out: true },
];

/* 学童では打球位置と結果の対応が一般論どおりにならないため、
   ゾーンによって選択肢を出し分けない。全ゾーンで同じ配置に固定し、
   記録者が位置で覚えられるようにする（§12.2）。
   k = 記録上の名称 / l = 画面表示（野球用語を使わない §12.3） */
export const RESULT_GROUPS = [
  {
    label: "出塁", tone: "ghost",
    items: [
      { k: "安打", l: "ヒット" },
      { k: "二塁打", l: "ツーベース" },
      { k: "三塁打", l: "スリーベース" },
      { k: "本塁打", l: "ホームラン" },
      { k: "失策で出塁", l: "エラー" },
    ],
  },
  {
    label: "アウト", tone: "ghost",
    items: [
      { k: "ゴロアウト", l: "ゴロ" },
      { k: "フライアウト", l: "フライ" },
      { k: "ライナーアウト", l: "ライナー" },
    ],
  },
  {
    label: "その他", tone: "warn",
    items: [
      { k: "野手選択", l: "フィルダースチョイス" },
    ],
  },
];

/* 「詳細」の先に置く選択肢。記法規約 §5／§6 のうち、
   よく出る10種（RESULT_GROUPS）に入っていないもの。
   頻度が低いものを1階層下げ、よく出るプレーのタップ数を増やさない */
export const DETAIL_GROUPS = [
  {
    label: "出塁", tone: "ghost",
    items: [
      { k: "死球", l: "死球" },
      { k: "敬遠四球", l: "敬遠四球" },
      { k: "振り逃げ", l: "振り逃げ" },
      { k: "バントヒット", l: "バントヒット" },
      { k: "テキサスヒット", l: "テキサスヒット" },
      { k: "ランニングホームラン", l: "ランニングホームラン" },
      { k: "打撃妨害", l: "打撃妨害" },
      { k: "走塁妨害", l: "走塁妨害" },
    ],
  },
  {
    label: "エラーの種類", tone: "ghost",
    items: [
      { k: "ゴロエラー", l: "ゴロエラー" },
      { k: "フライエラー", l: "フライエラー（落球）" },
      { k: "悪送球（高投）", l: "悪送球（高投）" },
      { k: "悪送球（低投）", l: "悪送球（低投）" },
    ],
  },
  {
    label: "アウト", tone: "ghost",
    items: [
      { k: "犠牲フライ", l: "犠牲フライ" },
      { k: "犠牲バント", l: "犠牲バント" },
      { k: "ファールフライ", l: "ファールフライ" },
      { k: "インフィールドフライ", l: "インフィールドフライ" },
      { k: "3バント失敗", l: "3バント失敗" },
      { k: "トリプルプレー", l: "トリプルプレー" },
    ],
  },
  {
    label: "その他", tone: "warn",
    items: [
      { k: "保留", l: "あとで決める" },
    ],
  },
];

export const DETAIL_KEYS = new Set(DETAIL_GROUPS.flatMap((g) => g.items.map((i) => i.k)));

/* 盤面への効き方が同じものをまとめる。記号は違っても導出は共通 */
const HR_LIKE = new Set(["本塁打", "ランニングホームラン"]);
const HIT_LIKE = new Set(["安打", "バントヒット", "テキサスヒット"]);
const ERROR_LIKE = new Set(["失策で出塁", "ゴロエラー", "フライエラー", "悪送球（高投）", "悪送球（低投）"]);
/* 打者が一塁を与えられ、詰まっている走者だけが押し出される */
const PUSH_LIKE = new Set(["死球", "敬遠四球", "打撃妨害", "走塁妨害", "振り逃げ"]);
/* 打者だけがアウトになり、走者は動かない */
const BATTER_OUT_ONLY = new Set(["ファールフライ", "インフィールドフライ", "3バント失敗"]);
/* 打球ではないため、打球方向を記録しない */
const NO_ZONE = new Set(["死球", "敬遠四球", "打撃妨害", "走塁妨害", "振り逃げ", "3バント失敗"]);

export const isHitLike = (r) => HIT_LIKE.has(r);
export const isErrorLike = (r) => ERROR_LIKE.has(r);
export const needsZone = (r) => !NO_ZONE.has(r);

/* 保留の確定で選べる結果。「保留」自体は選べない */
export const RESOLVABLE = [...RESULT_GROUPS, ...DETAIL_GROUPS]
  .map((g) => ({ ...g, items: g.items.filter((i) => i.k !== "保留") }))
  .filter((g) => g.items.length);

/* ---------------- 選手の識別 ----------------
   氏名を登録しない運用（§12 / FR-14）のため、
   背番号がそのままチーム内の識別子になる */

export const pid = (side, uniformNumber) => `${side}#${String(uniformNumber).trim()}`;
export const uniformOf = (playerId) => (playerId ? playerId.split("#")[1] : "");
export const sideOf = (playerId) => (playerId ? playerId.split("#")[0] : null);

/* ---------------- 打順の参照 ---------------- */

/** その枠でいま出場している選手。退いた選手は exitedAtSeq が入る */
export const activeEntry = (slot) => {
  for (let i = slot.entries.length - 1; i >= 0; i--) {
    if (slot.entries[i].exitedAtSeq == null) return slot.entries[i];
  }
  return null;
};

export const activeEntries = (s, side) =>
  s.lineup[side].map(activeEntry).filter(Boolean);

export const batKey = (s) => (s.isTop ? "away" : "home");
export const fieldKey = (s) => (s.isTop ? "home" : "away");
export const batterOrder = (s) => s.order[batKey(s)] + 1;

export const batterEntry = (s) => activeEntry(s.lineup[batKey(s)][s.order[batKey(s)]]);
export const batterId = (s) => (batterEntry(s) ? batterEntry(s).playerId : null);
export const batterNum = (s) => uniformOf(batterId(s));

/** 守備位置1についている選手。投球数はこの単位で数える（FR-19） */
export const pitcherIdOf = (s, side) => {
  const e = activeEntries(s, side).find((x) => x.position === 1);
  return e ? e.playerId : null;
};
export const pitcherId = (s) => pitcherIdOf(s, fieldKey(s));

export const halfKey = (inning, isTop) => `${inning}${isTop ? "表" : "裏"}`;

/* ---------------- 初期状態 ---------------- */

const cloneLineup = (slots) =>
  slots.map((sl) => ({ order: sl.order, entries: sl.entries.map((e) => ({ ...e })) }));

export const initialState = (setup) => ({
  inning: 1,
  isTop: true,
  outs: 0,
  bases: [null, null, null],
  balls: 0,
  strikes: 0,
  order: { away: 0, home: 0 },
  score: { away: 0, home: 0 },
  lineup: { away: cloneLineup(setup.lineup.away), home: cloneLineup(setup.lineup.home) },
  pitchCount: {},          // playerId -> 投球数（FR-19）
  halves: {},              // playerId -> ["1表", ...]（FR-21）
  plateAppearances: {},
  log: [],
  seq: 0,
  setup,
});

const cl = (s) => ({
  ...s,
  bases: [...s.bases],
  order: { ...s.order },
  score: { ...s.score },
  lineup: { away: cloneLineup(s.lineup.away), home: cloneLineup(s.lineup.home) },
  pitchCount: { ...s.pitchCount },
  halves: { ...s.halves },
  plateAppearances: { ...s.plateAppearances },
  log: [...s.log],
});

/* ---------------- 内部ヘルパ ---------------- */

function push(s, text, opt = {}) {
  s.log.push({
    seq: s.seq,
    src: opt.src != null ? opt.src : null,   // 元イベントの位置（保留の確定に使う）
    inning: s.inning,
    isTop: s.isTop,
    text,
    kind: opt.kind || "play",                // "play" | "sub"
    pending: !!opt.pending,
  });
}

const tag = (s) => `${s.inning}回${s.isTop ? "表" : "裏"} ${batterOrder(s)}番 #${batterNum(s)}`;

function nextBatter(s) {
  const k = batKey(s);
  s.order[k] = (s.order[k] + 1) % s.lineup[k].length;
  s.balls = 0;
  s.strikes = 0;
}

function endHalf(s) {
  s.outs = 0;
  s.bases = [null, null, null];
  s.balls = 0;
  s.strikes = 0;
  if (s.isTop) s.isTop = false;
  else {
    s.isTop = true;
    s.inning += 1;
  }
}

/** FR-21: そのハーフイニングに出ていた選手を記録する */
function creditHalf(s) {
  const key = halfKey(s.inning, s.isTop);
  const ids = new Set();
  for (const e of activeEntries(s, fieldKey(s))) if (e.position != null) ids.add(e.playerId);
  const b = batterId(s);
  if (b) ids.add(b);
  for (const r of s.bases) if (r) ids.add(r);
  for (const id of ids) {
    const arr = s.halves[id] || [];
    if (!arr.includes(key)) s.halves[id] = [...arr, key];
  }
}

function countPitch(s) {
  const p = pitcherId(s);
  const key = p || `${fieldKey(s)}#投手未設定`;
  s.pitchCount[key] = (s.pitchCount[key] || 0) + 1;
}

function forcePush(s, batter) {
  const b = s.bases;
  if (b[0] == null) b[0] = batter;
  else if (b[1] == null) { b[1] = b[0]; b[0] = batter; }
  else if (b[2] == null) { b[2] = b[1]; b[1] = b[0]; b[0] = batter; }
  else { s.score[batKey(s)] += 1; b[2] = b[1]; b[1] = b[0]; b[0] = batter; }
}

function advanceAll(s, n) {
  for (let i = 2; i >= 0; i--) {
    if (s.bases[i] != null) {
      const to = i + n;
      const runner = s.bases[i];
      s.bases[i] = null;
      if (to >= 3) s.score[batKey(s)] += 1;
      else s.bases[to] = runner;
    }
  }
}

/* ---------------- 交代（FR-09 / FR-17） ---------------- */

/** 第1層: 不正な交代を作らせない。問題なければ null */
export function validateSub(s, sub) {
  if (sub.kind === "守備位置変更") {
    const used = new Map();
    for (const m of sub.moves) {
      if (m.position == null) continue;
      if (used.has(m.position)) return `${POS[m.position]} が重複しています`;
      used.set(m.position, m.order);
    }
    return null;
  }

  const slots = s.lineup[sub.side];
  if (!(sub.order >= 1 && sub.order <= slots.length)) return "打順が範囲外です";

  const num = String(sub.num == null ? "" : sub.num).trim();
  if (!num) return "背番号を入力してください";
  const incoming = pid(sub.side, num);

  const outgoing = activeEntry(slots[sub.order - 1]);
  if (outgoing && outgoing.playerId === incoming) return "同じ選手には交代できません";

  for (let i = 0; i < slots.length; i++) {
    if (i === sub.order - 1) continue;
    if (activeEntry(slots[i]) && activeEntry(slots[i]).playerId === incoming) {
      return `#${num} は${i + 1}番で出場中です`;
    }
  }

  /* 一度退いた選手は戻せない。リエントリーは Phase 2（FR-18）*/
  const retired = slots.some((sl) =>
    sl.entries.some((e) => e.playerId === incoming && e.exitedAtSeq != null));
  if (retired) return `#${num} は既に退いています`;

  if (sub.kind === "代走") {
    if (sub.base == null) return "どの塁の走者かを選んでください";
    if (s.bases[sub.base] == null) return `${BASE[sub.base]}に走者がいません`;
    if (outgoing && s.bases[sub.base] !== outgoing.playerId) {
      return "その走者は選んだ打順の選手ではありません";
    }
  }
  return null;
}

/** その枠の交代が文脈上どれになるかは、記録者に選ばせず導出する（§7.1 第2層） */
export function inferSubKind(s, side, order) {
  const e = activeEntry(s.lineup[side][order - 1]);
  if (!e) return { kind: "守備交代" };
  const base = s.bases.findIndex((b) => b === e.playerId);
  if (base >= 0) return { kind: "代走", base };
  if (batKey(s) === side && batterId(s) === e.playerId) return { kind: "代打" };
  return { kind: "守備交代" };
}

function applySub(s, sub) {
  if (sub.kind === "守備位置変更") {
    const slots = s.lineup[sub.side];
    const changed = [];
    for (const m of sub.moves) {
      const e = activeEntry(slots[m.order - 1]);
      if (!e || e.position === m.position) continue;
      e.position = m.position;
      changed.push(`#${uniformOf(e.playerId)}→${m.position == null ? "守備なし" : POS[m.position]}`);
    }
    if (changed.length) push(s, `${s.setup.teamName[sub.side]} 守備位置変更（${changed.join("、")}）`, { kind: "sub" });
    return;
  }

  const slot = s.lineup[sub.side][sub.order - 1];
  const outgoing = activeEntry(slot);
  if (outgoing) outgoing.exitedAtSeq = s.seq;

  const incoming = pid(sub.side, sub.num);
  slot.entries.push({
    playerId: incoming,
    position: sub.position == null ? null : sub.position,
    entryType: sub.kind,
    enteredAtSeq: s.seq,
    exitedAtSeq: null,
  });

  /* 同じ守備位置に既にいる選手は守備位置を外す。
     二人が同じポジションに立っている状態を残さないため */
  if (sub.position != null) {
    for (const other of activeEntries(s, sub.side)) {
      if (other.playerId !== incoming && other.position === sub.position) other.position = null;
    }
  }

  /* 代走は塁上の走者そのものを差し替える */
  if (sub.kind === "代走" && sub.base != null && s.bases[sub.base] != null) {
    s.bases[sub.base] = incoming;
  }

  const from = outgoing ? `#${uniformOf(outgoing.playerId)}` : "空き";
  const at = sub.position == null ? "" : `・${POS[sub.position]}`;
  push(s, `${s.setup.teamName[sub.side]} ${sub.order}番 ${from}→#${uniformOf(incoming)}（${sub.kind}${at}）`, { kind: "sub" });
}

/* ---------------- 畳み込み本体 ---------------- */

export function applyEvent(prev, e) {
  const s = cl(prev);
  s.seq = prev.seq + 1;

  if (e.t === "sub") {
    applySub(s, e);
    return s;
  }

  const src = e._src != null ? e._src : null;
  const num = batterId(s);
  const t = tag(s);

  if (e.t === "pitch") {
    creditHalf(s);
    countPitch(s);
    if (e.r === "ボール") {
      s.balls += 1;
      if (s.balls >= 4) {
        forcePush(s, num);
        s.plateAppearances[num] = (s.plateAppearances[num] || 0) + 1;
        push(s, `${t} 四球`, { src });
        nextBatter(s);
      }
      return s;
    }
    if (isStrike(e.r)) {
      s.strikes += 1;
      if (s.strikes >= 3) {
        s.outs += 1;
        s.plateAppearances[num] = (s.plateAppearances[num] || 0) + 1;
        /* 記法規約 §5: K = 見逃し三振 / SO = 空振り三振 */
        const kind = e.r === "見逃し" ? "K 見逃し三振"
          : e.r === "空振り" ? "SO 空振り三振"
          : "三振";
        push(s, `${t} ${kind}`, { src });
        nextBatter(s);
        if (s.outs >= 3) endHalf(s);
      }
      return s;
    }
    if (isFoul(e.r) && s.strikes < 2) s.strikes += 1;
    return s;
  }

  if (e.t === "runner") {
    creditHalf(s);
    const runner = s.bases[e.from];
    if (runner == null) return s;
    const rtag = `${s.inning}回${s.isTop ? "表" : "裏"} #${uniformOf(runner)}`;
    s.bases[e.from] = null;
    if (e.out) {
      s.outs += 1;
      push(s, `${rtag} ${e.reason}`, { src });
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (e.from === 2) {
      s.score[batKey(s)] += 1;
      push(s, `${rtag} ${e.reason}で生還`, { src });
    } else {
      s.bases[e.from + 1] = runner;
      push(s, `${rtag} ${e.reason}（${BASE[e.from]}→${BASE[e.from + 1]}）`, { src });
    }
    return s;
  }

  if (e.t === "inplay") {
    creditHalf(s);
    countPitch(s);
    s.plateAppearances[num] = (s.plateAppearances[num] || 0) + 1;
    const where = POS[e.zone];
    const r = e.result;
    const mark = e._resolved ? "（確定）" : "";

    /* --- 詳細（記法規約 §5／§6 の追加分） --- */

    if (PUSH_LIKE.has(r)) {
      forcePush(s, num);
      push(s, `${t} ${r}${mark}`, { src });
      nextBatter(s);
      return s;
    }
    if (BATTER_OUT_ONLY.has(r)) {
      s.outs += 1;
      push(s, `${t} ${r}${NO_ZONE.has(r) ? "" : `（${where}）`}${mark}`, { src });
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "犠牲フライ") {
      s.outs += 1;
      const third = s.bases[2];
      if (third != null) { s.score[batKey(s)] += 1; s.bases[2] = null; }
      push(s, `${t} 犠牲フライ（△${where}）${third != null ? " 三塁走者生還" : ""}${mark}`, { src });
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "犠牲バント") {
      s.outs += 1;
      advanceAll(s, 1);
      push(s, `${t} 犠牲バント（△${where}）${mark}`, { src });
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "トリプルプレー") {
      s.outs += 3;
      push(s, `${t} トリプルプレー（${where}）${mark}`, { src });
      nextBatter(s);
      endHalf(s);
      return s;
    }

    if (HR_LIKE.has(r)) {
      advanceAll(s, 4);
      s.score[batKey(s)] += 1;
      push(s, `${t} ${r}（${where}方向）${mark}`, { src });
      nextBatter(s);
      return s;
    }
    if (HIT_LIKE.has(r) || ERROR_LIKE.has(r)) {
      const bk = batKey(s);
      const [r1, r2, r3] = s.bases;
      s.bases = [null, null, null];
      if (r3 != null) s.score[bk] += 1;
      if (r2 != null) {
        if (e.answer === "本塁まで進んだ") s.score[bk] += 1;
        else if (e.answer === "二塁に留まった" && r1 == null) s.bases[1] = r2;
        else s.bases[2] = r2;
      }
      if (r1 != null) s.bases[1] = r1;
      s.bases[0] = num;
      const note = e.answer === "二塁に留まった" ? "（二塁走者は動かず）" : "";
      push(s, `${t} ${r}（${where}）${note}${mark}`, { src });
      nextBatter(s);
      return s;
    }
    if (r === "二塁打" || r === "三塁打") {
      const n = r === "二塁打" ? 2 : 3;
      advanceAll(s, n);
      s.bases[n - 1] = num;
      push(s, `${t} ${r}（${where}）${mark}`, { src });
      nextBatter(s);
      return s;
    }
    if (r === "野手選択") {
      s.outs += 1;
      const lead = s.bases[0] != null ? 0 : s.bases[1] != null ? 1 : s.bases[2] != null ? 2 : -1;
      if (lead >= 0) s.bases[lead] = null;
      s.bases[0] = num;
      push(s, `${t} 野手選択（${where}）${mark}`, { src });
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "ゴロアウト" || r === "フライアウト" || r === "ライナーアウト") {
      if (e.answer === "ダブルプレー" || e.answer === "併殺") {
        s.outs += 2;
        s.bases[0] = null;
        push(s, `${t} ダブルプレー（${where}）${mark}`, { src });
      } else if (e.answer === "フォースアウト（二塁）" || e.answer === "二塁でアウト") {
        s.outs += 1;
        s.bases[0] = num;
        push(s, `${t} 野手選択（${where}）${mark}`, { src });
      } else if (e.answer === "二塁へ進んだ") {
        s.outs += 1;
        advanceAll(s, 1);
        push(s, `${t} ${r}（${where}）走者進塁${mark}`, { src });
      } else {
        s.outs += 1;
        push(s, `${t} ${r}（${where}）${mark}`, { src });
      }
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "保留") {
      s.bases[0] = num;
      push(s, `${t} ⚠ 保留（${where}）${e.note ? " — " + e.note : ""}`, { src, pending: true });
      nextBatter(s);
      return s;
    }
  }
  return s;
}

/* ---------------- 保留の確定（FR-08） ----------------
   過去のイベントは書き換えない（§6.1）。確定は追記イベントとして持ち、
   畳み込みの前に「保留」を確定内容へ差し替えた列を作って再生する */

export function resolvedEvents(events) {
  const fix = new Map();
  events.forEach((e) => {
    if (e.t === "resolve" && e.target >= 0 && e.target < events.length) fix.set(e.target, e);
  });
  const out = [];
  events.forEach((e, i) => {
    if (e.t === "resolve") return;
    const r = fix.get(i);
    if (r) out.push({ ...e, result: r.result, answer: r.answer, _src: i, _resolved: true });
    else out.push({ ...e, _src: i });
  });
  return out;
}

export const deriveState = (events, setup) =>
  resolvedEvents(events).reduce(applyEvent, initialState(setup));

/** まだ確定していない保留プレー。src は元イベントの位置 */
export const pendingPlays = (state) => state.log.filter((l) => l.pending);

/* ---------------- 質問層（§7.1 第3層） ---------------- */

export function questionFor(state, zone, result) {
  if (result === "ゴロアウト" && state.bases[0] != null && state.outs < 2) {
    return {
      text: "一塁にいた走者はどうなりましたか",
      options: ["フォースアウト（二塁）", "ダブルプレー", "二塁へ進んだ", "一塁に留まった"],
    };
  }
  if ((HIT_LIKE.has(result) || ERROR_LIKE.has(result)) && state.bases[1] != null) {
    // 一塁にも走者がいる場合、二塁走者は押し出されるため「留まった」は選べない
    const forced = state.bases[0] != null;
    return {
      text: "二塁にいた走者はどこまで進みましたか",
      options: forced
        ? ["三塁で止まった", "本塁まで進んだ"]
        : ["二塁に留まった", "三塁で止まった", "本塁まで進んだ"],
    };
  }
  return null;
}

/** 保留を確定するときは、その打席の時点の盤面で質問し直す */
export function stateBefore(events, setup, index) {
  return resolvedEvents(events.slice(0, index)).reduce(applyEvent, initialState(setup));
}

/* ---------------- 集計（FR-19 / FR-21） ---------------- */

export function statsFrom(s) {
  const pitchers = Object.entries(s.pitchCount)
    .map(([playerId, pitches]) => ({
      playerId,
      side: sideOf(playerId),
      uniformNumber: uniformOf(playerId),
      pitches,
      halves: (s.halves[playerId] || []).length,
    }))
    .sort((a, b) => b.pitches - a.pitches);

  const players = { away: [], home: [] };
  for (const side of SIDES) {
    s.lineup[side].forEach((slot, i) => {
      slot.entries.forEach((e) => {
        players[side].push({
          playerId: e.playerId,
          uniformNumber: uniformOf(e.playerId),
          order: i + 1,
          position: e.position,
          entryType: e.entryType,
          active: e.exitedAtSeq == null,
          halves: (s.halves[e.playerId] || []).length,
          halfList: s.halves[e.playerId] || [],
          plateAppearances: s.plateAppearances[e.playerId] || 0,
        });
      });
    });
  }
  return { pitchers, players };
}

export const deriveStats = (events, setup) => statsFrom(deriveState(events, setup));

/* ---------------- 保存データの移行 ---------------- */

const isSlotShape = (d) =>
  d && d.setup && d.setup.lineup && Array.isArray(d.setup.lineup.away) &&
  typeof d.setup.lineup.away[0] === "object" && d.setup.lineup.away[0] !== null;

export const toSlots = (side, nums, positions) =>
  nums.map((n, i) => ({
    order: i + 1,
    entries: [{
      playerId: pid(side, n),
      position: positions && positions[i] != null ? positions[i] : null,
      entryType: "先発",
      enteredAtSeq: 0,
      exitedAtSeq: null,
    }],
  }));

/** 旧保存データ（背番号の配列）を現行の打順モデルへ変換する */
export function migrate(saved) {
  if (!saved || !saved.setup || !Array.isArray(saved.events)) return null;
  if (isSlotShape(saved)) return { ...saved, migrated: false };
  return {
    setup: {
      ...saved.setup,
      lineup: {
        away: toSlots("away", saved.setup.lineup.away),
        home: toSlots("home", saved.setup.lineup.home),
      },
    },
    events: saved.events,
    migrated: true,   // 守備位置を持たないため、投手の設定を促す
  };
}

/** 書き出し用に §6.2 の刻印を各イベントへ載せる */
export function stampEvents(events, setup) {
  const resolved = resolvedEvents(events);
  let s = initialState(setup);
  const out = [];
  resolved.forEach((e, i) => {
    out.push({
      ...e,
      seq: i + 1,
      inning: s.inning,
      isTop: s.isTop,
      battingTeam: batKey(s),
      batterId: e.t === "sub" ? null : batterId(s),
      pitcherId: e.t === "sub" ? null : pitcherId(s),
    });
    s = applyEvent(s, e);
  });
  return out;
}
