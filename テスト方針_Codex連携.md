# Codex 連携の手順

作成日: 2026-08-28

**方針（役割分担・テスト対象・CIゲート）は要件定義（`要件定義/` の最新版）§10.2 が正。**
このドキュメントはそれを実行するための操作手順のみを扱う。方針を変えるときは §10.2 を直すこと。

プロンプトの本文は `prompts/` に置いてある。ここには載せない（二重管理を避けるため）。

## 1. Codex CLI の準備

```bash
npm i -g @openai/codex
codex login
```

**モデルの指定に注意。** `~/.codex/config.toml` の `model` が ChatGPT アカウントで
使えない値だと、認証は通っているのに実行時に弾かれる。

```
ERROR: The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.
```

`-m` で明示的に上書きするのが確実（2026-08-28 時点で `gpt-5.6-sol` を確認済み）。
候補は `~/.codex/models_cache.json` に載っている。

ファイルを書かせるので `-s workspace-write` も必須。読み取りだけなら `-s read-only`。

## 2. 第1パス：仕様からテストを書かせる

```bash
codex exec -s workspace-write -m gpt-5.6-sol "$(cat prompts/codex-pass1-テスト作成.txt)"
```

PowerShell では `codex exec -s workspace-write -m gpt-5.6-sol (Get-Content -Raw prompts/codex-pass1-テスト作成.txt)`。

このプロンプトは `src/rules.js` と `src/App.jsx` を開くことを明示的に禁止している。
代わりに対象APIの契約をプロンプト内に全部書いてあるので、実装を読まずにテストが書ける。

**実装を変更したら、プロンプト内のAPI契約も更新すること。** ここが古いと Codex は
存在しない関数のテストを書く。

## 3. 監査：実装を読んでいないことの確認

第1パスの成果物を受け入れる前に必ず行う。読んでいた場合、そのテストは実装の追認に
なっている可能性があるので破棄してやり直す。

実行ログから Codex が叩いたコマンドを一覧する。

```bash
grep -A1 "^exec$" <ログファイル> | grep -v "^exec$\|^--$" | sed 's/ in C:.*//'
```

`src/rules.js` や `src/App.jsx` を `Get-Content` / `cat` / `rg` している行がなければ合格。
テスト失敗時のスタックトレースに `src/rules.js:233` のような行番号が出るのは問題ない
（実装の中身は見えていない）。

## 4. 第2パス：仕様の穴を洗う

第1パスが完了した**後**なら実装を見せてよい。出力先は要件定義 §13 未決事項。

```bash
codex exec -s read-only -m gpt-5.6-sol "$(cat prompts/codex-pass2-仕様の穴.txt)"
```

第1パスで捕まらなかったバグは、たいてい**仕様書がその挙動について沈黙している**。
バグの所在と仕様の穴は一致するので、第2パスの出力はそのまま要件定義の補強点になる。

## 5. ミューテーションテスト

テストの assert が緩いかどうかは、AI に判定させず機械的に測る。

```bash
npm run mutate
```

`reports/mutation/mutation.html` に結果が出る。生存ミュータント（survived）の一覧が、
そのままテストの穴の一覧になる。

**全テストが通っていないと起動しない**（`ConfigError: There were failed tests in the
initial test run`）。失敗を残したまま計測はできない。

## 6. Copilot について

`Copilot code review` はコメントを出すのみでテストを書かないため、この用途では
代替にならない。契約済みであれば PR の自動レビュアーとして併用してよいが、
Codex の代わりにはならない。
