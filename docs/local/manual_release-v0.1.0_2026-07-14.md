---
type: release
status: in-progress
version: v0.1.0
channels: [github-release, chrome-web-store, amo]
owner: ishizakahiroshi
last_reviewed: 2026-07-14
---

# [準備] v0.1.0 リリース

> 最終更新: 2026-07-14

## リリース引数

| key | value | 備考 |
|---|---|---|
| repo | many-ai-usage | git remote / release registry の登録は未確認 |
| version | v0.1.0 | manifest の version が単一ソース |
| channels | github-release, chrome-web-store, amo | GitHub Release は GHA、ストア提出は手動 |
| mode |  | ストアの外部提出はこの md の完了後に行う |
| dry-run | true | 認証・タグ push・ストア送信は実施しない |
| secrets | none required for GHA; store accounts required for submission | 秘密値は文書へ記録しない |
| notes | teach-mode pivot | 実機の拡張再読み込みとストア提出が残る |

## 実行計画

1. `pnpm test`、`pnpm typecheck`、`pnpm build` を実行する。
2. `scripts/secrets-scan.mjs --all-tracked --block` を実行する。
3. `v0.1.0` タグで `.github/workflows/release.yml` を起動し、Chrome ZIP / Firefox XPI / SHA-256 checksums を GitHub Release に添付する。
4. Chrome Web Store と AMO の各提出フォームで `docs/store/` の listing / privacy / submission notes を使用する。
5. 提出後の URL と審査状態をこの md の申し送りへ記録する。

## 申し送り

- 2026-07-14: GitHub Release 用のタグ駆動 workflow を追加。タグ push は未実施。
- 2026-07-14: `docs/local/design_teach-mode-store-screens_2026-07-14.html` から合成データの 1280×800 スクリーンショット 3 枚を生成。
- 2026-07-14: Chrome Web Store / AMO への外部提出は、アカウント認証と人手確認が必要なため未実施。
- 2026-07-14: repo-consistency は release registry に本リポジトリの行が無いため、台帳照合待ち。
