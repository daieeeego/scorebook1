import { useState, useEffect, useMemo, useRef } from "react";
import {
  POS, POSITIONS, BASE, SIDES, HOLD_PRESETS, PITCH_OPTIONS,
  GAPS, BATTED_KINDS, asksBatted, zoneName,
  RUNNER_REASONS, RUNNER_DETAIL, RUNNER_DETAIL_KEYS, CATCHER_FIRST,
  RESULT_GROUPS, DETAIL_GROUPS, DETAIL_KEYS, NO_BALL_GROUPS, NO_BALL_KEYS, RESOLVABLE,
  swapSides, ownSideOf, oppSideOf, HHMM, scoreSheet,
  deriveState, questionFor, runnerQuestionFor, stateBefore, statsFrom, migrate, toSlots,
  sheetSummary, inningsPitched, sideOf,
  defaultMoves, moveOptions, validateMoves, defaultFielders, fieldersNotation,
  batKey, batterNum, batterOrder, activeEntry, activeEntries,
  pitcherId, uniformOf, validateSub, inferSubKind, pid,
} from "./rules.js";

const C = {
  paper: "#E9ECF0", card: "#FFFFFF", ink: "#15273D", sub: "#5E6D80",
  line: "#C6CED8", red: "#BE3A2B", dim: "#98A4B2", field: "#DFE5DC",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SAVE_KEY = "scorebook.v1";

const defaultSetup = () => ({
  date: new Date().toISOString().slice(0, 10),
  venue: "",
  ownSide: "home",                                 // 自チームが先攻か後攻か
  teamName: { away: "相手チーム", home: "自チーム" },
  lineup: {
    away: toSlots("away", [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    home: toSlots("home", [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  },
});

/* ---------------- 保存 ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

function save(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* 容量超過等は無視 */ }
}

/* ---------------- 部品 ---------------- */

function Btn({ children, onClick, tone = "primary", disabled }) {
  const styles =
    tone === "primary" ? { background: C.ink, color: "#fff", border: `2px solid ${C.ink}` }
    : tone === "warn" ? { background: C.card, color: C.red, border: `2px solid ${C.red}` }
    : { background: C.card, color: C.ink, border: `2px solid ${C.line}` };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...styles, minHeight: 56, fontSize: 17, width: "100%", borderRadius: 8, fontWeight: 600, opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  );
}

function SmallBtn({ children, onClick, tone = "ghost" }) {
  const styles = tone === "warn"
    ? { color: C.red, borderColor: C.red }
    : { color: C.ink, borderColor: C.line };
  return (
    <button onClick={onClick}
      style={{ ...styles, background: C.card, border: "2px solid", minHeight: 44, padding: "0 12px", borderRadius: 8, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

const fieldStyle = { background: C.card, border: `2px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 16, color: C.ink, width: "100%" };

function PosSelect({ value, onChange }) {
  return (
    <select value={value == null ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      style={{ ...fieldStyle, padding: "8px 6px", minHeight: 44 }}>
      <option value="">守備 —</option>
      {POSITIONS.map((p) => <option key={p} value={p}>{p} {POS[p]}</option>)}
    </select>
  );
}

/* 打球1つに対する、1人ぶんの行き先。選ばれているものを反転表示する */
function MoveRow({ label, options, value, onPick }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, color: C.sub, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => {
          const on = o.to === value;
          const danger = o.to === -1;
          return (
            <button key={o.to} onClick={() => onPick(o.to)}
              style={{
                minHeight: 44, padding: "0 12px", borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: on ? (danger ? C.red : C.ink) : C.card,
                color: on ? "#fff" : (danger ? C.red : C.ink),
                border: `2px solid ${on ? (danger ? C.red : C.ink) : C.line}`,
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniDiamond({ bases }) {
  const on = (i) => (bases[i] != null ? C.red : "transparent");
  return (
    <svg viewBox="0 0 44 40" width="44" height="40">
      <path d="M22 34 L34 22 L22 10 L10 22 Z" stroke={C.line} strokeWidth="1.5" fill="none" />
      <rect x="30" y="18" width="8" height="8" transform="rotate(45 34 22)" fill={on(0)} stroke={C.ink} strokeWidth="1.2" />
      <rect x="18" y="6" width="8" height="8" transform="rotate(45 22 10)" fill={on(1)} stroke={C.ink} strokeWidth="1.2" />
      <rect x="6" y="18" width="8" height="8" transform="rotate(45 10 22)" fill={on(2)} stroke={C.ink} strokeWidth="1.2" />
    </svg>
  );
}

/* 呼び名をカタカナにしたため、1文字前提の円では収まらない。
   文字数に合わせた角丸で置き、どの2つもすき間が10px以上空くよう配置した。
   高さ40（実寸45.7px）で NFR-03 の44px以上を満たす */
const PICKER_FS = 13, PICKER_H = 40, PICKER_PAD = 20;
const FIELDERS = [
  { n: 1, x: 150, y: 152 }, { n: 2, x: 150, y: 220 }, { n: 3, x: 250, y: 146 },
  { n: 4, x: 204, y: 95 }, { n: 5, x: 50, y: 146 }, { n: 6, x: 96, y: 95 },
  { n: 7, x: 45, y: 46 }, { n: 8, x: 150, y: 28 }, { n: 9, x: 255, y: 46 },
];

/* 守備位置の間を抜けた打球（記法規約 §3 の `7.8`）。図の中に置くと
   どの2つも10px空ける配置が崩れるため、図の下に別の行として並べる */
function GapRow({ onPick }) {
  return (
    <div style={{ padding: "0 10px 10px" }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>守備の間を抜けた</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {GAPS.map((g) => (
          <button key={`${g.a}.${g.b}`} onClick={() => onPick(g.a, g.b)}
            style={{ background: C.paper, color: C.ink, border: `2px solid ${C.line}`,
              minHeight: 48, fontSize: 15, borderRadius: 8, fontWeight: 600 }}>
            {g.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldPicker({ onPick, gaps = true }) {
  return (
    <>
    <svg viewBox="0 0 300 250" style={{ width: "100%", maxHeight: 300 }}>
      <path d="M150 214 L300 64 L300 0 L0 0 L0 64 Z" fill={C.field} />
      <path d="M150 214 L60 124 L150 34 L240 124 Z" fill="none" stroke={C.line} strokeWidth="2" />
      <path d="M150 214 L20 84 M150 214 L280 84" stroke={C.line} strokeWidth="1.5" fill="none" />
      {FIELDERS.map((f) => {
        const w = POS[f.n].length * PICKER_FS + PICKER_PAD;
        return (
          <g key={f.n} onClick={() => onPick(f.n)} style={{ cursor: "pointer" }}>
            <rect x={f.x - w / 2} y={f.y - PICKER_H / 2} width={w} height={PICKER_H} rx="10"
              fill={C.card} stroke={C.ink} strokeWidth="1.6" />
            <text x={f.x} y={f.y + PICKER_FS / 2 + 1} textAnchor="middle"
              fontSize={PICKER_FS} fill={C.ink} fontWeight="600">{POS[f.n]}</text>
          </g>
        );
      })}
    </svg>
    {gaps && <GapRow onPick={onPick} />}
    </>
  );
}

/* ---------------- 試合設定 ---------------- */

function Setup({ initial, onStart, locked }) {
  const [s, setS] = useState(initial || defaultSetup());
  const [err, setErr] = useState("");

  const editSlot = (side, i, patch) => {
    const lineup = {
      ...s.lineup,
      [side]: s.lineup[side].map((slot, j) => {
        if (j !== i) return slot;
        const e = { ...slot.entries[0], ...patch };
        return { ...slot, entries: [e] };
      }),
    };
    setS({ ...s, lineup });
  };

  const start = () => {
    for (const side of locked ? [] : SIDES) {
      const entries = s.lineup[side].map((sl) => sl.entries[0]);
      if (entries.some((e) => !uniformOf(e.playerId))) {
        setErr(`${s.teamName[side]} に背番号の空欄があります`);
        return;
      }
      const nums = entries.map((e) => uniformOf(e.playerId));
      const dup = nums.find((n, i) => nums.indexOf(n) !== i);
      if (dup) { setErr(`${s.teamName[side]} に背番号 ${dup} が重複しています`); return; }
      if (!entries.some((e) => e.position === 1)) {
        setErr(`${s.teamName[side]} の投手が未設定です（投球数の集計に使います）`);
        return;
      }
      const pos = entries.map((e) => e.position).filter((p) => p != null);
      const dupPos = pos.find((p, i) => pos.indexOf(p) !== i);
      if (dupPos) { setErr(`${s.teamName[side]} で ${POS[dupPos]} が重複しています`); return; }
    }
    setErr("");
    onStart(s);
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{locked ? "試合情報" : "試合の設定"}</h1>
      <p style={{ fontSize: 13, color: C.sub, marginBottom: 16 }}>
        {locked
          ? "試合が始まっているため、打順は変更できません。"
          : "背番号と、投手だけ決めれば始められます。守備位置はあとから直せます。"}
      </p>

      {locked && (
        <div style={{ background: "#FDF3E7", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>
          選手を入れ替えるときは「選手交代」から行ってください。
          ここで打順を書き換えると、誰が誰に代わったかの履歴が残りません。
        </div>
      )}

      <label style={{ fontSize: 12, color: C.sub }}>日付</label>
      <input type="date" value={s.date} onChange={(e) => setS({ ...s, date: e.target.value })} style={{ ...fieldStyle, marginBottom: 12 }} />

      <label style={{ fontSize: 12, color: C.sub }}>球場</label>
      <input value={s.venue} placeholder="任意" onChange={(e) => setS({ ...s, venue: e.target.value })} style={{ ...fieldStyle, marginBottom: 16 }} />

      <label style={{ fontSize: 12, color: C.sub }}>自チームは</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
        {[["away", "先攻（表）"], ["home", "後攻（裏）"]].map(([sd, l]) => {
          const on = ownSideOf(s) === sd;
          return (
            <button key={sd} disabled={locked}
              onClick={() => { if (!locked && !on) setS(swapSides(s)); }}
              style={{
                minHeight: 56, borderRadius: 8, fontSize: 16, fontWeight: 700,
                background: on ? C.ink : C.card, color: on ? "#fff" : C.sub,
                border: `2px solid ${on ? C.ink : C.line}`, opacity: locked ? 0.5 : 1,
              }}>{l}</button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: C.dim, marginBottom: 16 }}>
        {locked ? "試合が始まっているため変更できません" : "切り替えると、入力済みの打順もそのまま入れ替わります"}
      </p>

      {SIDES.map((side) => (
        <div key={side} style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 12, color: C.sub }}>
            {side === "away" ? "先攻（表）" : "後攻（裏）"}
            {ownSideOf(s) === side && <b style={{ color: C.ink }}> ─ 自チーム</b>}
          </label>
          <input value={s.teamName[side]} onChange={(e) => setS({ ...s, teamName: { ...s.teamName, [side]: e.target.value } })} style={{ ...fieldStyle, marginBottom: 8 }} />
          {locked ? (
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8 }}>
              {s.lineup[side].map((slot, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 10px", fontSize: 14, borderBottom: i === 8 ? "none" : `1px dotted ${C.line}` }}>
                  <span style={{ fontSize: 12, color: C.dim, width: 30 }}>{i + 1}番</span>
                  <b style={{ fontFamily: MONO }}>#{uniformOf(slot.entries[0].playerId)}</b>
                  <span style={{ fontSize: 13, color: C.sub }}>
                    {slot.entries[0].position != null ? POS[slot.entries[0].position] : "守備なし"}（先発）
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {s.lineup[side].map((slot, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr 1.3fr", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: C.dim }}>{i + 1}番</span>
                  <input type="number" inputMode="numeric" value={uniformOf(slot.entries[0].playerId)}
                    onChange={(e) => editSlot(side, i, { playerId: pid(side, e.target.value.replace(/\D/g, "").slice(0, 2)) })}
                    style={{ ...fieldStyle, padding: "8px", textAlign: "center", fontFamily: MONO, minHeight: 44 }} />
                  <PosSelect value={slot.entries[0].position} onChange={(p) => editSlot(side, i, { position: p })} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {err && <div style={{ color: C.red, fontSize: 14, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <Btn onClick={start}>{locked ? "記録に戻る" : "この内容で記録を始める"}</Btn>
      <p style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>
        氏名は登録しません。個人情報を端末に残さないためです。
      </p>
    </div>
  );
}

/* ---------------- 交代・出場・保留のシート ----------------
   ここでの操作は「1プレーの入力」ではないため、
   SC-04 のタップ数計測には含めない */

function SubForm({ state, side, order, onCancel, onCommit }) {
  const slot = state.lineup[side][order - 1];
  const outgoing = activeEntry(slot);
  const guess = inferSubKind(state, side, order);
  const [num, setNum] = useState("");
  const [position, setPosition] = useState(outgoing ? outgoing.position : null);
  const [err, setErr] = useState("");

  const commit = () => {
    const sub = { t: "sub", side, order, kind: guess.kind, num, position, base: guess.base };
    const problem = validateSub(state, sub);
    if (problem) { setErr(problem); return; }
    onCommit(sub);
  };

  const why = guess.kind === "代打" ? "いま打席に立っているため「代打」として記録します"
    : guess.kind === "代走" ? `${BASE[guess.base]}にいるため「代走」として記録します`
    : "守備からの交代として記録します";

  return (
    <div style={{ background: C.card, border: `2px solid ${C.ink}`, borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
        {order}番 {outgoing ? `#${uniformOf(outgoing.playerId)}` : "空き"} を代える
      </div>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>{why}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 8, marginBottom: 10 }}>
        <input type="number" inputMode="numeric" value={num} placeholder="背番号"
          onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 2))}
          style={{ ...fieldStyle, textAlign: "center", fontFamily: MONO, minHeight: 48 }} />
        <PosSelect value={position} onChange={setPosition} />
      </div>

      {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8, fontWeight: 600 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <SmallBtn onClick={onCancel}>やめる</SmallBtn>
        <div style={{ flex: 1 }}><Btn onClick={commit}>交代する</Btn></div>
      </div>
    </div>
  );
}

function ShiftForm({ state, side, order, onCancel, onCommit }) {
  const outgoing = activeEntry(state.lineup[side][order - 1]);
  const [position, setPosition] = useState(outgoing ? outgoing.position : null);
  const [err, setErr] = useState("");

  const commit = () => {
    const sub = { t: "sub", side, kind: "守備位置変更", moves: [{ order, position }] };
    /* 同じ位置に別の選手がいる場合はその選手が外れる。先に知らせる */
    const clash = activeEntries(state, side).find(
      (e) => position != null && e.position === position && e.playerId !== (outgoing && outgoing.playerId));
    if (clash && !err) {
      setErr(`#${uniformOf(clash.playerId)} が${POS[position]}です。もう一度押すと守備なしになります`);
      return;
    }
    onCommit(sub);
  };

  return (
    <div style={{ background: C.card, border: `2px solid ${C.ink}`, borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
        {order}番 #{outgoing ? uniformOf(outgoing.playerId) : "—"} の守備位置
      </div>
      <div style={{ marginBottom: 10 }}><PosSelect value={position} onChange={(p) => { setPosition(p); setErr(""); }} /></div>
      {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8, fontWeight: 600 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <SmallBtn onClick={onCancel}>やめる</SmallBtn>
        <div style={{ flex: 1 }}><Btn onClick={commit}>変更する</Btn></div>
      </div>
    </div>
  );
}

function LineupTab({ state, onCommit }) {
  const [side, setSide] = useState(batKey(state) === "home" ? "home" : "away");
  const [open, setOpen] = useState(null);   // { order, kind:"sub"|"shift" }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {SIDES.map((sd) => (
          <button key={sd} onClick={() => { setSide(sd); setOpen(null); }}
            style={{
              minHeight: 44, borderRadius: 8, fontSize: 14, fontWeight: 700,
              background: side === sd ? C.ink : C.card, color: side === sd ? "#fff" : C.sub,
              border: `2px solid ${side === sd ? C.ink : C.line}`,
            }}>
            {state.setup.teamName[sd]}
          </button>
        ))}
      </div>

      {state.lineup[side].map((slot, i) => {
        const e = activeEntry(slot);
        const order = i + 1;
        const bench = slot.entries.length - 1;
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 15 }}>
                <span style={{ color: C.dim, fontSize: 12 }}>{order}番 </span>
                <b style={{ fontFamily: MONO }}>#{e ? uniformOf(e.playerId) : "—"}</b>
                <span style={{ color: e && e.position != null ? C.sub : C.red, fontSize: 13, marginLeft: 6 }}>
                  {e && e.position != null ? POS[e.position] : "守備なし"}
                </span>
                {bench > 0 && <span style={{ color: C.dim, fontSize: 11, marginLeft: 6 }}>交代{bench}回</span>}
              </div>
              <SmallBtn onClick={() => setOpen(open && open.order === order && open.kind === "sub" ? null : { order, kind: "sub" })}>代える</SmallBtn>
              <SmallBtn onClick={() => setOpen(open && open.order === order && open.kind === "shift" ? null : { order, kind: "shift" })}>守備</SmallBtn>
            </div>
            {open && open.order === order && open.kind === "sub" && (
              <SubForm state={state} side={side} order={order} onCancel={() => setOpen(null)}
                onCommit={(sub) => { onCommit(sub); setOpen(null); }} />
            )}
            {open && open.order === order && open.kind === "shift" && (
              <ShiftForm state={state} side={side} order={order} onCancel={() => setOpen(null)}
                onCommit={(sub) => { onCommit(sub); setOpen(null); }} />
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 12, color: C.dim, marginTop: 10, marginBottom: 16 }}>
        交代の種類（代打・代走・守備交代）は、いまの場面から自動で決まります。
      </p>

      <SubHistory state={state} />
    </>
  );
}

/** 交代の履歴。誰がいつ誰に代わったかを試合を通して残す */
function SubHistory({ state }) {
  const history = state.log.filter((l) => l.kind === "sub");
  return (
    <>
      <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>交代の履歴</div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8 }}>
        {history.length === 0
          ? <div style={{ padding: 10, fontSize: 13, color: C.dim }}>まだ交代はありません。</div>
          : history.map((l, i) => (
            <div key={`${l.seq}-${i}`}
              style={{ display: "flex", gap: 8, padding: "8px 10px", fontSize: 14, borderBottom: i === history.length - 1 ? "none" : `1px dotted ${C.line}` }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.sub, whiteSpace: "nowrap", paddingTop: 2 }}>
                {l.inning}回{l.isTop ? "表" : "裏"}
              </span>
              <span>{l.text}</span>
            </div>
          ))}
      </div>
      <p style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
        履歴はイベントとして残るため、「1つ戻す」で取り消せます。書き出したJSONにも入ります。
      </p>
    </>
  );
}

function StatsTab({ state }) {
  const stats = useMemo(() => statsFrom(state), [state]);
  const row = { display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 8, alignItems: "center", padding: "6px 8px", borderBottom: `1px dotted ${C.line}`, fontSize: 14 };

  return (
    <>
      <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>投手別 投球数</div>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>
        学童の上限は1試合かつ1日70球（4年生以下は60球）
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 16 }}>
        {stats.pitchers.length === 0
          ? <div style={{ padding: 10, fontSize: 13, color: C.dim }}>まだ投球がありません。</div>
          : stats.pitchers.map((p) => (
            <div key={p.playerId} style={row}>
              <b style={{ fontFamily: MONO }}>#{p.uniformNumber}</b>
              <span style={{ fontSize: 12, color: C.sub }}>{state.setup.teamName[p.side]}</span>
              <span style={{ fontSize: 12, color: C.sub }}>投球回 {p.halves}</span>
              <b style={{ fontFamily: MONO, fontSize: 18 }}>{p.pitches}球</b>
            </div>
          ))}
      </div>

      <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>出場イニング</div>
      {SIDES.map((side) => (
        <div key={side} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 4 }}>{state.setup.teamName[side]}</div>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8 }}>
            {stats.players[side].map((p, i) => (
              <div key={`${p.playerId}-${i}`} style={{ ...row, opacity: p.active ? 1 : 0.55 }}>
                <span style={{ fontSize: 12, color: C.dim }}>{p.order}番</span>
                <span>
                  <b style={{ fontFamily: MONO }}>#{p.uniformNumber}</b>
                  <span style={{ fontSize: 12, color: C.sub, marginLeft: 6 }}>
                    {p.position != null ? POS[p.position] : "—"}
                    {p.entryType !== "先発" && `／${p.entryType}`}
                    {!p.active && "／退場"}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: C.sub }}>{p.plateAppearances}打席{p.leftOnBase ? `・残塁${p.leftOnBase}` : ""}</span>
                <b style={{ fontFamily: MONO }}>{p.halves}回</b>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 12, color: C.dim }}>
        出場イニングは、守備・打席・走塁のいずれかで出た回を数えています。
      </p>
    </>
  );
}

function PendingTab({ state, events, setup, onResolve }) {
  const [target, setTarget] = useState(null);   // { index, zone, zone2 }
  const [result, setResult] = useState(null);
  const pend = state.log.filter((l) => l.pending);

  const before = target != null ? stateBefore(events, setup, target.index) : null;
  const question = before && result ? questionFor(before, target.zone, result) : null;

  const finish = (answer) => {
    onResolve({ t: "resolve", target: target.index, result, answer });
    setTarget(null); setResult(null);
  };

  if (pend.length === 0) {
    return <p style={{ fontSize: 14, color: C.sub }}>保留した記録はありません。</p>;
  }

  if (target != null && result && question) {
    return (
      <>
        <div style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 15 }}>
          {question.text}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {question.options.map((o) => <Btn key={o} onClick={() => finish(o)}>{o}</Btn>)}
        </div>
        <div style={{ marginTop: 8 }}><SmallBtn onClick={() => setResult(null)}>結果の選択に戻る</SmallBtn></div>
      </>
    );
  }

  if (target != null) {
    return (
      <>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>{zoneName(target.zone, target.zone2)}への打球 — 結果は</div>
        {RESOLVABLE.map((g) => (
          <div key={g.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>{g.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {g.items.map((r) => (
                <Btn key={r.k} tone={g.tone} onClick={() => {
                  const q = questionFor(stateBefore(events, setup, target.index), target.zone, r.k);
                  if (q) setResult(r.k);
                  else { onResolve({ t: "resolve", target: target.index, result: r.k }); setTarget(null); }
                }}>{r.l}</Btn>
              ))}
            </div>
          </div>
        ))}
        <SmallBtn onClick={() => setTarget(null)}>一覧に戻る</SmallBtn>
      </>
    );
  }

  return (
    <>
      <p style={{ fontSize: 13, color: C.sub, marginBottom: 10 }}>
        確定すると、そのあとの盤面も自動で計算し直します。
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {pend.map((l) => {
          const ev = events[l.src];
          return (
            <button key={l.src} onClick={() => setTarget({ index: l.src, zone: ev.zone, zone2: ev.zone2 })}
              style={{ textAlign: "left", background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "10px 12px", minHeight: 56, color: C.ink }}>
              <div style={{ fontSize: 14 }}>{l.text}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>押して結果を決める</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Sheet({ state, events, setup, onClose, onCommit }) {
  const [tab, setTab] = useState("lineup");
  const tabs = [
    { k: "lineup", l: "交代・守備" },
    { k: "stats", l: "出場・投球数" },
    { k: "pending", l: "保留" },
  ];
  const pendCount = state.log.filter((l) => l.pending).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: C.paper, zIndex: 50, display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 448, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: C.ink, color: "#fff", position: "sticky", top: 0 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>選手交代</div>
          <button onClick={onClose} style={{ minHeight: 44, padding: "0 16px", borderRadius: 8, background: "transparent", border: "2px solid #fff", color: "#fff", fontSize: 15, fontWeight: 600 }}>
            閉じる
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "10px 12px 0" }}>
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{
                minHeight: 44, borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: tab === t.k ? C.ink : C.card, color: tab === t.k ? "#fff" : C.sub,
                border: `2px solid ${tab === t.k ? C.ink : C.line}`,
              }}>
              {t.l}{t.k === "pending" && pendCount > 0 ? `（${pendCount}）` : ""}
            </button>
          ))}
        </div>

        <div style={{ padding: 12 }}>
          {tab === "lineup" && <LineupTab state={state} onCommit={onCommit} />}
          {tab === "stats" && <StatsTab state={state} />}
          {tab === "pending" && <PendingTab state={state} events={events} setup={setup} onResolve={onCommit} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- スコアブック（成美堂「保存版」の様式） ----------------
   成美堂スポーツ出版「野球スコアブック 保存版」（補充用紙 9107 と同じ様式）に合わせる。
   A4横・13イニング・1ページ1チーム。欄の名称と並びは現物どおりにし、
   イベント列から出せる数字だけを入れる。氏名・打方・監督名・勝負・セーブ・
   自責点は記録していないので空のままにする（FR-14 ほか）。 */

const PW = 1052;            // A4横 297mm − 余白8mm×2 を 96dpi に直した幅
const SLOT = 46;            // 打順1枠の高さ
const INNS = Array.from({ length: 13 }, (_, i) => i + 1);
const SK = "#2F5D3A";       // 罫線（現物は緑）
const SKT = "#8FB199";      // ダイヤの細罫

const cw = { po: 15, as: 15, er: 15, dp: 15, ord: 17, seat: 19, bat: 13, name: 66, num: 19 };
const rw = { pa: 17, ab: 17, run: 17, h: 15, etc: 15 };
const LEFT = cw.po + cw.as + cw.er + cw.dp + cw.ord + cw.seat * 3 + cw.bat + cw.name + cw.num;
const RIGHT = rw.pa + rw.ab + rw.run + rw.h * 4 + rw.etc * 9;
const IW = Math.floor((PW - LEFT - RIGHT) / 13);

const bx = (extra) => ({
  border: `1px solid ${SK}`, padding: 0, textAlign: "center",
  fontSize: 8, lineHeight: "10px", color: "#123", ...extra,
});
const vert = {
  writingMode: "vertical-rl", textOrientation: "upright",
  letterSpacing: -1.5, margin: "0 auto", fontSize: 7, lineHeight: "10px", whiteSpace: "nowrap",
};
const HDR1 = 44, HDR2 = 26;   // 見出し2段。縦書き3文字が入る高さ
const n0 = (v) => (v ? String(v) : "");

/** 1マス。投球・ダイヤ・打者結果・走者・アウトカウント・得点（記法規約 §1） */
function PaperCell({ c }) {
  const line = c && c.kind === "ground" ? { borderBottom: "1px solid #123" }
    : c && (c.kind === "fly" || c.kind === "liner") ? { borderTop: "1px solid #123" } : {};
  return (
    <td style={bx({ height: SLOT, verticalAlign: "top" })}>
      <div style={{ position: "relative", width: "100%", height: SLOT - 2 }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 9, fontSize: 5.5, lineHeight: "6px" }}>
          {(c ? c.pitches : []).map((p, i) => <div key={i}>{p}</div>)}
        </div>
        <svg viewBox="0 0 44 44" style={{ position: "absolute", left: 9, top: 0, width: IW - 10, height: SLOT - 4 }}>
          <path d="M22 9 L35 22 L22 35 L9 22 Z" fill="none" stroke={SKT} strokeWidth="0.8" strokeDasharray="2 2" />
        </svg>
        {c && c.runner.length > 0 && (
          <div style={{ position: "absolute", right: 0, top: 0, fontSize: 5.5, lineHeight: "6px", textAlign: "right" }}>
            {c.runner.map((r, i) => <div key={i}>{r}</div>)}
          </div>
        )}
        {c && c.outs && (
          <div style={{ position: "absolute", left: 9, top: SLOT / 2 - 12, width: IW - 10, textAlign: "center", fontSize: 7, fontWeight: 700 }}>
            {c.outs}
          </div>
        )}
        {c && c.result && (
          <div style={{ position: "absolute", right: 1, bottom: 1, fontSize: 8, fontWeight: 600, whiteSpace: "nowrap", ...line }}>
            {c.result}
          </div>
        )}
        {c && c.scored && (
          <div style={{ position: "absolute", left: 9, bottom: 0, width: IW - 10, textAlign: "center", fontSize: 8 }}>●</div>
        )}
      </div>
    </td>
  );
}

function ScoreSheet({ setup, events, onClose }) {
  const { cells } = useMemo(() => scoreSheet(events, setup), [events, setup]);
  const sum = useMemo(() => sheetSummary(events, setup), [events, setup]);
  const own = ownSideOf(setup);
  const sides = [own, oppSideOf(setup)];
  const st = sum.state;

  /* 上部のスコアボード。現物は各ページの頭に両チーム分が載る */
  const board = (
    <table style={{ borderCollapse: "collapse", width: PW, tableLayout: "fixed", marginBottom: 4 }}>
      <tbody>
        <tr>
          <td style={bx({ width: 120, fontSize: 9 })}>チーム名</td>
          <td style={bx({ width: 70, fontSize: 9 })}>（監督名）</td>
          {INNS.map((i) => <td key={i} style={bx({ width: 26, fontSize: 9 })}>{i}</td>)}
          <td style={bx({ width: 34, fontSize: 9 })}>合 計</td>
          <td style={bx({ fontSize: 9 })} rowSpan={3}>記事</td>
        </tr>
        {["away", "home"].map((sd) => (
          <tr key={sd}>
            <td style={bx({ fontSize: 9, height: 16 })}>{setup.teamName[sd]}</td>
            <td style={bx({})} />
            {INNS.map((i) => {
              const r = sum.inn[sd].get(i);
              return <td key={i} style={bx({})}>{r && i <= st.inning ? r.run : ""}</td>;
            })}
            <td style={bx({ fontWeight: 700 })}>{st.score[sd]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const page = (side, idx) => {
    const slots = setup.lineup[side];
    const tot = { pa: 0, ab: 0, run: 0, h1: 0, h2: 0, h3: 0, hr: 0, tb: 0, rbi: 0, sb: 0, cs: 0, sacB: 0, sacF: 0, bb: 0, so: 0, lob: 0 };
    const rows = slots.map((slot, si) => {
      const order = si + 1;
      const es = slot.entries;
      const agg = es.reduce((a, e) => {
        const b = sum.bat.get(e.playerId);
        if (b) for (const k of Object.keys(a)) a[k] += b[k] || 0;
        return a;
      }, { pa: 0, ab: 0, run: 0, h1: 0, h2: 0, h3: 0, hr: 0, rbi: 0, sb: 0, cs: 0, sacB: 0, sacF: 0, bb: 0, so: 0, lob: 0, po: 0, as: 0, err: 0, dp: 0 });
      const tb = agg.h1 + agg.h2 * 2 + agg.h3 * 3 + agg.hr * 4;
      for (const k of Object.keys(tot)) tot[k] += k === "tb" ? tb : (agg[k] || 0);
      const stack = (f) => (
        <div style={{ fontSize: 7, lineHeight: "12px" }}>
          {es.slice(0, 3).map((e, i) => <div key={i}>{f(e)}</div>)}
        </div>
      );
      return (
        <tr key={order}>
          <td style={bx({})}>{n0(agg.po)}</td>
          <td style={bx({})}>{n0(agg.as)}</td>
          <td style={bx({})}>{n0(agg.err)}</td>
          <td style={bx({})}>{n0(agg.dp)}</td>
          <td style={bx({ fontSize: 7, lineHeight: "12px" })}>
            <div>{order}</div><div>{order + 10}</div><div>{order + 20}</div>
          </td>
          <td style={bx({})}>{stack((e) => (e.position != null ? e.position : ""))}</td>
          <td style={bx({})} />
          <td style={bx({})} />
          <td style={bx({})} />
          <td style={bx({})} />
          <td style={bx({ fontSize: 8 })}>{stack((e) => uniformOf(e.playerId))}</td>
          {INNS.map((i) => <PaperCell key={i} c={cells.get(`${side}|${order}|${i}`)} />)}
          <td style={bx({})}>{n0(agg.pa)}</td>
          <td style={bx({})}>{n0(agg.ab)}</td>
          <td style={bx({})}>{n0(agg.run)}</td>
          <td style={bx({})}>{n0(agg.h1)}</td>
          <td style={bx({})}>{n0(agg.h2)}</td>
          <td style={bx({})}>{n0(agg.h3)}</td>
          <td style={bx({})}>{n0(agg.hr)}</td>
          <td style={bx({})}>{n0(tb)}</td>
          <td style={bx({})}>{n0(agg.rbi)}</td>
          <td style={bx({})}>{n0(agg.sb)}</td>
          <td style={bx({})}>{n0(agg.cs)}</td>
          <td style={bx({})}>{n0(agg.sacB)}</td>
          <td style={bx({})}>{n0(agg.sacF)}</td>
          <td style={bx({})}>{n0(agg.bb)}</td>
          <td style={bx({})}>{n0(agg.so)}</td>
          <td style={bx({})}>{n0(agg.lob)}</td>
        </tr>
      );
    });
    const pitchers = [...sum.pit.entries()].filter(([id]) => sideOf(id) === side);

    return (
      <div key={side} style={{ width: PW, pageBreakAfter: idx === 0 ? "always" : "auto", breakAfter: idx === 0 ? "page" : "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, margin: "6px 0 2px" }}>
          {setup.teamName[side]}{side === own ? "（自チーム）" : ""}　{setup.date}
          {"　"}{setup.venue}{"　"}開始 {HHMM(setup.startedAt) || "—"}　終了 {HHMM(setup.endedAt) || "—"}
        </div>
        {board}
        <table style={{ borderCollapse: "collapse", width: PW, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ height: HDR1 + HDR2 }}>
              <td style={bx({ width: cw.po })} rowSpan={2}><span style={vert}>刺殺</span></td>
              <td style={bx({ width: cw.as })} rowSpan={2}><span style={vert}>補殺</span></td>
              <td style={bx({ width: cw.er })} rowSpan={2}><span style={vert}>失策</span></td>
              <td style={bx({ width: cw.dp })} rowSpan={2}><span style={vert}>併殺</span></td>
              <td style={bx({ width: cw.ord })} rowSpan={2}><span style={vert}>打順</span></td>
              <td style={bx({ fontSize: 8, height: HDR1 })} colSpan={3}>シート</td>
              <td style={bx({ fontSize: 8 })} colSpan={3}>{side === "away" ? "先攻" : "後攻"}</td>
              {INNS.map((i) => <td key={i} style={bx({ width: IW, fontSize: 11, fontWeight: 700 })} rowSpan={2}>{i}</td>)}
              <td style={bx({ width: rw.pa })} rowSpan={2}><span style={vert}>打席数</span></td>
              <td style={bx({ width: rw.ab })} rowSpan={2}><span style={vert}>打数</span></td>
              <td style={bx({ width: rw.run })} rowSpan={2}><span style={vert}>得点</span></td>
              <td style={bx({ fontSize: 8 })} colSpan={4}>安 打</td>
              {["塁打数", "得点打", "盗塁", "盗塁刺", "犠打", "犠飛", "四死球", "三振", "残塁"].map((t) => (
                <td key={t} style={bx({ width: rw.etc })} rowSpan={2}><span style={vert}>{t}</span></td>
              ))}
            </tr>
            <tr style={{ height: HDR2 }}>
              <td style={bx({ width: cw.seat, fontSize: 7 })}>先発</td>
              <td style={bx({ width: cw.seat })} />
              <td style={bx({ width: cw.seat })} />
              <td style={bx({ width: cw.bat })}><span style={vert}>打方</span></td>
              <td style={bx({ width: cw.name, fontSize: 7 })}>氏名</td>
              <td style={bx({ width: cw.num })}><span style={vert}>背番号</span></td>
              {["単打", "二塁打", "三塁打", "本塁打"].map((t) => (
                <td key={t} style={bx({ width: rw.h })}><span style={vert}>{t}</span></td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows}
            <tr>
              <td style={bx({ fontSize: 9 })} colSpan={5} rowSpan={3}>合 計</td>
              <td style={bx({ fontSize: 6.5 })} colSpan={6}>安打／四死球／失策</td>
              {INNS.map((i) => {
                const r = sum.inn[side].get(i);
                return <td key={i} style={bx({ fontSize: 7 })}>{r ? `${r.h}／${r.bb}／${r.err}` : ""}</td>;
              })}
              <td style={bx({})}>{n0(tot.pa)}</td>
              <td style={bx({})}>{n0(tot.ab)}</td>
              <td style={bx({})}>{n0(tot.run)}</td>
              <td style={bx({})}>{n0(tot.h1)}</td>
              <td style={bx({})}>{n0(tot.h2)}</td>
              <td style={bx({})}>{n0(tot.h3)}</td>
              <td style={bx({})}>{n0(tot.hr)}</td>
              <td style={bx({})}>{n0(tot.tb)}</td>
              <td style={bx({})}>{n0(tot.rbi)}</td>
              <td style={bx({})}>{n0(tot.sb)}</td>
              <td style={bx({})}>{n0(tot.cs)}</td>
              <td style={bx({})}>{n0(tot.sacB)}</td>
              <td style={bx({})}>{n0(tot.sacF)}</td>
              <td style={bx({})}>{n0(tot.bb)}</td>
              <td style={bx({})}>{n0(tot.so)}</td>
              <td style={bx({})}>{n0(tot.lob)}</td>
            </tr>
            <tr>
              <td style={bx({ fontSize: 9 })} colSpan={6}>得　点</td>
              {INNS.map((i) => {
                const r = sum.inn[side].get(i);
                return <td key={i} style={bx({})}>{r && i <= st.inning ? r.run : ""}</td>;
              })}
              <td style={bx({})} colSpan={16} />
            </tr>
            <tr>
              <td style={bx({ fontSize: 9 })} colSpan={6}>投 球 数</td>
              {INNS.map((i) => {
                const r = sum.inn[side].get(i);
                return <td key={i} style={bx({})}>{r && r.pitches ? r.pitches : ""}</td>;
              })}
              <td style={bx({})} colSpan={16} />
            </tr>
          </tbody>
        </table>

        <table style={{ borderCollapse: "collapse", width: PW, tableLayout: "fixed", marginTop: 4 }}>
          <tbody>
            <tr>
              <td style={bx({ width: 18, fontSize: 8 })} rowSpan={7}><span style={vert}>投手</span></td>
              <td style={bx({ width: 24, fontSize: 7 })} />
              <td style={bx({ width: 96, fontSize: 8 })}>氏　名</td>
              {["勝負", "セーブ", "投球回数", "打者", "打数", "投球数", "安打", "本塁打", "犠打", "犠飛", "四球", "死球", "三振", "暴投", "ボーク", "失点", "自責点"].map((t) => (
                <td key={t} style={bx({ fontSize: 6.5 })}>{t}</td>
              ))}
            </tr>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const row = pitchers[i];
              const p = row ? row[1] : null;
              return (
                <tr key={i}>
                  <td style={bx({ fontSize: 7, height: 14 })}>{i === 0 ? "先発" : i + 1}</td>
                  <td style={bx({ fontSize: 8 })}>{row ? `#${uniformOf(row[0])}` : ""}</td>
                  <td style={bx({})} />
                  <td style={bx({})} />
                  <td style={bx({})}>{p ? inningsPitched(p.outs) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.bf) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.ab) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.pitches) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.h) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.hr) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.sacB) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.sacF) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.bb) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.hbp) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.so) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.wp) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.bk) : ""}</td>
                  <td style={bx({})}>{p ? n0(p.runs) : ""}</td>
                  <td style={bx({})} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 60, overflow: "auto" }}>
      <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", background: C.ink, color: "#fff", position: "sticky", top: 0, zIndex: 2 }}>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>スコアブック（成美堂 保存版の様式）</div>
        <button onClick={() => window.print()} style={{ minHeight: 44, padding: "0 14px", borderRadius: 8, background: "#fff", border: "none", color: C.ink, fontSize: 15, fontWeight: 700 }}>印刷</button>
        <button onClick={onClose} style={{ minHeight: 44, padding: "0 14px", borderRadius: 8, background: "transparent", border: "2px solid #fff", color: "#fff", fontSize: 15 }}>閉じる</button>
      </div>
      <div className="sheet-wrap" style={{ overflowX: "auto", padding: 8 }}>
        {sides.map((s, i) => page(s, i))}
        <div className="no-print" style={{ fontSize: 11, color: C.sub, lineHeight: 1.7, width: PW, marginTop: 8 }}>
          成美堂スポーツ出版「野球スコアブック 保存版」（補充用紙 9107）の様式。A4横・1ページ1チーム。
          左の細い列が投球（●ボール ○見逃し ×空振り ―ファール）。数字の下線がゴロ、上線がフライ・ライナー。
          <br />
          氏名・打方・監督名・勝負・セーブ・自責点は記録していないため空欄です。
        </div>
      </div>
    </div>
  );
}

/* ---------------- 本体 ---------------- */

export default function App() {
  const saved = useMemo(() => load(), []);
  const [setup, setSetup] = useState(saved ? saved.setup : null);
  const [events, setEvents] = useState(saved ? saved.events : []);
  const [notice, setNotice] = useState(saved && saved.migrated
    ? "以前の記録を新しい形式に変換しました。「選手交代」から守備位置（特に投手）を設定してください。" : "");
  const [mode, setMode] = useState("pitch");
  const [draft, setDraft] = useState(null);
  const [question, setQuestion] = useState(null);
  const [note, setNote] = useState("");
  const [taps, setTaps] = useState(0);
  const [plays, setPlays] = useState(0);
  const [tapsThis, setTapsThis] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [movesErr, setMovesErr] = useState("");
  const [rewindTo, setRewindTo] = useState(null);   // ログから選んだ巻き戻し先
  const [seq, setSeq] = useState(null);             // 守備の関与順を手で組むとき
  const [showSheetPaper, setShowSheetPaper] = useState(false);
  const [seqFor, setSeqFor] = useState("batted");   // その関与順が打球のものか走者のものか
  const fileRef = useRef(null);

  /* 1操作ごとに自動保存。試合中に閉じても消えない */
  useEffect(() => {
    if (setup) save({ setup, events, savedAt: new Date().toISOString() });
  }, [setup, events]);

  const state = useMemo(() => (setup ? deriveState(events, setup) : null), [events, setup]);

  const importJson = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = migrate(JSON.parse(String(reader.result)));
        if (!d) throw new Error("形式が違います");
        if (events.length && !confirm("いまの試合を置き換えます。書き出していないデータは戻せません。よろしいですか？")) return;
        setSetup(d.setup); setEvents(d.events);
        setMode("pitch"); setDraft(null); setQuestion(null);
        setTaps(0); setPlays(0); setTapsThis(0);
        setNotice(d.migrated ? "読み込みました。守備位置（特に投手）を設定してください。" : "読み込みました。");
      } catch (err) {
        setNotice("読み込めませんでした。このアプリで書き出したJSONを選んでください。");
      }
    };
    reader.readAsText(file);
  };

  if (!setup || showSetup) {
    return (
      <Shell>
        <Setup initial={setup} locked={events.length > 0}
          onStart={(s) => { setSetup(s); setShowSetup(false); setNotice(""); }} />
        <div style={{ padding: "0 16px 16px" }}>
          <SmallBtn onClick={() => fileRef.current && fileRef.current.click()}>JSONを読み込む</SmallBtn>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importJson(f); e.target.value = ""; }} />
          {notice && <div style={{ fontSize: 13, color: C.red, marginTop: 8 }}>{notice}</div>}
        </div>
      </Shell>
    );
  }

  const tap = () => { setTaps((t) => t + 1); setTapsThis((t) => t + 1); };

  const stampStart = () => {
    if (!setup.startedAt) setSetup((s0) => ({ ...s0, startedAt: new Date().toISOString() }));
  };

  const commit = (ev) => {
    stampStart();
    setEvents((e) => [...e, ev]);
    setPlays((p) => p + 1);
    setTapsThis(0);
    setMode("pitch");
    setDraft(null);
    setQuestion(null);
  };

  /* ベンチ操作（交代・保留の確定）はプレー入力ではないため計測に含めない */
  const commitBench = (ev) => { stampStart(); setEvents((e) => [...e, ev]); };

  const onPitch = (r) => {
    tap();
    stampStart();
    setEvents((e) => [...e, { t: "pitch", r }]);
    setPlays((p) => p + 1);
    setTapsThis(0);
  };

  const runnersOnBase = state.bases
    .map((r, i) => (r != null ? { base: i, num: uniformOf(r) } : null))
    .filter(Boolean);


  const onRunnerWhy = (r) => {
    tap();
    /* アウトになった走者は、誰が刺したかを記録する。挟殺なら送球が何度も続く */
    if (r.out) {
      setDraft({ ...draft, reason: r });
      setSeq({ f: CATCHER_FIRST.has(r.k) ? [2] : [], errorAt: null, kind: "" });
      setSeqFor("runner");
      setMode("fielders");
      return;
    }
    const q = runnerQuestionFor(state, draft.from, r.k);
    if (q) { setDraft({ ...draft, reason: r }); setQuestion(q); setMode("runner-far"); return; }
    commit({ t: "runner", from: draft.from, reason: r.k, out: r.out });
  };

  const onRunnerFar = (o) => {
    tap();
    commit({ t: "runner", from: draft.from, reason: draft.reason.k, out: false, to: o.to });
  };

  const onZone = (z, z2) => {
    tap();
    setDraft(z2 == null ? { zone: z } : { zone: z, zone2: z2 });
    setMode("result");
  };

  /* 打球方向・結果・打球の性質が決まったあとの共通の続き */
  const afterResult = (zone, zone2, r, batted) => {
    const moves = defaultMoves(state, r);
    const base = {
      zone, ...(zone2 != null ? { zone2 } : {}), result: r,
      ...(batted ? { batted } : {}),
    };
    /* 走者がいなければ行き先は一通りに決まるので、確認画面を出さない */
    if (state.bases.every((b) => b == null)) { commit({ t: "inplay", ...base, moves }); return; }
    setMovesErr("");
    setDraft({ ...base, moves });
    setMode("moves");
  };

  const onResult = (r) => {
    tap();
    const zone = draft ? draft.zone : null;
    const zone2 = draft ? draft.zone2 : null;
    if (r === "保留") { setDraft({ zone, zone2, result: r }); setNote(""); setMode("hold-note"); return; }
    /* ヒットや長打は結果の名前に打球の性質が入らない。記法規約 §4 の補助線
       （ゴロ＝凵／フライ＝⌐／ライナー＝横線）を書けるよう、続けて聞く */
    if (asksBatted(r)) { setDraft({ zone, zone2, result: r }); setMode("batted"); return; }
    afterResult(zone, zone2, r, null);
  };

  const onBatted = (k) => { tap(); afterResult(draft.zone, draft.zone2, draft.result, k); };

  /* 導出では決まらない関与順（併殺の中継、受け手のエラー）を手で組む。
     初期値は導出結果なので、足りないところだけ触ればよい */
  const openSeq = () => {
    tap();
    setSeq(seq || (draft.zone2 != null
      ? { f: [], errorAt: null, kind: "" }
      : defaultFielders(draft.zone, draft.result, draft.moves)));
    setSeqFor("batted");
    setMode("fielders");
  };
  const seqAdd = (n) => { tap(); setSeq((q) => ({ ...q, f: [...q.f, n] })); };
  const seqDrop = () => { tap(); setSeq((q) => ({ ...q, f: q.f.slice(0, -1), errorAt: q.errorAt != null && q.errorAt >= q.f.length - 1 ? null : q.errorAt })); };
  const seqError = (i) => { tap(); setSeq((q) => ({ ...q, errorAt: q.errorAt === i ? null : i, kind: q.errorAt === i ? "" : q.kind })); };
  const seqKind = (k) => { tap(); setSeq((q) => ({ ...q, kind: q.kind === k ? "" : k })); };
  const seqDone = () => {
    tap();
    if (seqFor === "runner") {
      commit({
        t: "runner", from: draft.from, reason: draft.reason.k, out: true,
        ...(seq.f.length ? { fielders: seq.f, errorAt: seq.errorAt, errorKind: seq.kind } : {}),
      });
      setSeq(null); setSeqFor("batted");
      return;
    }
    setDraft((d) => ({ ...d, fielders: seq.f, errorAt: seq.errorAt, errorKind: seq.kind }));
    setMode("moves");
  };

  const setMove = (from, to) => {
    tap();
    setMovesErr("");
    setDraft((d) => ({ ...d, moves: d.moves.map((m) => (m.from === from ? { ...m, to } : m)) }));
  };

  const commitMoves = () => {
    const problem = validateMoves(draft.moves);
    if (problem) { setMovesErr(problem); return; }
    tap();
    commit({
      t: "inplay", zone: draft.zone, ...(draft.zone2 != null ? { zone2: draft.zone2 } : {}),
      result: draft.result, moves: draft.moves,
      ...(draft.batted ? { batted: draft.batted } : {}),
      ...(draft.fielders ? { fielders: draft.fielders, errorAt: draft.errorAt, errorKind: draft.errorKind } : {}),
    });
  };

  const onAnswer = (a) => {
    tap();
    commit({
      t: "inplay", zone: draft ? draft.zone : null,
      ...(draft && draft.zone2 != null ? { zone2: draft.zone2 } : {}),
      result: draft.result, answer: a,
    });
  };

  const backTarget = () => {
    switch (mode) {
      case "zone": return "「打った」を取り消す";
      case "no-ball": return "「打球以外」を取り消す";
      case "result": return "打球方向の選択に戻る";
      case "detail": return "結果の選択に戻る";
      case "batted": return "結果の選択に戻る";
      case "moves": return draft && asksBatted(draft.result) ? "打球の性質の選択に戻る" : "結果の選択に戻る";
      case "fielders": return seqFor === "runner" ? "理由の選択に戻る" : "ランナーの行き先に戻る";
      case "question": return "結果の選択に戻る";
      case "hold-note": return "結果の選択に戻る";
      case "runner-why": return "ランナーの選択を取り消す";
      case "runner-detail": return "理由の選択に戻る";
      case "runner-far": return "理由の選択に戻る";
      default: {
        if (!events.length) return "戻せる記録がありません";
        const last = events[events.length - 1];
        if (last.t === "sub") return last.kind === "守備位置変更" ? "直前の守備位置変更を取り消す" : `直前の${last.kind}を取り消す`;
        if (last.t === "resolve") return "保留の確定を取り消す";
        if (last.t === "pitch") return "直前の投球を取り消す";
        if (last.t === "runner") {
          if (last.fielders) return "送球先の選択に戻る";
          if (last.to != null) return "進塁先の選択に戻る";
          return RUNNER_DETAIL_KEYS.has(last.reason) ? "詳細の選択に戻る" : "ランナーが動いた理由の選択に戻る";
        }
        if (last.result === "保留") return "メモの入力に戻る";
        if (DETAIL_KEYS.has(last.result)) return "詳細の選択に戻る";
        if (NO_BALL_KEYS.has(last.result)) return "打球以外の選択に戻る";
        if (last.answer != null) return "ランナーの確認に戻る";
        return "結果の選択に戻る";
      }
    }
  };

  const undo = () => {
    if (mode !== "pitch") {
      tap();
      if (mode === "zone") setMode("pitch");
      else if (mode === "no-ball") { setMode("pitch"); setDraft(null); }
      else if (mode === "result") { setMode("zone"); setDraft(null); }
      else if (mode === "detail") setMode("result");
      else if (mode === "batted") { setDraft({ zone: draft.zone, zone2: draft.zone2 }); setMode("result"); }
      else if (mode === "fielders") { const to = seqFor === "runner" ? "runner-why" : "moves"; setSeq(null); setSeqFor("batted"); setMode(to); }
      else if (mode === "moves") {
        setMovesErr("");
        if (draft.zone == null) setMode("no-ball");
        else if (asksBatted(draft.result)) { setDraft({ zone: draft.zone, zone2: draft.zone2, result: draft.result }); setMode("batted"); }
        else setMode(DETAIL_KEYS.has(draft.result) ? "detail" : "result");
      }
      else if (mode === "question") { setQuestion(null); setDraft({ zone: draft.zone, zone2: draft.zone2 }); setMode("result"); }
      else if (mode === "hold-note") { setNote(""); setDraft({ zone: draft.zone, zone2: draft.zone2 }); setMode("detail"); }
      else if (mode === "runner-why") { setDraft(null); setMode("pitch"); }
      else if (mode === "runner-detail") setMode("runner-why");
      else if (mode === "runner-far") { setQuestion(null); setMode("runner-why"); }
      return;
    }
    if (!events.length) return;
    tap();
    const last = events[events.length - 1];
    const prev = deriveState(events.slice(0, -1), setup);
    setEvents((e) => e.slice(0, -1));
    setTapsThis(0);

    /* 交代と保留の確定はプレー数に数えていないため、戻すときも減らさない */
    if (last.t !== "sub" && last.t !== "resolve") setPlays((p) => Math.max(0, p - 1));

    /* 打席結果は3つの選択を1イベントにまとめているため、
       削除で終わらせず直前の選択画面まで戻す（§12.5） */
    if (last.t === "inplay") {
      if (last.answer != null) {
        setDraft({ zone: last.zone, zone2: last.zone2, result: last.result });
        setQuestion(questionFor(prev, last.zone, last.result));
        setMode("question");
      } else if (last.result === "保留") {
        setDraft({ zone: last.zone, zone2: last.zone2, result: "保留" }); setNote(last.note || ""); setMode("hold-note");
      } else {
        setQuestion(null);
        if (last.moves) {
          setDraft({ zone: last.zone, zone2: last.zone2, result: last.result, moves: last.moves, batted: last.batted });
          setMovesErr(""); setMode("moves");
        } else if (NO_BALL_KEYS.has(last.result)) { setDraft(null); setMode("no-ball"); }
        else { setDraft({ zone: last.zone, zone2: last.zone2 }); setMode(DETAIL_KEYS.has(last.result) ? "detail" : "result"); }
      }
      return;
    }
    if (last.t === "runner") {
      const r = [...RUNNER_REASONS, ...RUNNER_DETAIL].find((x) => x.k === last.reason);
      setDraft({ from: last.from, reason: r });
      if (last.fielders) {
        setQuestion(null);
        setSeq({ f: last.fielders, errorAt: last.errorAt == null ? null : last.errorAt, kind: last.errorKind || "" });
        setSeqFor("runner"); setMode("fielders");
        return;
      }
      if (last.to != null) { setQuestion(runnerQuestionFor(prev, last.from, last.reason)); setMode("runner-far"); return; }
      setQuestion(null);
      setMode(RUNNER_DETAIL_KEYS.has(last.reason) ? "runner-detail" : "runner-why");
      return;
    }
    setDraft(null); setQuestion(null); setMode("pitch");
  };

  /* ログの行を選んで、そこから後をまとめて取り消す。
     「1つ戻す」は画面を戻す動作とイベントを消す動作を兼ねており、
     何回押せば目的の打席に戻るのか分からないため（FR-36 の暫定策） */
  const rewind = (src) => {
    setEvents((e) => e.slice(0, src));
    setRewindTo(null);
    setMode("pitch"); setDraft(null); setQuestion(null); setNote(""); setMovesErr("");
    setPlays(0); setTapsThis(0);
  };

  /* iOS Safari は blob の download 属性を無視してタブで開いてしまうため、
     共有シートがあればそちらを優先する。保存もLINE送信もそこからできる。
     従来は a を DOM に入れずに click し、直後に revokeObjectURL していたため、
     ダウンロードが始まる前に blob が破棄されることもあった */
  const exportJson = async () => {
    const name = `score_${setup.date}_${setup.teamName[ownSideOf(setup)]}_vs_${setup.teamName[oppSideOf(setup)]}.json`;
    const text = JSON.stringify({ setup, events }, null, 2);

    try {
      const file = new File([text], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        setNotice("書き出しました。");
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;   // 利用者が共有をやめた
    }

    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("書き出しました。保存先はブラウザのダウンロードを確認してください。");
    } catch {
      setNotice("書き出せませんでした。記録は端末に残っています。");
    }
  };

  const newGame = () => {
    if (!confirm("今の試合を消して新しい試合を始めます。書き出していないデータは戻せません。よろしいですか？")) return;
    setEvents([]); setSetup(null); setMode("pitch"); setDraft(null); setQuestion(null);
    setTaps(0); setPlays(0); setTapsThis(0); setNotice("");
    localStorage.removeItem(SAVE_KEY);
  };

  const bk = batKey(state);
  const avg = plays > 0 ? (taps / plays).toFixed(2) : "—";
  const pit = pitcherId(state);
  const pitchesNow = state.pitchCount[pit || `${state.isTop ? "home" : "away"}#投手未設定`] || 0;
  const pendCount = state.log.filter((l) => l.pending).length;

  return (
    <Shell>
      {showSheet && (
        <Sheet state={state} events={events} setup={setup}
          onClose={() => setShowSheet(false)} onCommit={commitBench} />
      )}
      {showSheetPaper && (
        <ScoreSheet setup={setup} events={events} onClose={() => setShowSheetPaper(false)} />
      )}

      {/* 計測ヘッダ */}
      <div style={{ display: "flex", background: C.ink, color: "#fff" }}>
        <div style={{ flex: 1, padding: "8px 16px" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>タップ数 / プレー</div>
          <div style={{ fontFamily: MONO, fontSize: 30, lineHeight: 1.1 }}>{avg}</div>
        </div>
        <div style={{ padding: "8px 16px", textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>今のプレー</div>
          <div style={{ fontFamily: MONO, fontSize: 30, lineHeight: 1.1 }}>{tapsThis}</div>
        </div>
      </div>

      {notice && (
        <div style={{ background: "#FDF3E7", borderBottom: `1px solid ${C.line}`, padding: "8px 16px", fontSize: 13, color: C.ink }}>
          {notice}
          <button onClick={() => setNotice("")} style={{ marginLeft: 8, background: "transparent", border: "none", color: C.sub, textDecoration: "underline", fontSize: 12 }}>閉じる</button>
        </div>
      )}

      {/* 常時表示（FR-20） */}
      <div style={{ padding: "12px 16px", background: C.card, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700 }}>{state.inning}回{state.isTop ? "表" : "裏"}</div>
            <div style={{ fontSize: 12, color: C.sub }}>
              {setup.teamName.away} {state.score.away} — {state.score.home} {setup.teamName.home}
            </div>
          </div>
          <MiniDiamond bases={state.bases} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.sub }}>アウト</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 13, height: 13, borderRadius: 99, background: i < state.outs ? C.red : "transparent", border: `2px solid ${i < state.outs ? C.red : C.line}` }} />
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <div style={{ fontSize: 16 }}>
            <span style={{ color: C.sub, fontSize: 12 }}>{setup.teamName[bk]} </span>
            <b>{batterOrder(state)}番</b>
            <span style={{ fontFamily: MONO, marginLeft: 6 }}>#{batterNum(state)}</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 20 }}>B<b>{state.balls}</b> <span style={{ color: C.line }}>|</span> S<b>{state.strikes}</b></div>
          <div style={{ fontSize: 12, color: C.sub, textAlign: "right" }}>
            投手 {pit ? `#${uniformOf(pit)}` : <span style={{ color: C.red }}>未設定</span>}<br />
            <span style={{ fontFamily: MONO, fontSize: 18, color: C.ink }}>{pitchesNow}</span>
            <span style={{ fontSize: 11 }}>球</span>
          </div>
        </div>
      </div>

      {/* 操作 */}
      <div style={{ flex: 1, padding: 16 }}>
        {mode === "pitch" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PITCH_OPTIONS.map((p) => (
                <Btn key={p.k} tone="ghost" onClick={() => onPitch(p.k)}>{p.l}</Btn>
              ))}
            </div>
            <div style={{ marginTop: 12 }}><Btn onClick={() => { tap(); setMode("zone"); }}>打った</Btn></div>
            <div style={{ marginTop: 8 }}>
              <Btn tone="warn" onClick={() => { tap(); setDraft(null); setMode("no-ball"); }}>打球以外</Btn>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              死球・振り逃げ・妨害など、打球のない結果
            </div>

            {/* 塁上の走者を常に出す。打者と同じく、ここから直接押せる。
                盗塁が最も多いため1タップ、それ以外は「その他」から選ぶ */}
            {runnersOnBase.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>ランナー</div>
                {runnersOnBase.map((r) => (
                  <div key={r.base} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 14, width: 78 }}>
                      {BASE[r.base]}<b style={{ fontFamily: MONO, marginLeft: 4 }}>#{r.num}</b>
                    </span>
                    <SmallBtn onClick={() => { tap(); commit({ t: "runner", from: r.base, reason: "盗塁", out: false }); }}>盗塁</SmallBtn>
                    <SmallBtn onClick={() => { tap(); setDraft({ from: r.base }); setMode("runner-why"); }}>その他</SmallBtn>
                  </div>
                ))}
                {runnersOnBase.length > 1 && (
                  <SmallBtn onClick={() => { tap(); setDraft({ from: "all" }); setMode("runner-why"); }}>ランナー全員が動いた（重盗）</SmallBtn>
                )}
                <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
                  打球でランナーがさらに進んだときは「その他」→「打球で進塁」
                </div>
              </div>
            )}
          </>
        )}

        {mode === "no-ball" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>打球のない結果</div>
            {NO_BALL_GROUPS.map((g) => (
              <div key={g.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>{g.label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {g.items.map((r) => (<Btn key={r.k} tone={g.tone} onClick={() => onResult(r.k)}>{r.l}</Btn>))}
                </div>
              </div>
            ))}
          </>
        )}

        {mode === "runner-why" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>
              {draft.from === "all"
                ? "ランナー全員が動いた理由は"
                : `${BASE[draft.from]}ランナー #${uniformOf(state.bases[draft.from])} が動いた理由は`}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {RUNNER_REASONS.map((r) => (
                <Btn key={r.k} tone={r.out ? "warn" : "ghost"} onClick={() => onRunnerWhy(r)}>{r.l}</Btn>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Btn tone="warn" onClick={() => { tap(); setMode("runner-detail"); }}>詳細</Btn>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>ボーク・タッチアウト・妨害</div>
          </>
        )}

        {mode === "runner-detail" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>
              {draft.from === "all" ? "ランナー全員 — 詳細" : `${BASE[draft.from]}ランナー #${uniformOf(state.bases[draft.from])} — 詳細`}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {RUNNER_DETAIL.map((r) => (
                <Btn key={r.k} tone={r.out ? "warn" : "ghost"} onClick={() => onRunnerWhy(r)}>{r.l}</Btn>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
              ボークはランナー全員が1つ進みます
            </div>
          </>
        )}

        {mode === "runner-far" && (
          <>
            <div style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 15 }}>
              {question.text}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {question.options.map((o) => (<Btn key={o.to} onClick={() => onRunnerFar(o)}>{o.label}</Btn>))}
            </div>
          </>
        )}

        {mode === "zone" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>打球が飛んだ場所は</div>
            <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.line}` }}>
              <FieldPicker onPick={onZone} />
            </div>
          </>
        )}

        {mode === "result" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>{zoneName(draft.zone, draft.zone2)}への打球 — 結果は</div>
            {RESULT_GROUPS.map((g) => (
              <div key={g.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>{g.label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {g.items.map((r) => (<Btn key={r.k} tone={g.tone} onClick={() => onResult(r.k)}>{r.l}</Btn>))}
                </div>
              </div>
            ))}
            <Btn tone="warn" onClick={() => { tap(); setMode("detail"); }}>詳細</Btn>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              死球・犠打・振り逃げ・エラーの種類など。あとで決める場合もこちら
            </div>
          </>
        )}

        {mode === "batted" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>
              {zoneName(draft.zone, draft.zone2)}への{draft.result} — 打球は
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {BATTED_KINDS.map((k) => (<Btn key={k.k} onClick={() => onBatted(k.k)}>{k.l}</Btn>))}
              <Btn tone="ghost" onClick={() => onBatted(null)}>書かない</Btn>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
              スコアブックでは数字に線を添えて書き分けます（ゴロ＝下に凵／フライ＝上に⌐／ライナー＝上に横線）
            </div>
          </>
        )}

        {mode === "detail" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>{zoneName(draft.zone, draft.zone2)}への打球 — 詳細</div>
            {DETAIL_GROUPS.map((g) => (
              <div key={g.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>{g.label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {g.items.map((r) => (<Btn key={r.k} tone={g.tone} onClick={() => onResult(r.k)}>{r.l}</Btn>))}
                </div>
              </div>
            ))}
          </>
        )}

        {mode === "hold-note" && (
          <>
            <div style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 15 }}>
              {draft.zone == null ? "あとで決める" : `${zoneName(draft.zone, draft.zone2)}への打球 — あとで決める`}
              <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
                何が起きたか、覚えているうちに残してください。空のままでも記録できます。
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {HOLD_PRESETS.map((p) => (
                <button key={p} onClick={() => { tap(); setNote((n) => (n ? n + "／" + p : p)); }}
                  style={{ borderRadius: 99, padding: "8px 12px", background: C.card, border: `1.5px solid ${C.line}`, color: C.ink, fontSize: 13 }}>
                  {p}
                </button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="自由に書けます（音声入力も使えます）"
              style={{ width: "100%", borderRadius: 8, padding: "8px 12px", marginBottom: 12, background: C.card, border: `2px solid ${C.line}`, color: C.ink, fontSize: 16 }} />
            <Btn onClick={() => { tap(); commit({ t: "inplay", zone: draft.zone, result: "保留", note: note.trim() }); setNote(""); }}>
              記録して進む
            </Btn>
          </>
        )}

        {mode === "fielders" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>
              {seqFor === "runner"
                ? `${draft.from === "all" ? "ランナー" : `${BASE[draft.from]}ランナー`} ─ ${draft.reason.l}。送球の順`
                : "送球の順"}
            </div>
            <div style={{ background: C.card, border: `2px solid ${C.ink}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
                {fieldersNotation(seq) || "—"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {seq.f.map((n, i) => (
                  <button key={i} onClick={() => seqError(i)}
                    style={{
                      minHeight: 44, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: seq.errorAt === i ? C.red : C.card, color: seq.errorAt === i ? "#fff" : C.sub,
                      border: `2px solid ${seq.errorAt === i ? C.red : C.line}`,
                    }}>
                    {POS[n]}{seq.errorAt === i ? " エラー" : ""}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
                野手を押すと、その人のエラーになります
              </div>
              {seq.errorAt != null && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {[["T", "高投"], ["⊥", "低投"]].map(([k, l]) => (
                    <button key={k} onClick={() => seqKind(k)}
                      style={{
                        minHeight: 44, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: seq.kind === k ? C.ink : C.card, color: seq.kind === k ? "#fff" : C.ink,
                        border: `2px solid ${seq.kind === k ? C.ink : C.line}`,
                      }}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>送球先を押して足す</div>
            <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.line}`, marginBottom: 10 }}>
              <FieldPicker onPick={seqAdd} gaps={false} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 8 }}>
              <SmallBtn tone="warn" onClick={seqDrop}>最後を消す</SmallBtn>
              <Btn onClick={seqDone}>決定</Btn>
            </div>
          </>
        )}

        {mode === "moves" && (
          <>
            <div style={{ fontSize: 15, marginBottom: 2 }}>
              {draft.zone == null ? draft.result
                : `${zoneName(draft.zone, draft.zone2)}への打球 ─ ${draft.batted ? draft.batted + "の" : ""}${draft.result}`}
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
              ランナーの行き先。このままでよければ下を押す
            </div>
            {[2, 1, 0].filter((i) => state.bases[i] != null).map((i) => (
              <MoveRow key={i}
                label={`${BASE[i]}ランナー #${uniformOf(state.bases[i])}`}
                options={moveOptions(state, i)}
                value={(draft.moves.find((m) => m.from === i) || {}).to}
                onPick={(to) => setMove(i, to)} />
            ))}
            <MoveRow label={`バッター #${batterNum(state)}`}
              options={moveOptions(state, -1)}
              value={(draft.moves.find((m) => m.from === -1) || {}).to}
              onPick={(to) => setMove(-1, to)} />
            {draft.zone != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
                <span style={{ fontSize: 12, color: C.sub }}>守備</span>
                <b style={{ fontFamily: MONO, fontSize: 16 }}>
                  {fieldersNotation(draft.fielders ? { f: draft.fielders, errorAt: draft.errorAt, kind: draft.errorKind }
                    : draft.zone2 != null ? { f: [], errorAt: null, kind: "" }
                    : defaultFielders(draft.zone, draft.result, draft.moves)) || "—"}
                </b>
                <div style={{ marginLeft: "auto" }}><SmallBtn onClick={openSeq}>直す</SmallBtn></div>
              </div>
            )}
            {movesErr && <div style={{ color: C.red, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{movesErr}</div>}
            <Btn onClick={commitMoves}>この内容で記録する</Btn>
          </>
        )}

        {mode === "question" && (
          <>
            <div style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 15 }}>
              {question.text}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {question.options.map((o) => (<Btn key={o} onClick={() => onAnswer(o)}>{o}</Btn>))}
            </div>
          </>
        )}
      </div>

      {/* 操作履歴 */}
      <div style={{ padding: "0 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Btn tone="ghost" onClick={undo} disabled={mode === "pitch" && !events.length}>1つ戻す</Btn>
          <Btn tone={pendCount > 0 ? "warn" : "ghost"} onClick={() => setShowSheet(true)}>
            選手交代{pendCount > 0 ? `／保留${pendCount}` : ""}
          </Btn>
        </div>
        <div style={{ fontSize: 11, color: C.dim, margin: "4px 0 8px" }}>{backTarget()}</div>

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", maxHeight: 190, overflowY: "auto" }}>
          {state.log.length === 0
            ? <div style={{ fontSize: 13, color: C.dim }}>まだ記録がありません。</div>
            : [...state.log].reverse().map((l, i) => {
              const can = l.src != null;
              const open = rewindTo === l.src && can;
              return (
                <div key={i} style={{ borderBottom: i === state.log.length - 1 ? "none" : `1px dotted ${C.line}` }}>
                  <div onClick={() => can && setRewindTo(open ? null : l.src)}
                    style={{ fontSize: 13, padding: "5px 0", color: l.pending ? C.red : C.ink, cursor: can ? "pointer" : "default" }}>
                    {l.text}
                  </div>
                  {open && (
                    <div style={{ padding: "0 0 8px" }}>
                      <button onClick={() => rewind(l.src)}
                        style={{ width: "100%", minHeight: 44, borderRadius: 8, background: C.card, color: C.red, border: `2px solid ${C.red}`, fontSize: 14, fontWeight: 600 }}>
                        ここから後の{events.length - l.src}件を取り消す
                      </button>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                        この行を含めて、あとの記録が消えます
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
          記録の行を押すと、そこまでまとめて戻せます
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[
            { l: "書き出す", f: exportJson },
            { l: "読み込む", f: () => fileRef.current && fileRef.current.click() },
            { l: "試合情報", f: () => setShowSetup(true) },
            { l: "新しい試合", f: newGame },
          ].map((b) => (
            <button key={b.l} onClick={b.f}
              style={{ flex: 1, minHeight: 44, borderRadius: 8, background: "transparent", border: `2px solid ${C.line}`, color: C.sub, fontSize: 13 }}>
              {b.l}
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importJson(f); e.target.value = ""; }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <Btn tone="ghost" onClick={() => setShowSheetPaper(true)}>スコアブック</Btn>
          <Btn tone={setup.endedAt ? "ghost" : "warn"}
            onClick={() => {
              if (setup.endedAt) { setSetup({ ...setup, endedAt: null }); setNotice("試合終了を取り消しました。"); return; }
              setSetup({ ...setup, endedAt: new Date().toISOString() });
              setNotice("試合終了として記録しました。");
              setShowSheetPaper(true);
            }}>
            {setup.endedAt ? `終了 ${HHMM(setup.endedAt)}` : "試合終了"}
          </Btn>
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
          開始 {HHMM(setup.startedAt) || "—"}
          {setup.endedAt ? `／終了 ${HHMM(setup.endedAt)}` : "／試合終了を押すと終了時刻を記録します"}
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
          イベント {events.length} 件 ／ 自動保存済み。閉じても続きから再開できます
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", width: "100%", display: "flex", justifyContent: "center", background: C.paper, fontFamily: "system-ui, -apple-system, 'Hiragino Sans', sans-serif", color: C.ink }}>
      <div style={{ width: "100%", maxWidth: 448, display: "flex", flexDirection: "column", background: C.paper }}>
        {children}
      </div>
    </div>
  );
}
