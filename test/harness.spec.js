/* テスト基盤が動いていることだけを確認する。
   ルールの検証はここではなく test/rules.spec.js（Codex が仕様から作成）で行う。 */

import { describe, it, expect } from "vitest";
import { initialState } from "../src/rules.js";
import { makeSetup, basesAsNums } from "./helpers.js";

describe("テスト基盤", () => {
  it("初期状態を生成できる", () => {
    const s = initialState(makeSetup());
    expect(s.inning).toBe(1);
    expect(s.isTop).toBe(true);
    expect(s.outs).toBe(0);
    expect(basesAsNums(s)).toEqual([null, null, null]);
  });
});
