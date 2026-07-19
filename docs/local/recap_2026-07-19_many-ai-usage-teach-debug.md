---
type: recap
status: watching
tags: [many-ai-usage, teach-mode, handoff]
owner: ishizakahiroshi
related: [plan_teach-hardening-v0.1.0.md, design_unpacked-testing-guide_2026-07-16.html, manual_release-v0.1.0_2026-07-14.md]
last_reviewed: 2026-07-19
docsweep_policy: archive_with_release
---

# [振り返り] many-ai-usage teach 実機デバッグ — Claude / Codex 主要 2 ベンダー OK

> 日時: 2026-07-19 起点
> セッション主題: v0.1.0 申請可否の確認 → unpacked 実機で teach が壊れている箇所を潰し、Claude と Codex で数値表示まで通した。途中で session-recap に引き継ぎ節を追加する方針を確定。
> モード: full

## 今回の成果

- Claude + Codex CLI の teach → popup 表示まで実機で成功（Claude 5h/1w、Codex 週間上限）
- teach-mode hardening 後の **未ビルド dist** が原因の「既存タブに picker」を特定し、build 手順を明確化
- picker の全面 overlay + window capture で SPA の click 横取りに対抗
- Done 時に **liveRead snapshot** を保存し、再読取失敗でもダッシュボードが空にならないようにした
- Claude 設定モーダル（top layer）向けに **popover** で teaching panel を前面化
- content.js 再 inject で panel が一瞬消える競合を、PING + ensureContentScript で抑止
- options が開かない問題を `OPEN_OPTIONS`（既存タブ前面化 / 破棄時 reload）で改善
- `session-recap` skill を 5 カテゴリ化し **引き継ぎ節**を正典化（新規 skill は作らない）

## 学んだこと

- Chrome 拡張で `scripting.executeScript` による content.js 再実行は **新 isolate** になり、load 時の orphan 掃除が「生きている picker」を消す
- サイトの `dialog` / 設定モーダルは **top layer** に乗り、`z-index: max` では teaching UI が負ける → Popover API（`popover=manual`）
- `extractValue` は親コンテキストから % を借りるため、flex 行全体 teach だと selector が太く再読取が脆い → `refineValueElement` で「数字を自分で持つ葉」を選ぶ
- `openOptionsPage()` は Promise 成功でも **破棄済みタブにフォーカスしただけ**で画面上は何も起きないことがある
- Claude usage の実 URL は `claude.ai/new#settings/usage`（hash SPA）。registry の path 一致だけに頼ると危ない → `urlMatch` / origin マッチ

## 改善できたこと

- **断定前の観察不足**: 最初のスクショだけで「壊れている」と決めず、popup の Re-parse は teach 前の正常表示だった。次回も「期待動作 vs バグ」を先に切り分ける
- **dist 鮮度**: ソース修正後に build / 拡張リロードを忘れると、実機は旧挙動のまま。実機前に dist 時刻とコミット時刻を見る
- **修正の連鎖**: overlay → 再 inject 消し → options と、1 症状直すと次の症状が出た。拡張 UI は「表示 / 入力 / 永続化 / タブ復帰」をセットで見る
- **skill / docs 修正漏れ候補を解消**: 引き継ぎを session-recap に載せないままだと次回ゼロからになる → 本セッションで skill 改訂まで実施

## 次にやること

- 必要なら Grok / Copilot / Cursor / Ollama の teach 実機（または v0.1 は主要 2 のみと割り切る）
- Chrome / Firefox で T1〜T5（`design_unpacked-testing-guide`）を通す
- 最新 dist で zip/xpi を作り直し → タグ → ストア提出（明示指示があるまで AI は commit/tag/push しない）
- sample registry の Claude URL を実体（`/new#settings/usage`）に寄せるか検討（many-ai-cli 側）

## 引き継ぎ（次セッション用）

### 到達点

- many-ai-usage: teach 実機で **Claude + Codex が表示 OK**
- 関連修正は working tree / 直近 build の `dist/chrome` に入っている想定（**未コミットの可能性あり** → 次は `git status` から）
- session-recap は 5 カテゴリ（引き継ぎ節）が正典

### 未完了

- [ ] 残 4 sample プロバイダの実機 teach
- [ ] T1〜T5 全緑（Chrome + Firefox）
- [ ] v0.1.0 タグ / GitHub Release / ストア提出
- [ ] 変更の commit（ユーザー指示待ち）
- [ ] Claude sample URL の registry 更新（任意）

### 再発防止 gotcha

- panel が一瞬で消える → content.js 再 inject + load 時 removeOrphan → PING で生存確認し再実行しない
- 数字は選べるが Done できない → Claude モーダル top layer → popover
- tooltip は出るが Saved が増えない → page capture が click を食う / `metrics: []` の `??` → overlay + liveRead + `saved` 判定
- options が出ない → `openOptionsPage` の偽成功 → `OPEN_OPTIONS` でタブ前面化
- 既存タブにだけ marker → 古い dist の `findMatchingTab` → build し直してから検証

### 次の 1 手

1. `git status` / `git diff --stat` で未コミット範囲を確認
2. 必要なら `pnpm test` && `pnpm run build:chrome` → 拡張リロード
3. popup で Claude / Codex が残っているか確認。options の ⚙ が開くか確認
4. 申請に進むなら T1〜T5 ガイドに沿って Firefox も 1 パス

### 触らない / やらない

- ユーザー指示なしの commit / tag / push / ストア送信
- 実アカウントの usage 実値を fixture や docs に貼ること
- ヒューリスティック detector を v0.1 runtime に再接続すること（reference のまま）
