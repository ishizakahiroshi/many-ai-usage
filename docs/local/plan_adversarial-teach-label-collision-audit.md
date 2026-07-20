---
type: plan
status: done
tags: [audit, teach-mode, adversarial-review]
owner: ishizakahiroshi
review_status: draft
related:
  - docs/local/bugfix_teach-label-collision-overwrite_2026-07-20.md
  - src/background/index.ts
  - src/content/teach/picker.ts
last_reviewed: 2026-07-20
due: 2026-07-27
---

# [完了] teach label collision 修正の敵対レビュー

## 作業目的

- `bugfix_teach-label-collision-overwrite_2026-07-20.md` の実装差分を、データ消失・誤選択・境界条件・依存関係の観点で監査する。
- 確定した問題がなければ、この bugfix に直接属する hunk のみをコミットする。

## 対象・除外

- 対象: `src/background/index.ts` の `saveCompletedTeach`、`src/content/teach/picker.ts` のクリック時再絞り込み、対応する回帰テスト。
- 除外: 作業ツリーに元からある samples、UI、通常 capture の別変更、および実機ログ・実アカウント情報。
- DBを使わない前提: 永続化は `chrome.storage` と in-memory `teachSessions`。DB・SQL・ORM・migration は対象外。

## 制約

- ビルド・バンドル・公開は行わない。
- 既存の未コミット変更は戻さず、コミット時も対象 hunk だけを stage する。

## TODO

- [x] 対象と既存差分を切り分ける
- [x] データ永続化・picker の処理経路を敵対的に確認する
- [x] 依存関係・secrets・回帰テストを確認する
- [x] findings を独立に再検証する
- [x] 結果を記録し、問題がなければ対象 hunk のみコミットする

## 調査ログ

- 2026-07-20: DB driver / ORM / SQL を検出せず、DBなしアプリとして監査を開始。
- `saveCompletedTeach()` がセッション内・永続化済みとも `metricId` で更新することを確認。ラベル重複は保存同一性に使われない。
- `selectAtPoint()` から `refineValueElement()`、`makeMetric()`、reset 推測まで同一クリック座標が渡ることを確認。コンパクト候補がある時は広いルート要素を候補に混ぜない。
- `pnpm audit --prod --audit-level=high` は既知脆弱性なし。対象テスト49件と型検査は成功。全テスト95件も実装直後に成功済み。

## finding 一覧

- 確定 finding: なし。
- 却下: 親コンテナにもクリック位置ボーナスが入る点。コンパクト候補がある場合は親を `extractPool` から除外するため、3列回帰テストで週・月・ローリングの各値 `span` が選ばれることを確認。

## 既存機能への影響

- 同一 `metricId` の re-teach は置換される回帰テストで維持を確認。
- pointer を指定しない既存呼び出しは optional 引数のままで、既存 teach/performance テストを維持。

## 実機確認の残課題

- OpenCode Go の実ページで3列を再teachする確認は、この環境で拡張を unpacked 起動していないため未実施。

## 最終結果

- 今回の修正由来の確定問題は見つからなかった。既存の別作業差分を含めず、対象 hunk のみを `5e1a09f fix(teach): prevent metric label collision overwrite` としてコミットした。

## 確認済みルール

- 調査中。
