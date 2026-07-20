---
type: plan
status: done
tags: [audit, report]
owner: 
review_status: draft
related: [plan_audit-bug-security-quality-2026-07-20.md]
last_reviewed: 2026-07-21
due: 2026-07-27
---

# [完了] 監査結果報告 — many-ai-usage 2026-07-20 / 07-21 追補

## 総合評価: 88 / 100  [評価バッジ: A]

| カテゴリ | スコア | 評価 | サブ項目（スコア） | 減点理由 → クリア条件 |
|---|---|---|---|---|
| セキュリティ・脆弱性 | 29 / 30 | A | injection 10/10, 認証認可 8/8, secrets 6/6, CVE 6/6（減点は「その他」枠） | F11 starter-pack URL scheme -1 → 対処で +1 |
| バグ・正確性 | 16 / 25 | B | ロジック不整合 12/12（修正済）, 例外処理 -6, 境界条件 5/5 | F7 teach eviction -5, F9 schema drop -2, F13 orphan picker -2 → 各対処で +9 |
| 依存関係 | 15 / 15 | S | アプリ依存 9/9, ランタイム 6/6 | 減点なし |
| 保守性 | 15 / 15 | S | 重複 5/5（修正済）, 複雑度 5/5, テスト容易性 5/5 | 減点なし（picker.ts の巨大モジュール状態は進言事項） |
| 検証カバレッジ | 13 / 15 | A | テスト 5/7, 型・lint 8/8 | F14 UI層テスト欠如 -2 → 追加で +2 |

判断待ち（未採点）: 0 件
評価バッジ: S=90+ / A=75+ / B=60+ / C=40+ / D=40未満

※ このスコアは自動検出に基づく目安であり、人間レビュー後に変動しうる。

## 今回の実装内容

**2026-07-20（初回監査）**: `claude_ultracode_audit_db_less_app.md`（ai-audit-prompts 正典）に従い、Explore サブエージェント4体（バグ×2 / セキュリティ / 依存関係・保守性）で並列調査 → 全 finding を自分で読み直して敵対的検証 → スコープ「調査・修正まで」により確定 finding のうち高優先度6件（F1〜F6）を最小修正で修正。

**2026-07-21（追補）**: 判断待ちだった F8・F10・F12 についてユーザーへメリット/デメリットと推奨案を提示し、以下の方針で全て対応:
- F8: プロバイダ単位キーへの分割リファクタを実施（推奨案は「見送り」だったが、ユーザーが根本解決を選択）
- F10: 検索範囲を近傍アンカーに限定する修正を適用（推奨案は「見送り」だったが、ユーザーが脆弱性を塞ぐ方を選択）
- F12: 最小修正を適用（推奨どおり）

## 変更ファイル

- `src/content/teach/extract.ts` — aria-valuenow/aria-valuemax の百分率変換バグ修正（F1）
- `src/content/teach/read.ts` — ラベル文字列だけで headline 置換される誤爪の修正（F2）、headline 探索を近傍アンカーに限定（F10）
- `src/content/teach/selector.ts` — `findUsageHeadline`/`findByLabelHint` に近傍スコープ探索を追加（F10）
- `src/background/index.ts` — used_percent 指定時に remaining が used と同値で上書きされる不整合の修正（F3）
- `src/content/teach/picker.ts` — 不可視要素（opacity:0 等）をヒットテスト対象から除外（F4）、panelClick の remove/rename-save に try/catch を追加（F12）
- `src/shared/storage.ts` — 重複ループ統合（F5）、snapshot/runtimeState をプロバイダ単位キーへ分割し、旧形式からの移行処理を追加（F8）
- `src/shared/perf.ts` — 呼び出し元0件の未使用 `perfAsync` を削除（F6）
- `tests/teach.test.ts` / `tests/storage.test.ts` / `tests/background.test.ts` — F1・F2・F8（移行）・F10 の再現/回帰テストを追加、per-provider キーへの参照更新

## 確定 finding 一覧（再現条件付き）

### F1 [critical→修正済][確信度 high] aria-valuenow の値が変換されずパーセントとして扱われる
`src/content/teach/extract.ts:91-93`。`aria-valuemax` があり近傍に明示的な単位語（%・$・requests 等）が無いテキストを教えると、生カウント値をそのまま「%」として保存していた（例: `aria-valuenow="3" aria-valuemax="5"` → 実際は60%のところ「3%」と教える）。両分岐が同じ `ariaValue` を返す死んだ三項演算子が原因。`(ariaValue/max)*100` に変換するよう修正し、再現テストを追加。

### F2 [high→修正済][確信度 high] ラベル文字列だけで正しく解決済みの値が headline に差し替えられる
`src/content/teach/read.ts:111-114`（旧コード）。`labelLooksLikeBreakdown(taught.label)` がユーザーの付けたラベル文字列だけを見て判定しており、selector/fingerprint 解決が成功し値も正常でも、ラベルに "API"・"Chat" 等の単語を含むだけで headline フォールバックへ強制的に切り替わっていた。Grok 固有のレジェンドチップ対策のつもりが、無関係な他プロバイダにも誤爪していた。判定を「解決済みの evidence 自体がチップらしいか」だけに絞り、再現テストを追加。

### F3 [high→修正済][確信度 high] used_percent 指定の教えたメトリクスで remaining が used と同値になる
`src/background/index.ts:672-676`（旧コード）。`taught.unit === 'percent'` の OR 条件が interpretation を無視して常に `remaining = live.value` を設定していたため、「42% 使用済」で教えたメトリクスが「42% remaining」（実際は58%残り）と誤表示されるパスがあった（teach セッション中のライブプレビュー snapshot）。`used_percent`/`used_total` の場合は remaining への代入をスキップするよう修正。

### F4 [high→修正済][確信度 high] 不可視オーバーレイでの teach ハイジャック
`src/content/teach/picker.ts` の `hitStackAtPoint`/`candidatesAtPoint`。`opacity:0` 等で見えない要素でもブラウザの hit-test（`elementFromPoint`）には応答するため、実際の数値の真上に透明な偽装 `<div>` を仕込んだ（改ざん/悪意ある）ページで、ユーザーが視覚的に見ている本物の値をクリックしたつもりでも、偽装要素の CSS セレクタ＋フィンガープリントが「教えた」データとして永続化されうる。`getComputedStyle` で `opacity:0`／`visibility:hidden`／`display:none` の要素をヒットテスト対象から除外するよう修正。

### F5 [low→修正済][確信度 high] `applyStarterProviders` の重複ループ
`src/shared/storage.ts:87-96`。`added`/`replaced` に対する完全に同一の body を持つ2つの for ループを1つに統合。

### F6 [low→修正済][確信度 high] 呼び出し元0件の `perfAsync`
`src/shared/perf.ts:45`。リポジトリ全体を grep しても定義以外に参照が無いことを確認し削除。

### F7 [high→未修正・進言事項][確信度 medium] MV3 service worker のエビクションで教示中のメトリクスが消える
`src/background/index.ts:62-63, 846-860`。`teachSessions`/`pendingPickers` は `chrome.storage.session` 等の永続化を持たないメモリ内 Map。複数メトリクスを段階的に teach 中に service worker がアイドルタイムアウトで再起動されると、それ以前に staged したメトリクスが黙って失われ、ユーザーには何もエラーが出ない。**対処方針**: `chrome.storage.session`（または `chrome.storage.local` の一時キー）に `teachSessions` をミラーし、service worker 起動時に復元する。設計判断（永続化するキー・TTL・容量）が必要なため今回は未適用。

### F8 [medium→修正済][確信度 medium] `runtimeStates`/`snapshots` の非アトミック get→set
`src/shared/storage.ts`（旧コード）。`snapshots`/`runtimeStates` を1つの巨大オブジェクトとして共有し、`refreshDashboard()` が全プロバイダを `Promise.all` で並列 refresh する際に get→merge→set の非アトミック操作が競合し、片方の書き込みが失われうる構造だった。**対応**: `snapshot:<id>`/`runtimeState:<id>` のプロバイダ単位キーに分割し、無関係なプロバイダ間の書き込みが同じキーを取り合わない構造に変更。既存インストールが持つ旧形式の結合オブジェクトは `initializeStorage()` の一度きりの移行処理（`schemaVersion` 1→2）で自動的に分割・保存し、旧キーは削除する。移行を検証する回帰テストを追加。

### F9 [medium→未修正・進言事項][確信度 high] schema 不整合レコードが無警告で消える
`src/shared/storage.ts:107-113, 137-140, 155-158`。valibot の `safeParse` が失敗したレコードを黙って破棄/デフォルト値に置換する。`schemaVersion` は書き込むだけで migration には未使用だったが、F8 対応で実際に `schemaVersion` を使う移行処理（1→2）が入った。ただし個別レコードの schema drift 検出時のログ記録は未対応のまま。**対処方針**: 破棄時に `console.info`（診断ログ）へ記録する。

### F10 [medium→修正済][確信度 high] `findUsageHeadline` が無関係なページテキストを拾いうる
`src/content/teach/read.ts` / `src/content/teach/selector.ts:159-221`（旧コード）。teach した要素が解決できない時、ドキュメント全体から汎用キーワード一致で headline を探すため、ページ改修や敵対的ページで無関係な値が代入されうる構造だった。**対応**: taught metric のラベル/nearbyLabel をヒントに、まずそのテキストがまだ存在する近傍コンテナ（祖先を最大4階層まで遡る）内で headline を探し、見つかればそれを優先する `findAnchorContainer` を追加。近傍に何も見つからない場合のみ、既存どおり文書全体スキャンへフォールバック（既存の「壊れたレジェンドから 使用済 合計へフォールバック」テストの挙動は変えず、新規に「離れた場所にある高スコアな無関係要素より近傍の headline を優先する」回帰テストを追加して検証）。

### F11 [low→未修正・進言事項][確信度 medium] starter-pack import の URL scheme 検証が手動追加より緩い
`src/shared/schema.ts` の `v.url()` のみ vs `src/options/main.tsx:34-35` の http(s) 限定チェック。**対処方針**: `starterProviderSchema`/`providerConfigSchema` にも http(s) 限定チェックを追加する。

### F12 [medium→修正済][確信度 high] `panelClick` の remove/rename-save に catch が無い
`src/content/teach/picker.ts:914-932`（旧コード）。MV3 で service worker 再起動中に `chrome.runtime.sendMessage` が reject すると、ユーザーには何のフィードバックも無いままクリックが無反応になっていた。**対応**: 同ファイル内の `SAVE_METRIC` と同じ try/catch + `setStatusHint` パターンを remove/rename-save にも適用。

### F13 [medium→未修正・進言事項][確信度 high] `removeOrphanPickers` が呼び出されず孤立パネルが残りうる
`src/content/index.ts:128-133, 162-163`。拡張機能リロード後に古い isolate のピッカーが DOM に残る問題への対策関数が定義されているが、実際にはどこからも呼ばれていない。**対処方針**: content script の `PING` ハンドラ、または `chrome.runtime.onInstalled` 後の疎通確認タイミングで呼び出す。

### F14 [medium→未修正・進言事項][確信度 high] UI エントリポイント層のテスト欠如
`src/options/main.tsx`・`src/popup/main.tsx`・`src/content/index.ts` に対応する test ファイルが無い（grep で確認）。**対処方針**: まず `validUrl` / `blankDraft` / `draftFrom` / `formatTrackJson`（options）、`teachFailMessage` / `level` / `lowestMetric`（popup）等、既に切り出されている純関数から単体テストを追加する。

## 敵対的検証結果（却下・重複）

- **却下**: 保守性エージェントが報告した「`applyRegistryProviders` は呼び出し元0件」— 実際は `tests/storage.test.ts` から使用されており deprecated だが現役。削除しなかった。
- **却下（dead-code caveat）**: `src/content/detector/normalize.ts` の `closestReset` フォールバック — `detector/` ディレクトリ全体が実行時未使用（grep で `detectUsage`/`from '.*detector'` の外部参照0件を確認）の regression-reference専用コードのため、実害なしと判断し未修正。

## 実行した検証

- `pnpm run typecheck`（tsc --noEmit）: エラーなし
- `pnpm test`（vitest run）: 10 ファイル / 100 テスト全て成功（新規追加4件含む）
- `pnpm audit`: 既知脆弱性なし

## 実行しなかった検証と理由

- `build` / `build:chrome` / `build:firefox` / `dev`: ビルド禁止のため未実行

## 既存機能への影響確認

- 修正9件（F1〜F6、F8、F10、F12）はいずれも「値が壊れて見える／狙った要素と違うものを教えてしまう」不具合の是正、無関係な headline 誤爪の抑止、エラー時の無反応の解消、chrome.storage.local 内部のキー構造整理（外部から見える `getDashboard()` の返却形状・`AnchorFingerprint`/`ProviderConfig` の契約・popup/options の主要UI挙動は不変）。
- **F8 のストレージキー変更**は永続データの物理レイアウトを変える変更のため、既存インストールのデータ喪失を防ぐ一度きりの移行処理（`schemaVersion` 1→2、旧 `snapshots`/`runtimeStates` オブジェクトを読み出して `snapshot:<id>`/`runtimeState:<id>` に分割保存後、旧キーを削除）を追加し、回帰テストで移行後にデータが読み出せることを確認済み。
- 既存100テストが全て通過（回帰なし）。

## DBを使わない前提を維持していること

`chrome.storage` のみを永続化に用いており、DB/SQL/ORM/migration の導入・前提とした修正は行っていない。

## 未完了項目

F7・F9・F11・F13・F14（計5件）は確定 finding として記録済みだが、進言事項として未適用。

## 判断待ち事項

なし（F8・F10・F12 はユーザー判断のうえ全て対応済み）。

## パスした項目

なし

## 進言事項

- **F7（最優先）**: MV3 service worker エビクションで教示中データが消える問題は、`chrome.storage.session` へのミラーリングという設計判断を伴うため、抜本改修ではないが今回のスコープでは見送った。次回優先的に対応を推奨。
- **F9**: schema drift 検出時の診断ログ記録が未対応。`schemaVersion` を使った本格的な migration の枠組み自体は F8 対応で入った。
- **F11**: starter-pack import の URL scheme 検証を手動追加と揃える（`v.url()` に http(s) 限定チェックを追加）ことを推奨。
- **F13**: `removeOrphanPickers` の未配線は「対策コードだけ書いて実際には機能していない」状態。次の teach-mode 関連作業の際に配線することを推奨。
- **F14**: `picker.ts` が1500行・約20個のモジュールレベル可変状態を持つ最大ファイルであり（保守性エージェント指摘）、UI エントリポイント層のテストが0件。テスト追加とあわせて中期的なリファクタ候補として記録。

## その他明記事項

- git commit / git push 未実施
- ビルド等未実施
- 抜本改修未実施
- 判断待ちで停止せず、確定した高優先度 finding の修正・検証まで走り切った（スコープ「調査・修正まで」の終端）
- スコアは自動検出ベースの目安であり、人間レビュー後に変動しうる
