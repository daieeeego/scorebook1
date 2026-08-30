/* 書き出したJSONを、記法規約のセル単位に並べ直す。手書きのスコアブックと
   1打席ずつ突き合わせるための道具。

   使い方:  node tools/notation-sheet.mjs <書き出したJSON>

   端末で扱える文字に置き換えているため、記号は原本と厳密には一致しない。
   ゴロ・フライ・ライナーの補助線（凵／⌐／横線）は ⌄ ⌃ ‾ で代用している。 */
import fs from "fs";
import { initialState, applyEvent, batKey, batterId, batterOrder, uniformOf, POS, fieldersOf, fieldersNotation }
  from "../src/rules.js";

const PITCH = { "ボール":"●", "見逃し":"○", "空振り":"×", "ファール":"―", "ストライク":"○", "ファウル":"―" };
const GRD = (z) => `${z}⌄`;            // ゴロ（本来は数字の下に凵）
const FLY = (z) => `${z}⌃`;            // フライ（本来は数字の上に⌐）
const LIN = (z) => `${z}‾`;            // ライナー（本来は数字の上に横線）
const HIT = (t) => `(${t})`;           // 内野安打の弧

function resultMark(r, zone, answer) {
  const z = zone == null ? "" : zone;
  switch (r) {
    case "安打":        return z && z <= 6 ? HIT(GRD(z)) : `${z}`;
    case "二塁打":      return `${z} 2B`;
    case "三塁打":      return `${z} 3B`;
    case "本塁打":      return `${z} HR`;
    case "ランニングホームラン": return `R.H ${z}`;
    case "バントヒット": return `B ${z}`;
    case "テキサスヒット": return `T.${z}`;
    case "失策で出塁":   return `${z}E`;
    case "ゴロエラー":   return `${GRD(z)}E`;
    case "フライエラー": return `${FLY(z)}E`;
    case "悪送球（高投）": return `${z}ET`;
    case "悪送球（低投）": return `${z}E⊥`;
    case "ゴロアウト":
      if (answer === "ダブルプレー" || answer === "併殺") return `${GRD(z)} DP`;
      if (answer === "フォースアウト（二塁）" || answer === "二塁でアウト") return `${GRD(z)}（走者FO）`;
      return GRD(z);
    case "フライアウト": return FLY(z);
    case "ライナーアウト": return LIN(z);
    case "野手選択":     return `${z}FC`;
    case "犠牲フライ":   return `△${FLY(z)}`;
    case "犠牲バント":   return `△${GRD(z)}`;
    case "ファールフライ": return `${z}F`;
    case "インフィールドフライ": return "FF";
    case "トリプルプレー": return `${z} TP`;
    case "3バント失敗":  return "K³";
    case "死球":        return "DB";
    case "敬遠四球":     return "B'";
    case "振り逃げ":     return "Ϗ";
    case "打撃妨害":     return "IF";
    case "走塁妨害":     return "OB";
    case "保留":        return "⚠保留";
    default:            return r;
  }
}
const RUNNER_MARK = { "打球で進塁":"進", "盗塁":"S", "暴投":"WP", "捕逸":"PS", "けん制の悪送球":"けん制E",
  "盗塁失敗":"TO", "けん制でアウト":"けん制TO", "ボーク":"BK", "タッチアウト":"TO",
  "守備妨害":"IP", "走塁妨害":"OB", "フォースアウト":"FO" };

const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let s = initialState(d.setup);
const cells = new Map();                      // key -> セル
const keyOf = (st, pid) => `${st.inning}${st.isTop?"表":"裏"}|${pid}`;
const cell = (st, pid, order) => {
  const k = keyOf(st, pid);
  if (!cells.has(k)) cells.set(k, { inning: st.inning, isTop: st.isTop, side: batKey(st),
    order, num: uniformOf(pid), pitches: [], result: "", runner: [], scored: false });
  return cells.get(k);
};

for (const e of d.events) {
  const before = s;
  const bid = batterId(before);
  const ord = batterOrder(before);
  if (e.t === "pitch") {
    const c = cell(before, bid, ord);
    c.pitches.push(PITCH[e.r] ?? e.r);
    const after = applyEvent(before, e);
    if (after.balls === 0 && after.strikes === 0 && before.outs !== after.outs) c.result = "K/SO";
    else if (after.balls === 0 && after.strikes === 0 && !c.result) c.result = "H";  // 四球
    s = after;
    continue;
  }
  if (e.t === "inplay") {
    const c = cell(before, bid, ord);
    c.result = resultMark(e.result, e.zone, e.answer);
    const fx = fieldersNotation(fieldersOf(e));
    if (fx && fx !== String(e.zone)) c.result = c.result.replace(String(e.zone), fx);
    if (e.note) c.result += ` [${e.note}]`;
    s = applyEvent(before, e);
    continue;
  }
  if (e.t === "runner") {
    const from = e.from;
    const rid = from === "all" ? null : before.bases[from];
    const mark = RUNNER_MARK[e.reason] ?? e.reason;
    const via = e.fielders ? `${e.fielders.join("-")}` : "";
    if (rid) {
      // 走者の記録は、その走者が出塁した打席のセルへ入れる
      let target = null;
      for (const [k, c] of [...cells].reverse()) if (k.endsWith(`|${rid}`)) { target = c; break; }
      (target ?? cell(before, rid, 0)).runner.push(via ? `${via}${mark}` : mark);
    } else {
      cell(before, bid, ord).runner.push(`${mark}(全)`);
    }
    s = applyEvent(before, e);
    continue;
  }
  s = applyEvent(before, e);
}

// 得点した走者に印
for (const l of s.log) {
  const m = l.text.match(/((?:#[^\s・]+・)*#[^\s・]+)生還/g);
  if (!m) continue;
  const nums = m.flatMap((x) => x.replace("生還","").split("・").map((y) => y.replace("#","")));
  for (const num of nums) {
    for (const [, c] of [...cells].reverse()) if (c.num === num && !c.scored) { c.scored = true; break; }
  }
}

const name = (side) => d.setup.teamName[side];
console.log("打席セル一覧（記法規約の記号に置き換え）");
console.log("凡例  ⌄=ゴロ ⌃=フライ ‾=ライナー ( )=内野安打の弧 ●ボール ○見逃し ×空振り ―ファール ●印=得点\n");
let cur = "";
for (const [, c] of cells) {
  const head = `${c.inning}回${c.isTop?"表":"裏"} ${name(c.side)}`;
  if (head !== cur) { console.log(`\n── ${head} ──`); cur = head; }
  const pit = c.pitches.join("") || "－";
  const run = c.runner.length ? `  走者:${c.runner.join(",")}` : "";
  const sc = c.scored ? "  ●得点" : "";
  console.log(`  ${String(c.order).padStart(2)}番 #${c.num.padEnd(3)} 投球[${pit.padEnd(8)}] 結果 ${(c.result||"（未確定）").padEnd(18)}${run}${sc}`);
}
