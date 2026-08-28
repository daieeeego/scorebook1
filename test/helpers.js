/* テスト用のフィクスチャ生成のみ。判定（assert）は一切置かない。
   ここに期待値を書くと、テストの根拠が仕様ではなくこのファイルになるため。 */

import { toSlots, deriveState, pid } from "../src/rules.js";

/** 既定の守備位置。1〜9番の打順に投手〜右翼を割り当てる */
const DEFAULT_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 試合設定を作る。
 * @param {object} [o]
 * @param {number[]} [o.awayNums]   ビジターの背番号9つ
 * @param {number[]} [o.homeNums]   ホームの背番号9つ
 * @param {number[]} [o.awayPositions]
 * @param {number[]} [o.homePositions]
 */
export function makeSetup(o = {}) {
  const awayNums = o.awayNums || [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const homeNums = o.homeNums || [11, 12, 13, 14, 15, 16, 17, 18, 19];
  return {
    date: "2026-08-28",
    venue: "テスト球場",
    teamName: { away: "ビジター", home: "ホーム" },
    lineup: {
      away: toSlots("away", awayNums, o.awayPositions || DEFAULT_POSITIONS),
      home: toSlots("home", homeNums, o.homePositions || DEFAULT_POSITIONS),
    },
  };
}

/** イベント列から状態を作る短縮形 */
export const play = (events, setup = makeSetup()) => deriveState(events, setup);

/* ---- イベントの短縮コンストラクタ ---- */
export const ball = () => ({ t: "pitch", r: "ボール" });
export const strike = () => ({ t: "pitch", r: "ストライク" });
export const foul = () => ({ t: "pitch", r: "ファウル" });

export const inplay = (zone, result, extra = {}) => ({ t: "inplay", zone, result, ...extra });
export const runner = (from, reason, out = false) => ({ t: "runner", from, reason, out });
export const sub = (o) => ({ t: "sub", ...o });
export const resolve = (target, result, answer) => ({ t: "resolve", target, result, answer });

/** n個並べる（四球=ball4() など） */
export const repeat = (n, f) => Array.from({ length: n }, f);
export const ball4 = () => repeat(4, ball);
export const strike3 = () => repeat(3, strike);

/** 背番号でIDを作る（bases の比較用） */
export { pid };

/** bases を背番号の配列に直す。null は null のまま */
export const basesAsNums = (state) =>
  state.bases.map((b) => (b == null ? null : Number(b.split("#")[1])));
