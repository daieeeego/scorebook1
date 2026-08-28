import { useState, useEffect, useMemo } from "react";
import {
  POS, BASE, HOLD_PRESETS, RUNNER_REASONS, RESULT_GROUPS,
  deriveState, questionFor, batKey, batterNum, batterOrder,
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
  lineup: { away: [1, 2, 3, 4, 5, 6, 7, 8, 9], home: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
});

/* ---------------- 保存 ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.setup || !Array.isArray(d.events)) return null;
    return d;
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

function Setup({ initial, onStart }) {
  const [s, setS] = useState(initial || defaultSetup());
  const setNum = (side, i, v) => {
    const n = { ...s.lineup, [side]: s.lineup[side].map((x, j) => (j === i ? v : x)) };
    setS({ ...s, lineup: n });
  };
  const field = { background: C.card, border: `2px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 16, color: C.ink, width: "100%" };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>試合の設定</h1>
      <p style={{ fontSize: 13, color: C.sub, marginBottom: 16 }}>
        背番号だけ入れれば始められます。あとから直せます。
      </p>

      <label style={{ fontSize: 12, color: C.sub }}>日付</label>
      <input type="date" value={s.date} onChange={(e) => setS({ ...s, date: e.target.value })} style={{ ...field, marginBottom: 12 }} />

      <label style={{ fontSize: 12, color: C.sub }}>球場</label>
      <input value={s.venue} placeholder="任意" onChange={(e) => setS({ ...s, venue: e.target.value })} style={{ ...field, marginBottom: 16 }} />

      {["away", "home"].map((side) => (
        <div key={side} style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 12, color: C.sub }}>{side === "away" ? "先攻（相手チーム）" : "後攻（自チーム）"}</label>
          <input value={s.teamName[side]} onChange={(e) => setS({ ...s, teamName: { ...s.teamName, [side]: e.target.value } })} style={{ ...field, marginBottom: 8 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {s.lineup[side].map((num, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: C.dim, width: 26 }}>{i + 1}番</span>
                <input type="number" inputMode="numeric" value={num}
                  onChange={(e) => setNum(side, i, e.target.value.replace(/\D/g, "").slice(0, 2))}
                  style={{ ...field, padding: "8px", textAlign: "center", fontFamily: MONO }} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <Btn onClick={() => onStart(s)}>この内容で記録を始める</Btn>
      <p style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>
        氏名は登録しません。個人情報を端末に残さないためです。
      </p>
    </div>
  );
}

/* ---------------- 本体 ---------------- */

export default function App() {
  const saved = useMemo(() => load(), []);
  const [setup, setSetup] = useState(saved ? saved.setup : null);
  const [events, setEvents] = useState(saved ? saved.events : []);
  const [mode, setMode] = useState("pitch");
  const [draft, setDraft] = useState(null);
  const [question, setQuestion] = useState(null);
  const [note, setNote] = useState("");
  const [taps, setTaps] = useState(0);
  const [plays, setPlays] = useState(0);
  const [tapsThis, setTapsThis] = useState(0);
  const [showSetup, setShowSetup] = useState(false);

  /* 1操作ごとに自動保存。試合中に閉じても消えない */
  useEffect(() => {
    if (setup) save({ setup, events, savedAt: new Date().toISOString() });
  }, [setup, events]);

  const state = useMemo(() => (setup ? deriveState(events, setup) : null), [events, setup]);

  if (!setup || showSetup) {
    return (
      <Shell>
        <Setup initial={setup} onStart={(s) => { setSetup(s); setShowSetup(false); }} />
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

  const onPitch = (r) => {
    tap();
    setEvents((e) => [...e, { t: "pitch", r }]);
    setPlays((p) => p + 1);
    setTapsThis(0);
  };

  const runnersOnBase = state.bases.map((r, i) => (r != null ? { base: i, num: r } : null)).filter(Boolean);

  const onRunnerStart = () => {
    tap();
    if (runnersOnBase.length === 1) { setDraft({ from: runnersOnBase[0].base }); setMode("runner-why"); }
    else setMode("runner-who");
  };
  const onRunnerWho = (base) => { tap(); setDraft({ from: base }); setMode("runner-why"); };
  const onRunnerWhy = (r) => { tap(); commit({ t: "runner", from: draft.from, reason: r.label, out: r.out }); };

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
    setPlays((p) => Math.max(0, p - 1));
    setTapsThis(0);

    /* 打席結果は3つの選択を1イベントにまとめているため、
       削除で終わらせず直前の選択画面まで戻す */
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
    setTaps(0); setPlays(0); setTapsThis(0);
    localStorage.removeItem(SAVE_KEY);
  };

  const bk = batKey(state);
  const avg = plays > 0 ? (taps / plays).toFixed(2) : "—";

  return (
    <Shell>
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

      {/* 常時表示 */}
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
            投球数<br />
            <span style={{ fontFamily: MONO, fontSize: 18, color: C.ink }}>{state.pitches[state.isTop ? "home" : "away"]}</span>
          </div>
        </div>
      </div>

      {/* 操作 */}
      <div style={{ flex: 1, padding: 16 }}>
        {mode === "pitch" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              <Btn tone="ghost" onClick={() => onPitch("ボール")}>ボール</Btn>
              <Btn tone="ghost" onClick={() => onPitch("ストライク")}>ストライク</Btn>
              <Btn tone="ghost" onClick={() => onPitch("ファウル")}>ファウル</Btn>
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
              {BASE[draft.from]}走者 #{state.bases[draft.from]} が動いた理由は
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {RUNNER_REASONS.map((r) => (
                <Btn key={r.label} tone={r.out ? "warn" : "ghost"} onClick={() => onRunnerWhy(r)}>{r.label}</Btn>
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
        <Btn tone="ghost" onClick={undo} disabled={mode === "pitch" && !events.length}>1つ戻す</Btn>
        <div style={{ fontSize: 11, color: C.dim, margin: "4px 0 8px" }}>{backTarget()}</div>

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", maxHeight: 130, overflowY: "auto" }}>
          {state.log.length === 0
            ? <div style={{ fontSize: 13, color: C.dim }}>まだ記録がありません。</div>
            : [...state.log].reverse().map((l, i) => (
              <div key={i} style={{ fontSize: 13, padding: "3px 0", borderBottom: i === state.log.length - 1 ? "none" : `1px dotted ${C.line}`, color: l.includes("⚠") ? C.red : C.ink }}>{l}</div>
            ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={exportJson} style={{ flex: 1, minHeight: 44, borderRadius: 8, background: "transparent", border: `2px solid ${C.line}`, color: C.sub, fontSize: 14 }}>
            書き出す
          </button>
          <button onClick={() => setShowSetup(true)} style={{ flex: 1, minHeight: 44, borderRadius: 8, background: "transparent", border: `2px solid ${C.line}`, color: C.sub, fontSize: 14 }}>
            設定
          </button>
          <button onClick={newGame} style={{ flex: 1, minHeight: 44, borderRadius: 8, background: "transparent", border: `2px solid ${C.line}`, color: C.sub, fontSize: 14 }}>
            新しい試合
          </button>
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
