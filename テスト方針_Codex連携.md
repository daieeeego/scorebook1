# テスト方針（Claude 実装 / Codex 検証）

作成日: 2026-08-28

## 1. 役割分担

| 担当 | 範囲 |
|---|---|
| Claude | 要件定義、実装（`src/`）、テストが落ちた箇所の修正 |
| Codex | `test/` の作成。**仕様書のみを根拠とし、実装は見ない** |
| Stryker | テストの assert が緩くないかを機械的に測る |

**なぜ実装を見せないか**：実装者がテストを書くと、仕様ではなく実装の分岐をなぞるテストになる。
Claude が仕様を誤解していた場合、その誤解ごと追認されて検証にならない。

## 2. テスト対象

`src/rules.js` のみ。純粋関数だけで構成され、React も DOM も介在しないため
`environment: "node"` で完結する。品質リスクはほぼこの1ファイルに集中している。

`src/App.jsx` は対象外（Phase 1 では手動確認とする）。

## 3. 実行

```bash
npm test          # 1回実行
npm run test:watch
npm run mutate    # ミューテーションテスト（rules.js のみ）
```

CI は `.github/workflows/ci.yml`（PR）と `deploy.yml`（main への push）の
両方で `npm test` を通す。**テストが落ちると GitHub Pages へ公開されない。**

## 4. Codex への依頼（第1パス：仕様からテストを書く）

`codex` CLI 未導入の場合：

```bash
npm i -g @openai/codex
codex login
```

リポジトリ直下で以下を実行する。

```
codex exec "test/rules.spec.js を作れ。

【根拠にしてよい資料】
  要件定義/要件定義_少年野球スコアブックアプリ_v0.3.md の 5章・6章・7章
  test/helpers.js（フィクスチャ生成のみ。判定は入っていない）

【禁止】
  src/rules.js と src/App.jsx を開くこと。
  実装を読むと仕様ではなく実装をなぞるテストになり、検証にならない。

【対象APIの契約】
  initialState(setup) -> state
  applyEvent(state, event) -> newState      // 純粋関数。state は変更しない
  deriveState(events, setup) -> state        // resolve を反映してから畳み込む
  stateBefore(events, setup, index) -> state // index 直前の盤面
  questionFor(state, zone, result) -> {text, options} | null
  validateSub(state, sub) -> string | null   // null なら妥当
  inferSubKind(state, side, order) -> {kind, base?}
  statsFrom(state) / deriveStats(events, setup) -> {pitchers, players}
  pendingPlays(state) -> 未確定の保留プレー
  migrate(saved) -> {setup, events, migrated} | null
  toSlots(side, nums, positions) / pid(side, num) / uniformOf(playerId)

  state = {
    inning, isTop, outs, bases:[一塁,二塁,三塁], balls, strikes,
    order:{away,home}, score:{away,home},
    lineup:{away:[slot], home:[slot]},
    pitchCount:{playerId:数}, halves:{playerId:['1表',...]},
    plateAppearances:{playerId:数}, log:[{seq,src,inning,isTop,text,pending}],
    seq, setup
  }
  slot  = { order, entries:[entry] }
  entry = { playerId, position, entryType, enteredAtSeq, exitedAtSeq }
  bases の各要素は playerId（'home#7' 形式）または null

  event =
    {t:'pitch',  r:'ボール'|'ストライク'|'ファウル'}
  | {t:'inplay', zone:1..9, result, answer?, note?}
  | {t:'runner', from:0|1|2, reason, out:boolean}
  | {t:'sub',    side, order, num, position?, kind, base?, moves?}
  | {t:'resolve',target:イベント位置, result, answer?}

【網羅すべき範囲】
  §7.1 第1層（制約）  : validateSub の全エラー条件、questionFor が返す options の中身
  §7.1 第2層（導出）  : 押し出し、打者走者の一塁到達、三塁走者の生還、
                        三振・四球のアウトと打者交代、3アウトでのイニング交代
  §7.1 第3層（質問）  : 表の3行それぞれ
  §5.1〜5.4          : FR-01〜FR-21 のうち『済』のもの
  §6.1               : 過去イベントを書き換えないこと（resolve の追記で確定する）
  不変性             : applyEvent が引数の state を変更しないこと

【書き方】
  vitest。describe に要件ID（FR-xx / §7.1-第N層）を含める。
  1テスト1事実。複数の assert を1テストに詰めない。
  期待値は仕様書の記述から導き、実装の出力を貼り付けない。"
```

## 5. Codex への依頼（第2パス：仕様の穴を洗う）

第1パスが完了した**後**なら実装を見せてよい。出力先は要件定義 §13 未決事項。

```
codex exec "src/rules.js を読み、要件定義 v0.3 §7.1 に記述のない挙動を列挙せよ。

観点:
  - 仕様に根拠のない自動導出（勝手に得点や進塁が発生する経路）
  - 走者・アウトカウントの整合が崩れる入力列
  - 設計原則 12.2（選択肢の配置を変えない）と §7.1 第1層（不正な盤面を作らせない）が
    衝突している箇所

修正はするな。OPEN-08 以降として §13 のテーブル形式で出力せよ。"
```

## 6. ミューテーションテスト

テストの assert が緩いかどうかは、AI に判定させず機械的に測る。

```bash
npm run mutate
```

`src/rules.js` のみを対象とするため実行は短時間で終わる。
生存ミュータント（survived）の一覧が、そのままテストの穴の一覧になる。
`reports/mutation/mutation.html` を開いて確認する。

## 7. Copilot について

`Copilot code review` はコメントを出すのみでテストを書かないため、この用途では代替にならない。
契約済みであれば PR の自動レビュアーとして併用してよいが、Codex の代わりにはならない。
