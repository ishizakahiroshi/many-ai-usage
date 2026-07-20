---
type: plan
status: planned
tags: [opencode, opencode-go, starter-pack, teach-mode]
owner: ishizakahiroshi
review_status: draft
related:
  - docs/local/reference_opencode-go-personal-workspace-url.md
  - resources/starter.json
  - src/shared/samples.ts
last_reviewed: 2026-07-20
due: 2026-07-27
---

# [計画] opencode-go-taught-metrics

## context配分

| C | 内容 | 種別 |
|---|---|---|
| C1 | teach-mode実施でローリング/週間/月間利用量のselector・fingerprintを採取 | plan |
| C2 | starter.jsonのsample:opencodeエントリをURLタイルからtaught metrics付きに更新 | plan |

実行順序: `C1 → C2`

---

## 概要

`resources/starter.json` の `sample:opencode` は現状 `mode: "auto"`・`metrics: []` のURLタイルのみ（2026-07-20追加、`docs/local/reference_opencode-go-personal-workspace-url.md` 参照）。`opencode.ai/go` へのアクセスがログイン済みセッションで自分のworkspace usageページへリダイレクトすることは実機確認済みで、ページには「ローリング利用量」「週間利用量」「月間利用量」の3つの%表示がある（2026-07-20スクリーンショットで確認）。本plan はこの3指標を実際にteach-modeで教え、selector・textFingerprintを採取してstarter.jsonへtaught metricsとして反映するまでを扱う。

スコープ外: OpenCode以外のプロバイダの追加・変更。starter.json以外のUI変更。

## 現状と問題

- `resources/starter.json` の `sample:opencode` は `metrics: []` のため、Try samplesで取り込んでも%表示が出ない（URLタイルとして開けるだけ）。
- teach-modeのselector/fingerprintは実際にブラウザでpicker操作をして採取する必要があり、AIセッション単体では完了できない（`reference_opencode-go-personal-workspace-url.md` §5 に同様の記載あり）。
- 採取したデータに個人のworkspace ID（`wrk_...`）やメールアドレスが混入しないよう、sanitizeが必須。

## 方針

1. ユーザー自身のブラウザで `opencode.ai/go`（→自分のworkspaceへredirect）を開き、拡張のteach-modeで3指標を教える。
2. Tracked elementsのCopy JSON機能等で採取結果を取得し、`wrk_...`・メール・実%値をログや一時ファイルから除去した「構造のみ」（selectors・tagName・textFingerprint・interpretation）に加工する。
3. `resources/starter.json` の `sample:opencode` エントリに `metrics` 配列として3件（`opencode-go-rolling` / `opencode-go-weekly` / `opencode-go-monthly`）を追加し、`mode` を `"taught"` に変更する。
4. 複数言語UI（英語版OpenCode等）でラベルが異なる可能性があるため、日本語UIでの採取である旨を `note` に明記する。

## C1: teach-mode実施でselector・fingerprintを採取

### 作業内容

- ブラウザで拡張機能をロードし、options画面から `sample:opencode`（もしくは手動追加のOpenCode Go provider）を対象にTrack/Re-teachを起動
- 「ローリング利用量」「週間利用量」「月間利用量」の3つの%表示をそれぞれteach（`reference_opencode-go-personal-workspace-url.md` §5の手順に準拠）
- 可能であれば各「リセットまで…」もreset anchorとしてteach
- Tracked elementsのCopy JSONで採取結果を取得し、`wrk_...`・メールアドレス・実%値を一般化/除去した構造のみを次C向けにメモする

### 変更予定ファイル

- なし（ブラウザ操作のみ。採取結果は本plan C2または`reference_opencode-go-personal-workspace-url.md`へ転記）

### 完了条件

- 3metric分のselector・tagName・textFingerprintが（sanitize済みで）手元にある
- popup上でOpenCodeの3指標が%表示されることを確認済み

---

## C2: starter.jsonのtaught metrics反映

### 作業内容

- C1で採取したselector情報を使い、`resources/starter.json` の `sample:opencode` エントリに `metrics` 配列（3件）を追加
- `mode` を `"auto"` → `"taught"` に変更、`verifiedAt` を追記
- `note` を「URL tile only」から実態に合わせて更新

### 変更予定ファイル

- `resources/starter.json` — `sample:opencode` の `metrics`/`mode`/`verifiedAt`/`note` 更新
- `docs/local/reference_opencode-go-personal-workspace-url.md` — §8チェックリストの完了マーク・実施結果の記録

### 完了条件

- `pnpm test` / `pnpm run typecheck` が通る
- starter.jsonが`node -e`等でJSONとして妥当かつ`parseStarterPackResponse`相当のスキーマを満たす
- 個人ID・メール・実%値がコミット差分に含まれていないことを確認済み
