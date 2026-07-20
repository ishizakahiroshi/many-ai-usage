---
type: report
status: done
tags: [audit, teach-mode, adversarial-review]
owner: ishizakahiroshi
review_status: draft
related:
  - docs/local/plan_adversarial-teach-label-collision-audit.md
  - docs/local/bugfix_teach-label-collision-overwrite_2026-07-20.md
last_reviewed: 2026-07-20
---

# teach label collision 修正の敵対レビュー結果

## 総合評価: 100 / 100  [S]

| カテゴリ | スコア | 評価 | サブ項目（スコア） | 減点理由 → クリア条件 |
|---|---:|:---:|---|---|
| セキュリティ・脆弱性 | 30 / 30 | S | injection 10/10, 認証認可 8/8, secrets 6/6, CVE 6/6 | 確定 finding なし |
| バグ・正確性 | 25 / 25 | S | ロジック 12/12, 例外 8/8, 境界 5/5 | 確定 finding なし |
| 依存関係 | 15 / 15 | S | アプリ依存 9/9, ランタイム・SDK 6/6 | `pnpm audit --prod --audit-level=high` は問題なし |
| 保守性 | 15 / 15 | S | 重複・死コード 5/5, 複雑度 5/5, テスト容易性 5/5 | 回帰テストで境界を固定 |
| 検証カバレッジ | 15 / 15 | S | テスト 7/7, 型・lint 8/8 | 対象49件、全体95件、型検査が成功 |

判断待ち（未採点）: 0件。スコアは対象差分の自動・目視監査に基づく目安で、人間の実機レビューで変動し得る。

## 今回の実装内容

- `metricId` 専用のマージに変更し、表示ラベル重複による既存 metric の上書きを防止。
- click 座標を再絞り込みへ伝播し、コンパクトな値候補がある場合は広い親コンテナを候補から除外。

## 変更ファイル

- `src/background/index.ts`（対象 hunk のみ）
- `src/content/teach/picker.ts`
- `tests/background.test.ts`（対象 hunk のみ）
- `tests/teach.test.ts`

コミット: `5e1a09f fix(teach): prevent metric label collision overwrite`。監査記録はローカル作業ノートとしてコミット対象から除外した。

## 確定 finding 一覧

確定 finding はありません。

## 敵対的検証結果

- ラベル衝突: 既存 metric と staged metric が同じラベル・異なる `metricId` の場合、2件を保持する回帰テストで検証。
- re-teach: 同じ `metricId` の場合、既存 anchor が新しい anchor に置換される回帰テストで検証。
- クリック選択: 3列の同一値（0%）に対し、各クリック座標が対応する値 `span` を選ぶ回帰テストで検証。
- 親コンテナ誤選択: pointer bonus が親にも入る仮説を確認したが、コンパクト候補がある場合に root を `extractPool` から除外するため却下。

## 対処手順（実務）

確定 finding がないため、追加の対処は不要。

## 実行した検証

- `pnpm audit --prod --audit-level=high`: 成功、既知脆弱性なし。
- `pnpm exec vitest run tests/teach.test.ts tests/background.test.ts --reporter=dot`: 49件成功。
- `pnpm test`: 95件成功（実装直後の全体回帰）。
- `pnpm run typecheck`: 成功。
- `git diff --check`: 成功。

## 実行しなかった検証と理由

- ビルド・バンドル: プロジェクト規約と監査方針により未実施。
- OpenCode Go 実機: unpacked extension をこの環境で起動していないため未実施。

## 既存機能への影響確認

- `metricId` 一致時の更新、pointer 未指定の既存呼び出し、既存の picker/background テストを確認。保存形式・公開メッセージ形式は変更していない。

## 未完了項目

- 実機での3列再teach確認のみ。

## 判断待ち事項

なし。

## パスした項目

- DB・SQL・ORM・migration は対象外かつ追加なし。
- セキュリティ上の確定 finding はなし。

## 抜本改修の提言

なし。
