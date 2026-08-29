import { useState, useEffect, useMemo, useRef } from "react";
import {
  POS, POSITIONS, BASE, SIDES, HOLD_PRESETS, PITCH_OPTIONS, RUNNER_REASONS, RESULT_GROUPS, RESOLVABLE,
  deriveState, questionFor, stateBefore, statsFrom, migrate, toSlots,
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

const FIELDERS = [
  { n: 1, x: 150, y: 152 }, { n: 2, x: 150, y: 226 }, { n: 3, x: 224, y: 130 },
  { n: 4, x: 190, y: 100 }, { n: 5, x: 76, y: 130 }, { n: 6, x: 110, y: 100 },
  { n: 7, x: 58, y: 52 }, { n: 8, x: 150, y: 34 }, { n: 9, x: 242, y: 52 },
];

function FieldPicker({ onPick }) {
  return (
    <svg viewBox="0 0 300 250" style={{ width: "100%", maxHeight: 280 }}>
      <path d="M150 214 L300 64 L300 0 L0 0 L0 64 Z" fill={C.field} />
      <path d="M150 214 L60 124 L150 34 L240 124 Z" fill="none" stroke={C.line} strokeWidth="2" />
      <path d="M150 214 L20 84 M150 214 L280 84" stroke={C.line} strokeWidth="1.5" fill="none" />
      {FIELDERS.map((f) => (
        <g key={f.n} onClick={() => onPick(f.n)} style={{ cursor: "pointer" }}>
          <circle cx={f.x} cy={f.y} r="24" fill={C.card} stroke={C.ink} strokeWidth="1.6" />
          <text x={f.x} y={f.y + 7} textAnchor="middle" fontSize="19" fill={C.ink} fontWeight="600">{POS[f.n]}</text>
        </g>
      ))}
    </svg>
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

      {SIDES.map((side) => (
        <div key={side} style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 12, color: C.sub }}>{side === "away" ? "先攻（相手チーム）" : "後攻（自チーム）"}</label>
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
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 16 }}>
        {stats.pitchers.length === 0
          ? <div style={{ padding: 10, fontSize: 13, color: C.dim }}>まだ投球がありません。</div>
          : stats.pitchers.map((p) => (
            <div key={p.playerId} style={row}>
              <b style={{ fontFamily: MONO }}>#{p.uniformNumber}</b>
              <span style={{ fontSize: 12, color: C.sub }}>{state.setup.teamName[p.side]}</span>
              <span style={{ fontSize: 12, color: C.sub }}>{p.halves}イニング</span>
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
                <span style={{ fontSize: 12, color: C.sub }}>{p.plateAppearances}打席</span>
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
  const [target, setTarget] = useState(null);   // { index, zone }
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
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>{POS[target.zone]}への打球 — 結果は</div>
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
            <button key={l.src} onClick={() => setTarget({ index: l.src, zone: ev.zone })}
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

  const commit = (ev) => {
    setEvents((e) => [...e, ev]);
    setPlays((p) => p + 1);
    setTapsThis(0);
    setMode("pitch");
    setDraft(null);
    setQuestion(null);
  };

  /* ベンチ操作（交代・保留の確定）はプレー入力ではないため計測に含めない */
  const commitBench = (ev) => setEvents((e) => [...e, ev]);

  const onPitch = (r) => {
    tap();
    setEvents((e) => [...e, { t: "pitch", r }]);
    setPlays((p) => p + 1);
    setTapsThis(0);
  };

  const runnersOnBase = state.bases
    .map((r, i) => (r != null ? { base: i, num: uniformOf(r) } : null))
    .filter(Boolean);

  const onRunnerStart = () => {
    tap();
    if (runnersOnBase.length === 1) { setDraft({ from: runnersOnBase[0].base }); setMode("runner-why"); }
    else setMode("runner-who");
  };
  const onRunnerWho = (base) => { tap(); setDraft({ from: base }); setMode("runner-why"); };
  const onRunnerWhy = (r) => { tap(); commit({ t: "runner", from: draft.from, reason: r.k, out: r.out }); };

  const onZone = (z) => { tap(); setDraft({ zone: z }); setMode("result"); };

  const onResult = (r) => {
    tap();
    if (r === "保留") { setDraft({ ...draft, result: r }); setNote(""); setMode("hold-note"); return; }
    const q = questionFor(state, draft.zone, r);
    if (q) { setDraft({ ...draft, result: r }); setQuestion(q); setMode("question"); }
    else commit({ t: "inplay", zone: draft.zone, result: r });
  };

  const onAnswer = (a) => { tap(); commit({ t: "inplay", zone: draft.zone, result: draft.result, answer: a }); };

  const backTarget = () => {
    switch (mode) {
      case "zone": return "「打った」を取り消す";
      case "result": return "打球方向の選択に戻る";
      case "question": return "結果の選択に戻る";
      case "hold-note": return "結果の選択に戻る";
      case "runner-who": return "「走者が動いた」を取り消す";
      case "runner-why": return runnersOnBase.length === 1 ? "「走者が動いた」を取り消す" : "走者の選択に戻る";
      default: {
        if (!events.length) return "戻せる記録がありません";
        const last = events[events.length - 1];
        if (last.t === "sub") return last.kind === "守備位置変更" ? "直前の守備位置変更を取り消す" : `直前の${last.kind}を取り消す`;
        if (last.t === "resolve") return "保留の確定を取り消す";
        if (last.t === "pitch") return "直前の投球を取り消す";
        if (last.t === "runner") return "走者が動いた理由の選択に戻る";
        if (last.result === "保留") return "メモの入力に戻る";
        if (last.answer != null) return "走者の確認に戻る";
        return "結果の選択に戻る";
      }
    }
  };

  const undo = () => {
    if (mode !== "pitch") {
      tap();
      if (mode === "zone") setMode("pitch");
      else if (mode === "result") { setMode("zone"); setDraft(null); }
      else if (mode === "question") { setQuestion(null); setDraft({ zone: draft.zone }); setMode("result"); }
      else if (mode === "hold-note") { setNote(""); setDraft({ zone: draft.zone }); setMode("result"); }
      else if (mode === "runner-who") setMode("pitch");
      else if (mode === "runner-why") { setDraft(null); setMode(runnersOnBase.length === 1 ? "pitch" : "runner-who"); }
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
        setDraft({ zone: last.zone, result: last.result });
        setQuestion(questionFor(prev, last.zone, last.result));
        setMode("question");
      } else if (last.result === "保留") {
        setDraft({ zone: last.zone, result: "保留" }); setNote(last.note || ""); setMode("hold-note");
      } else {
        setDraft({ zone: last.zone }); setQuestion(null); setMode("result");
      }
      return;
    }
    if (last.t === "runner") { setDraft({ from: last.from }); setQuestion(null); setMode("runner-why"); return; }
    setDraft(null); setQuestion(null); setMode("pitch");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ setup, events }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `score_${setup.date}_${setup.teamName.home}_vs_${setup.teamName.away}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
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
            {runnersOnBase.length > 0 && (
              <div style={{ marginTop: 8 }}><Btn tone="ghost" onClick={onRunnerStart}>走者が動いた</Btn></div>
            )}
          </>
        )}

        {mode === "runner-who" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>動いた走者は</div>
            <div style={{ display: "grid", gap: 8 }}>
              {runnersOnBase.map((r) => (
                <Btn key={r.base} tone="ghost" onClick={() => onRunnerWho(r.base)}>{BASE[r.base]}走者 #{r.num}</Btn>
              ))}
            </div>
          </>
        )}

        {mode === "runner-why" && (
          <>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>
              {BASE[draft.from]}走者 #{uniformOf(state.bases[draft.from])} が動いた理由は
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {RUNNER_REASONS.map((r) => (
                <Btn key={r.k} tone={r.out ? "warn" : "ghost"} onClick={() => onRunnerWhy(r)}>{r.l}</Btn>
              ))}
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
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>{POS[draft.zone]}への打球 — 結果は</div>
            {RESULT_GROUPS.map((g) => (
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
              {POS[draft.zone]}への打球 — あとで決める
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

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", maxHeight: 130, overflowY: "auto" }}>
          {state.log.length === 0
            ? <div style={{ fontSize: 13, color: C.dim }}>まだ記録がありません。</div>
            : [...state.log].reverse().map((l, i) => (
              <div key={i} style={{ fontSize: 13, padding: "3px 0", borderBottom: i === state.log.length - 1 ? "none" : `1px dotted ${C.line}`, color: l.pending ? C.red : C.ink }}>{l.text}</div>
            ))}
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
