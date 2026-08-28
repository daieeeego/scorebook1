/* ------------------------------------------------------------------
   ルールエンジン（純粋関数のみ）
   盤面は保存せず、イベント列を畳み込んで導出する
------------------------------------------------------------------ */

export const POS = { 1: "投", 2: "捕", 3: "一", 4: "二", 5: "三", 6: "遊", 7: "左", 8: "中", 9: "右" };
export const BASE = ["一塁", "二塁", "三塁", "本塁"];

export const HOLD_PRESETS = [
  "守備が混乱した",
  "走者がどこまで行ったか不明",
  "審判の判定が不明",
  "打球の落下点が見えず",
  "映像で確認する",
];

export const RUNNER_REASONS = [
  { label: "盗塁", out: false },
  { label: "暴投", out: false },
  { label: "捕逸", out: false },
  { label: "けん制の悪送球", out: false },
  { label: "盗塁失敗", out: true },
  { label: "けん制でアウト", out: true },
];

/* 学童では打球位置と結果の対応が一般論どおりにならないため、
   ゾーンによって選択肢を出し分けない。全ゾーンで同じ配置に固定し、
   記録者が位置で覚えられるようにする。
   k = 記録上の名称 / l = 画面表示（野球用語を使わない） */
export const RESULT_GROUPS = [
  {
    label: "出塁", tone: "ghost",
    items: [
      { k: "安打", l: "ヒット" },
      { k: "二塁打", l: "二塁まで" },
      { k: "三塁打", l: "三塁まで" },
      { k: "本塁打", l: "ホームラン" },
      { k: "失策で出塁", l: "守備のミスで出塁" },
    ],
  },
  {
    label: "アウト", tone: "ghost",
    items: [
      { k: "ゴロアウト", l: "ゴロでアウト" },
      { k: "フライアウト", l: "フライでアウト" },
      { k: "ライナーアウト", l: "ライナーでアウト" },
    ],
  },
  {
    label: "その他", tone: "warn",
    items: [
      { k: "野手選択", l: "走者がアウト・打者は一塁へ" },
      { k: "保留", l: "あとで決める" },
    ],
  },
];

export const initialState = (setup) => ({
  inning: 1,
  isTop: true,
  outs: 0,
  bases: [null, null, null],
  balls: 0,
  strikes: 0,
  order: { away: 0, home: 0 },
  score: { away: 0, home: 0 },
  pitches: { away: 0, home: 0 },
  log: [],
  setup,
});

const cl = (s) => ({
  ...s,
  bases: [...s.bases],
  order: { ...s.order },
  score: { ...s.score },
  pitches: { ...s.pitches },
  log: [...s.log],
});

export const batKey = (s) => (s.isTop ? "away" : "home");
export const fieldKey = (s) => (s.isTop ? "home" : "away");
export const batterNum = (s) => s.setup.lineup[batKey(s)][s.order[batKey(s)]];
export const batterOrder = (s) => s.order[batKey(s)] + 1;

function nextBatter(s) {
  const k = batKey(s);
  s.order[k] = (s.order[k] + 1) % 9;
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

export function applyEvent(prev, e) {
  const s = cl(prev);
  const num = batterNum(s);
  const ord = batterOrder(s);
  const tag = `${s.inning}回${s.isTop ? "表" : "裏"} ${ord}番 #${num}`;

  if (e.t === "pitch") {
    s.pitches[fieldKey(s)] += 1;
    if (e.r === "ボール") {
      s.balls += 1;
      if (s.balls >= 4) {
        forcePush(s, num);
        s.log.push(`${tag} 四球`);
        nextBatter(s);
      }
      return s;
    }
    if (e.r === "ストライク") {
      s.strikes += 1;
      if (s.strikes >= 3) {
        s.outs += 1;
        s.log.push(`${tag} 三振`);
        nextBatter(s);
        if (s.outs >= 3) endHalf(s);
      }
      return s;
    }
    if (s.strikes < 2) s.strikes += 1;
    return s;
  }

  if (e.t === "runner") {
    const runner = s.bases[e.from];
    if (runner == null) return s;
    const rtag = `${s.inning}回${s.isTop ? "表" : "裏"} #${runner}`;
    s.bases[e.from] = null;
    if (e.out) {
      s.outs += 1;
      s.log.push(`${rtag} ${e.reason}`);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (e.from === 2) {
      s.score[batKey(s)] += 1;
      s.log.push(`${rtag} ${e.reason}で生還`);
    } else {
      s.bases[e.from + 1] = runner;
      s.log.push(`${rtag} ${e.reason}（${BASE[e.from]}→${BASE[e.from + 1]}）`);
    }
    return s;
  }

  if (e.t === "inplay") {
    s.pitches[fieldKey(s)] += 1;
    const z = e.zone;
    const r = e.result;
    const where = POS[z];

    if (r === "本塁打") {
      advanceAll(s, 4);
      s.score[batKey(s)] += 1;
      s.log.push(`${tag} 本塁打（${where}方向）`);
      nextBatter(s);
      return s;
    }
    if (r === "安打" || r === "失策で出塁") {
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
      s.log.push(`${tag} ${r}（${where}）${note}`);
      nextBatter(s);
      return s;
    }
    if (r === "二塁打" || r === "三塁打") {
      const n = r === "二塁打" ? 2 : 3;
      advanceAll(s, n);
      s.bases[n - 1] = num;
      s.log.push(`${tag} ${r}（${where}）`);
      nextBatter(s);
      return s;
    }
    if (r === "野手選択") {
      s.outs += 1;
      const lead = s.bases[0] != null ? 0 : s.bases[1] != null ? 1 : s.bases[2] != null ? 2 : -1;
      if (lead >= 0) s.bases[lead] = null;
      s.bases[0] = num;
      s.log.push(`${tag} 野手選択（${where}）`);
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "ゴロアウト" || r === "フライアウト" || r === "ライナーアウト") {
      if (e.answer === "併殺") {
        s.outs += 2;
        s.bases[0] = null;
        s.log.push(`${tag} 併殺打（${where}）`);
      } else if (e.answer === "二塁でアウト") {
        s.outs += 1;
        s.bases[0] = num;
        s.log.push(`${tag} 野手選択（${where}）`);
      } else if (e.answer === "二塁へ進んだ") {
        s.outs += 1;
        advanceAll(s, 1);
        s.log.push(`${tag} ${r}（${where}）走者進塁`);
      } else {
        s.outs += 1;
        s.log.push(`${tag} ${r}（${where}）`);
      }
      nextBatter(s);
      if (s.outs >= 3) endHalf(s);
      return s;
    }
    if (r === "保留") {
      s.bases[0] = num;
      s.log.push(`${tag} ⚠ 保留（${where}）${e.note ? " — " + e.note : ""}`);
      nextBatter(s);
      return s;
    }
  }
  return s;
}

export const deriveState = (events, setup) => events.reduce(applyEvent, initialState(setup));

/* 質問層: 複数の解釈があり得る場合だけ利用者に問う */
export function questionFor(state, zone, result) {
  if (result === "ゴロアウト" && state.bases[0] != null && state.outs < 2) {
    return {
      text: "一塁にいた走者はどうなりましたか",
      options: ["二塁でアウト", "併殺", "二塁へ進んだ", "一塁に留まった"],
    };
  }
  if ((result === "安打" || result === "失策で出塁") && state.bases[1] != null) {
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
