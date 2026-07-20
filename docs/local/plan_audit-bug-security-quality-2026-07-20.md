---
type: plan
status: done
tags: [audit]
owner: 
review_status: draft
related: [report_bug_security_quality_audit_2026-07-20.md]
last_reviewed: 2026-07-21
due: 2026-07-27
---

# [完了] audit-bug-security-quality-2026-07-20

## context配分

| C | 内容 | 種別 |
|---|---|---|
| C1 | 監査全体（バグ・セキュリティ・脆弱性・依存関係・保守性） | plan |

## 概要

ai-audit-prompts の `claude_ultracode_audit_db_less_app.md` を使い、many-ai-usage リポジトリ全体を対象に監査する。

## 解決済み引数

- DB区分: なし（明示。ブラウザ拡張・chrome.storage のみで DB/ORM/SQL 依存なし）
- 強度: ハイ（既定）
- スコープ: 調査・修正まで（明示。現行機能を壊さない範囲で確定 finding の高優先度を修正する）
- 観点: 全部（既定）
- 対象: リポジトリ全体（既定）
- 除外: なし（既定）
- 確認: あり（既定・実行前確認は 2026-07-20 に承認済み）

## 禁止事項（厳守）

- git commit / git push / git tag
- ビルド・コンパイル・バンドル・publish・deploy・install を伴うコマンド
- git reset --hard / git checkout -- / 未依頼の revert
- ブランチの作成・切り替え・マージ
- 機密ファイル・secrets・認証情報の出力（発見時は場所と種別のみ記録しマスク）
- アーキテクチャの抜本改修・仕様変更・大規模リファクタ・新フレームワーク導入
- DB導入・DB前提の修正（本アプリはDBなし前提）
- 判断待ちで停止しない（記録してパスし最後まで走り切る）
- 抜本改修が必要な場合は実装せず進言事項に記録

## 状態管理・永続化方式の確認

- `chrome.storage`（`src/shared/storage.ts`）が唯一の永続化層
- teach-mode の selector/fingerprint は `src/content/teach/`
- ローカル i18n カタログ（`src/locales/*.json`）
- DB / SQL / ORM 依存なし（package.json 確認済み: preact, valibot のみ実行時依存）

## 現行機能維持の確認観点

- `chrome.storage` のデータ形式（schema.ts の valibot スキーマ）を壊さない
- teach-mode の selector 保存・再読取の互換性を壊さない
- popup/options の主要UI挙動を壊さない
- manifest.chrome.json / manifest.firefox.json の contract を壊さない

## TODOチェックリスト

- [x] 初期把握（git status / 依存 / 主要処理経路）
- [x] 調査フェーズ（バグ / セキュリティ・脆弱性 / 依存関係 / 保守性）
- [x] 検証フェーズ（敵対的検証・確定/却下の判定）
- [x] 修正フェーズ（確定 finding の高優先度から最小修正）
- [x] 検証フェーズ（typecheck / test 実行）
- [x] 再調査ループ（対象外・スコープ「調査・修正まで」のため再調査なしで終端）

## 調査ログ

Explore/Agent エージェントで以下の観点を分担調査:
- バグ（ロジック誤り・境界・nil/undefined・エラー処理・並行性・状態・I/O/パース）
- セキュリティ・脆弱性（XSS/innerHTML、CSP、外部fetch/SSRF、secrets、chrome.storage露出）
- 依存関係（package.json の版数、既知CVE、lock整合）
- 保守性（実害に繋がる重複・過剰複雑度）

## finding 一覧 / 敵対的検証結果 / 修正方針 / 実施した修正 / 実行した検証 / 既存機能への影響確認 / 残課題 / 判断待ち事項 / パスした項目 / 進言事項

全て `docs/local/report_bug_security_quality_audit_2026-07-20.md` に詳細記載（重複回避のためこちらは要約のみ）。

- 確定 finding 14件（F1〜F14）。F1〜F6 を最小修正で適用。F8・F10・F12 は当初判断待ちだったが、ユーザーへメリデメ＋推奨を提示し 2026-07-21 に方針決定（F8=プロバイダ単位キー分割、F10=近傍アンカー限定、F12=最小修正）を受けて追加対応。F7・F9・F11・F13・F14（計5件）は進言事項として未適用。
- 却下2件: `applyRegistryProviders`（テストから現役使用中と判明・削除せず）、`detector/normalize.ts` の `closestReset`（dead code につき実害なし）。
- 確認済みルール:
  - `src/content/detector/` は runtime 未使用（regression reference専用）。grep で `detectUsage`/`from '.*detector'` の外部参照0件を確認済み。
  - `applyRegistryProviders` は deprecated だが `tests/storage.test.ts` から現役使用されており削除不可。

## 実行した検証

`pnpm run typecheck`（エラーなし）/ `pnpm test`（10ファイル100テスト全成功、新規4件含む）/ `pnpm audit`（既知脆弱性なし）。ビルド系は禁止のため未実行。

## 完了条件

claude_ultracode_audit_db_less_app.md の完了条件（rubric）16 項目を満たすこと → 満たした（詳細は report 参照）。

## 最終結果

総合評価 88/100 [A]（2026-07-21 追補後）。詳細は report_bug_security_quality_audit_2026-07-20.md 参照。
