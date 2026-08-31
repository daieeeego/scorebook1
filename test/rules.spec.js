import { describe, expect, it } from "vitest";

import {
  applyEvent,
  deriveState,
  deriveStats,
  inferSubKind,
  initialState,
  migrate,
  pendingPlays,
  pid,
  questionFor,
  stateBefore,
  statsFrom,
  toSlots,
  uniformOf,
  validateSub,
} from "../src/rules.js";
import {
  ball,
  ball4,
  basesAsNums,
  foul,
  inplay,
  makeSetup,
  play,
  repeat,
  resolve,
  runner,
  strike,
  strike3,
  sub,
} from "./helpers.js";

const setup = () => makeSetup();
const hit = (extra = {}) => inplay(8, "安打", extra);
const error = (extra = {}) => inplay(6, "失策で出塁", extra);
const threeStrikeouts = () => repeat(3, strike3).flat();

describe("FR-13 / FR-14: 初期盤面と選手識別", () => {
  it("表の攻撃から始まる", () => {
    expect(initialState(setup()).isTop).toBe(true);
  });

  it("一回から始まる", () => {
    expect(initialState(setup()).inning).toBe(1);
  });

  it("両チームの得点は0から始まる", () => {
    expect(initialState(setup()).score).toEqual({ away: 0, home: 0 });
  });

  it("背番号はチームを含むplayerIdになる", () => {
    expect(pid("home", 7)).toBe("home#7");
  });

  it("playerIdから背番号を取得できる", () => {
    expect(uniformOf("away#18")).toBe("18");
  });

  it("9人を9つの打順枠へ変換する", () => {
    expect(toSlots("away", [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9])).toHaveLength(9);
  });

  it("先発選手の登録は背番号をplayerIdとして保持する", () => {
    expect(toSlots("away", [7], [6])[0].entries[0].playerId).toBe("away#7");
  });
});

describe("FR-01: 1球ごとの投球結果", () => {
  it("ボールを1球記録するとボールカウントが1になる", () => {
    expect(play([ball()]).balls).toBe(1);
  });

  it("ストライクを1球記録するとストライクカウントが1になる", () => {
    expect(play([strike()]).strikes).toBe(1);
  });

  it("2ストライク後のファウルではストライクが増えない", () => {
    expect(play([strike(), strike(), foul()]).strikes).toBe(2);
  });
});

describe("§7.1-第2層 / FR-01: 三振の導出", () => {
  it("3ストライクでアウトが1つ増える", () => {
    expect(play(strike3()).outs).toBe(1);
  });

  it("三振後は次打者へ替わる", () => {
    expect(play(strike3()).order.away).toBe(1);
  });

  it("三振後はカウントをリセットする", () => {
    expect(play(strike3())).toEqual(expect.objectContaining({ balls: 0, strikes: 0 }));
  });
});

describe("§7.1-第2層 / FR-04: 四球と押し出しの導出", () => {
  it("四球で打者走者が一塁へ到達する", () => {
    expect(basesAsNums(play(ball4()))).toEqual([1, null, null]);
  });

  it("四球後は次打者へ替わる", () => {
    expect(play(ball4()).order.away).toBe(1);
  });

  it("四球ではアウトが増えない", () => {
    expect(play(ball4()).outs).toBe(0);
  });

  it("満塁での四球は三塁走者を生還させる", () => {
    expect(play(repeat(4, ball4).flat()).score.away).toBe(1);
  });

  it("満塁での四球は各走者を一つずつ押し出す", () => {
    expect(basesAsNums(play(repeat(4, ball4).flat()))).toEqual([4, 3, 2]);
  });
});

describe("§7.1-第2層 / FR-02〜FR-04: インプレーの導出", () => {
  it("安打で打者走者が一塁へ到達する", () => {
    expect(basesAsNums(play([hit()]))).toEqual([1, null, null]);
  });

  it("失策で出塁した打者走者が一塁へ到達する", () => {
    expect(basesAsNums(play([error()]))).toEqual([1, null, null]);
  });

  it("三塁走者が本塁まで進むと得点になる", () => {
    const events = [hit(), runner(0, "盗塁"), runner(1, "盗塁"), hit({ answer: "本塁まで進んだ" })];
    expect(play(events).score.away).toBe(1);
  });

  it("打席結果の確定後は次打者へ替わる", () => {
    expect(play([hit()]).order.away).toBe(1);
  });

  it("打席結果の確定後はカウントをリセットする", () => {
    expect(play([ball(), strike(), hit()])).toEqual(expect.objectContaining({ balls: 0, strikes: 0 }));
  });
});

describe("§7.1-第2層 / FR-20: 3アウト時のイニング交代", () => {
  it("表で3アウトになると裏へ移る", () => {
    expect(play(threeStrikeouts()).isTop).toBe(false);
  });

  it("表から裏への交代ではイニング番号を維持する", () => {
    expect(play(threeStrikeouts()).inning).toBe(1);
  });

  it("裏で3アウトになると次の回へ進む", () => {
    expect(play([...threeStrikeouts(), ...threeStrikeouts()]).inning).toBe(2);
  });

  it("攻守交代時にアウトを0へ戻す", () => {
    expect(play(threeStrikeouts()).outs).toBe(0);
  });

  it("攻守交代時に走者を空にする", () => {
    expect(play([...ball4(), ...threeStrikeouts()]).bases).toEqual([null, null, null]);
  });
});

describe("§7.1-第1層 / §7.1-第3層: ゴロアウト時の質問", () => {
  it("一塁走者がいて2アウト未満なら走者の結果を尋ねる", () => {
    expect(questionFor(play([hit()]), 6, "ゴロアウト")?.text).toBe("一塁にいたランナーはどうなりましたか");
  });

  it("ゴロアウト時の選択肢を仕様の4項目に限定する", () => {
    expect(questionFor(play([hit()]), 6, "ゴロアウト")?.options).toEqual([
      "フォースアウト（二塁）",
      "ダブルプレー",
      "二塁へ進んだ",
      "一塁に留まった",
    ]);
  });

  it("一塁走者がいなければ走者の結果を尋ねない", () => {
    expect(questionFor(initialState(setup()), 6, "ゴロアウト")).toBeNull();
  });

  it("2アウトではゴロアウト後の一塁走者について尋ねない", () => {
    expect(questionFor(play([...strike3(), ...strike3(), ...ball4()]), 6, "ゴロアウト")).toBeNull();
  });
});

describe("§7.1-第1層 / §7.1-第3層: 安打・失策時の質問", () => {
  const runnerOnSecond = () => play([hit(), runner(0, "盗塁")]);

  it("二塁走者がいる安打では進塁先を尋ねる", () => {
    expect(questionFor(runnerOnSecond(), 8, "安打")?.text).toBe("二塁にいたランナーはどこまで進みましたか");
  });

  it("二塁走者がいる失策でも進塁先を尋ねる", () => {
    expect(questionFor(runnerOnSecond(), 6, "失策で出塁")?.text).toBe("二塁にいたランナーはどこまで進みましたか");
  });

  it("後位走者がいないときは二塁走者の3つの行き先を提示する", () => {
    expect(questionFor(runnerOnSecond(), 8, "安打")?.options).toEqual([
      "二塁に留まった",
      "三塁で止まった",
      "本塁まで進んだ",
    ]);
  });

  it("一二塁では二塁走者に二塁残留を提示しない", () => {
    const state = play([...ball4(), ...ball4()]);
    expect(questionFor(state, 8, "安打")?.options).toEqual(["三塁で止まった", "本塁まで進んだ"]);
  });
});

describe("§7.1-第3層 / FR-07: 走者単独プレー", () => {
  /* 未決: §7.1 第3層の表は「走者が動いた → 動いた理由は」を質問として挙げているが、
     実装ではこの行だけ questionFor を通らず RUNNER_REASONS 定数を UI が直接使っている。
     仕様を実装に合わせて表から外すか、実装を仕様に合わせて questionFor に足すかを
     決めるまで skip する。決定後に skip を外すこと。 */
  it.skip("走者が動いた理由は仕様の6項目から選ぶ", () => {
    expect(questionFor(play([hit()]), 0, "走者が動いた")?.options).toEqual([
      "盗塁",
      "暴投",
      "捕逸",
      "けん制の悪送球",
      "盗塁失敗",
      "けん制でアウト",
    ]);
  });

  it("盗塁成功で一塁走者が二塁へ進む", () => {
    expect(basesAsNums(play([hit(), runner(0, "盗塁")]))).toEqual([null, 1, null]);
  });

  it("盗塁失敗で走者が塁上から除かれる", () => {
    expect(basesAsNums(play([hit(), runner(0, "盗塁失敗", true)]))).toEqual([null, null, null]);
  });

  it("走者がアウトになるとアウトカウントが増える", () => {
    expect(play([hit(), runner(0, "盗塁失敗", true)]).outs).toBe(1);
  });
});

describe("FR-05 / FR-06: 保留プレー", () => {
  it("判断できないプレーを保留として記録できる", () => {
    expect(pendingPlays(play([inplay(6, "保留")]))).toHaveLength(1);
  });

  it("確定したプレーは保留一覧へ含めない", () => {
    expect(pendingPlays(play([hit()]))).toHaveLength(0);
  });

  it("保留プレーはメモが空でも記録できる", () => {
    expect(pendingPlays(play([inplay(6, "保留", { note: "" })]))).toHaveLength(1);
  });

  it("保留プレーの自由記述メモを保持する", () => {
    expect(pendingPlays(play([inplay(6, "保留", { note: "送球が重なって見えなかった" })]))[0].text).toContain(
      "送球が重なって見えなかった",
    );
  });
});

describe("§6.1 / FR-11 / FR-12: 追記型イベントと取り消し先", () => {
  it("resolveを追加しても対象の過去イベントを書き換えない", () => {
    const unresolved = inplay(6, "保留", { note: "あとで確認" });
    const events = [unresolved, resolve(0, "安打")];
    deriveState(events, setup());
    expect(events[0]).toBe(unresolved);
  });

  it("resolveの追記によって保留プレーを確定する", () => {
    const events = [inplay(8, "保留"), resolve(0, "安打")];
    expect(pendingPlays(deriveState(events, setup()))).toHaveLength(0);
  });

  it("stateBeforeは指定位置のイベントをまだ反映しない", () => {
    expect(stateBefore([ball(), strike()], setup(), 1).strikes).toBe(0);
  });

  it("stateBeforeは指定位置より前のイベントを反映する", () => {
    expect(stateBefore([ball(), strike()], setup(), 1).balls).toBe(1);
  });
});

describe("§6.4: applyEventの純粋性", () => {
  it("applyEventは引数のstateを変更しない", () => {
    const before = initialState(setup());
    const snapshot = structuredClone(before);
    applyEvent(before, ball());
    expect(before).toEqual(snapshot);
  });

  it("applyEventは新しいstateを返す", () => {
    const before = initialState(setup());
    expect(applyEvent(before, ball())).not.toBe(before);
  });
});

describe("FR-19: 投手の投球数", () => {
  it("表の投球をホーム先発投手に加算する", () => {
    expect(play([ball()]).pitchCount[pid("home", 11)]).toBe(1);
  });

  it("裏の投球をビジター先発投手に加算する", () => {
    const state = play([...threeStrikeouts(), ball()]);
    expect(state.pitchCount[pid("away", 1)]).toBe(1);
  });

  it("投球していない選手の投球数は0である", () => {
    expect(initialState(setup()).pitchCount[pid("home", 11)] ?? 0).toBe(0);
  });
});

describe("FR-02 / FR-03 / FR-20: ログと盤面", () => {
  it("異なる打球方向は異なる記録として導出される", () => {
    expect(play([inplay(9, "安打")]).log[0].text).not.toBe(play([inplay(8, "安打")]).log[0].text);
  });

  it("イベントを重ねるとseqが単調に増える", () => {
    expect(play([ball(), strike()]).seq).toBe(2);
  });

  it("現在打者の打席数を打席結果確定時に加算する", () => {
    expect(play([hit()]).plateAppearances[pid("away", 1)]).toBe(1);
  });
});

describe("§7.1-第1層: validateSubの交代制約", () => {
  const validPinchHitter = () => sub({ side: "away", order: 1, num: 20, kind: "代打" });

  it("未登録選手による現在打者の代打は妥当である", () => {
    expect(validateSub(initialState(setup()), validPinchHitter())).toBeNull();
  });

  it("1未満の打順は拒否する", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 0, num: 20, kind: "代打" }))).not.toBeNull();
  });

  it("9を超える打順は拒否する", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 10, num: 20, kind: "代打" }))).not.toBeNull();
  });

  it("背番号が空の交代は拒否する", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 1, num: "", kind: "代打" }))).not.toBeNull();
  });

  it("同じチームで出場中の選手は重複登録できない", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 1, num: 2, kind: "代打" }))).not.toBeNull();
  });

  it("塁上にいない打順の代走は拒否する", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 1, num: 20, kind: "代走", base: 1 }))).not.toBeNull();
  });

  it("代走の指定塁と対象走者の塁が違えば拒否する", () => {
    const state = play([hit()]);
    expect(validateSub(state, sub({ side: "away", order: 1, num: 20, kind: "代走", base: 2 }))).not.toBeNull();
  });

  it("退いたことのない先発選手のリエントリーは拒否する", () => {
    expect(validateSub(initialState(setup()), sub({ side: "away", order: 1, num: 1, kind: "リエントリー" }))).not.toBeNull();
  });

  it("交代出場後に退いた選手のリエントリーは拒否する", () => {
    const state = play([
      validPinchHitter(),
      sub({ side: "away", order: 1, num: 1, kind: "リエントリー" }),
    ]);
    expect(validateSub(state, sub({ side: "away", order: 1, num: 20, kind: "リエントリー" }))).not.toBeNull();
  });

  it("先発選手の元の打順と異なる枠へのリエントリーは拒否する", () => {
    const state = play([validPinchHitter()]);
    expect(validateSub(state, sub({ side: "away", order: 2, num: 1, kind: "リエントリー" }))).not.toBeNull();
  });

  it("先発選手の2回目のリエントリーは拒否する", () => {
    const state = play([
      validPinchHitter(),
      sub({ side: "away", order: 1, num: 1, kind: "リエントリー" }),
      sub({ side: "away", order: 1, num: 21, kind: "代打" }),
    ]);
    expect(validateSub(state, sub({ side: "away", order: 1, num: 1, kind: "リエントリー" }))).not.toBeNull();
  });
});

describe("§7.1-第1層: inferSubKindの文脈導出", () => {
  it("攻撃側の現在打者への交代を代打と推定する", () => {
    expect(inferSubKind(initialState(setup()), "away", 1)).toEqual({ kind: "代打" });
  });

  it("塁上の走者への交代を代走と推定する", () => {
    expect(inferSubKind(play([hit()]), "away", 1)).toEqual({ kind: "代走", base: 0 });
  });

  it("守備側の交代を守備交代と推定する", () => {
    expect(inferSubKind(initialState(setup()), "home", 1)).toEqual({ kind: "守備交代" });
  });
});

describe("FR-19 / 集計導出", () => {
  it("deriveStatsは導出盤面のstatsFromと同じ集計を返す", () => {
    const events = [ball(), strike(), hit()];
    expect(deriveStats(events, setup())).toEqual(statsFrom(deriveState(events, setup())));
  });

});

describe("FR-10: 保存データの移行", () => {
  it("現在形式のsetupとeventsを読み込める", () => {
    const saved = { setup: setup(), events: [ball()] };
    expect(migrate(saved)).toEqual({ ...saved, migrated: false });
  });

  it("保存データでない値は読み込まない", () => {
    expect(migrate(null)).toBeNull();
  });
});
