---
type: plan
status: in-progress
tags: [popup, refresh, ux, v0.1.x]
owner: ishizakahiroshi
review_status: draft
related:
  - plan_v0.1.0-mvp.md
  - plan_popup-dnd-reorder.md
last_reviewed: 2026-07-20
due: 2026-07-27
---

# [実行中] popup を開くたびに最新 usage を取得してから表示する

> ローカル実装: 2026-07-20 · `pnpm run typecheck` / `pnpm test`（90件）成功。unpacked の手動確認は未完了。
> このファイルを渡された AI は、残 C2 を実行する。C1 は再実装しない。

## context配分

| C | 種別 | 内容 | 並列 |
|---|---|---|---|
| C1 | fix | popup 開始時の全 provider 再取得・完了待機・一時タブの後始末 | — |
| C2 | plan | Chrome/Firefox unpacked での最新値表示とタブ挙動の手動確認 | — |

実行順序: `C1 → C2`

---

## 概要

**問題:** popup は前回保存した snapshot を即表示するため、ユーザーが拡張機能を開いた時点の usage とは限らない。行ごとの更新ボタンを押さないと最新値である保証がなく、一覧ダッシュボードとして不便だった。

**決定:** popup を開いたら、ホスト許可済みの各 provider を読み直し、**成功または失敗が確定してから**一覧を表示する。待機時間は許容する。

## スコープ

**含む**

- popup 開始時の全 provider refresh
- 未表示の usage ページを非アクティブで一時的に開く
- capture 完了・失敗・15秒 timeout の待機と状態反映
- 一時タブを capture 完了後に閉じる

**含まない**

- 15分ごとの定期 polling / `chrome.alarms`
- usage 値・Cookie・HTML の外部送信
- refresh interval 設定の schema/UI 変更
- build / commit / push / ストア提出

## 方針

1. popup は初期キャッシュを表示せず、`REFRESH_DASHBOARD` の完了を待つ。
2. 既に該当ページが開いていれば、そのタブの content script に `CAPTURE_NOW` を送る。
3. 開いていない provider は `active: false` の一時タブを作り、完了・失敗時に閉じる。popup のフォーカスを奪わない。
4. 一時タブと既存タブのどちらも、popup 起点の refresh 中は usage URL へ遷移しても foreground にしない。
5. 15秒以内に capture が戻らなければ failure として表示し、古い snapshot を最新値として扱わない。

## C1: 実装

### 状態

**2026-07-20 実装済み**（再実装しない）。

### 変更

- `src/shared/messages.ts`
  - `REFRESH_DASHBOARD` を追加。
- `src/background/index.ts`
  - provider ごとの refresh 完了 Promise を管理。
  - `refreshDashboard()` が許可済み provider を並列で再取得し、完了・failure・timeout を集約。
  - popup 起点の一時タブは非アクティブで作成し、capture 後に閉じる。
  - popup 起点の navigation は `active: false` を維持。
- `src/popup/main.tsx`
  - popup 初期表示を `REFRESH_DASHBOARD` 完了待ちに変更。
  - storage 更新途中の部分表示を抑止し、全 provider の結果が揃ってから dashboard を描画。
- `tests/background.test.ts`
  - permitted provider を popup 表示前に再取得する契約を追加。

### 完了条件

- [x] popup が `REFRESH_DASHBOARD` 終了前に既存 snapshot を描画しない
- [x] 許可済み provider は capture を開始する
- [x] 新規一時タブは background で開き、完了後に閉じる経路がある
- [x] 失敗・timeout は runtime state に記録される
- [x] `pnpm run typecheck` 成功
- [x] `pnpm test` 90件成功

## C2: unpacked 手動確認

### 手順

1. Chrome または Firefox の unpacked 拡張を再読み込みする。
2. usage を track 済みの provider を2件以上用意する（実値・Cookie・トークンは記録しない）。
3. popup を開く。短い「読み込み中」の後に一覧が出ることを確認する。
4. popup を開いた直後、別タブが前面に出ないことを確認する。
5. provider の usage ページを閉じた状態でも popup を開く。一時タブが残らず、値または読み取り失敗が表示されることを確認する。
6. provider の usage ページを開いた状態でも popup を開く。既存タブを使って更新し、そのタブが閉じないことを確認する。
7. 未許可 provider がある場合、permission 要求ではなく従来の要対応表示になることを確認する。

### 完了条件

- [ ] 手順3〜6が Chrome または Firefox で成功
- [ ] 手順7を未許可 provider がある環境で確認、または該当なしと記録
- [ ] 実 usage 値・Cookie・トークンをこの md に残していない

### C2 完了時の更新

- `context配分` の C2 を `plan` から `fix` に更新する。
- 全 C が `fix` になったら H1 を `[様子見]` に更新する。

## 禁止・停止条件

- `git commit` / `git push` / `git tag` はユーザー明示まで実行しない。
- build はユーザー明示まで実行しない。
- 実アカウントの usage 値、Cookie、トークン、レスポンス本文をコード・fixture・この計画書へ書かない。
- 15秒 timeout が実機で恒常的に足りない場合は、無断で値を伸ばさず実測と対象 provider を報告して判断を仰ぐ。

## 判断ログ

| 日付 | 内容 |
|---|---|
| 2026-07-20 | ユーザー決定: 「拡張機能を開いたら最新が出ていないと不便」。待機してもよいので popup-open refresh を採用。 |
| 2026-07-20 | 15分は polling ではなく stale 判定の設定だった。定期 polling は導入しない。 |
| 2026-07-20 | C1 実装済み。型検査・全90テスト成功、実機確認は C2 へ残した。 |
