---
type: plan
status: in-progress
tags: [implementation, mvp, pivot, teach-mode, browser-extension]
owner: ishizakahiroshi
review_status: draft
related: [plan_v0.1.0-mvp.md, reference_study-synthesis.md, review_v0.1.0-mvp-open-topics_2026-07-14_decisions.md]
last_reviewed: 2026-07-14
due: 2026-07-21
---

# [進行中] v0.1.0 MVP ピボット: teach-mode 前倒し

> 最終更新: 2026-07-14
> 前提: `docs/local/plan_v0.1.0-mvp.md` を親 plan として維持し、本 plan は「主 pipeline を auto detector から teach-mode に付け替える」差分だけを記述する
> 決定日: 2026-07-14（実 Claude / Codex での auto detector 実機検証で誤値検知が判明した直後）

## 背景

親 plan §背景の 3 段梯子(①auto ヒューリスティック ②teach-mode ③tile) は「①でおおむね拾えるはず」を前提としていた。2026-07-14 の実機検証で以下が判明:

- **Claude**: 実値「セッション 8% 使用 / 週間全モデル 7% / 週間 Fable 4% / 利用クレジット 100% 使用」に対し、popup 表示は「current 3% / 6% / 2% / 100%」。値がまったく合っておらず、100% だけ利用クレジットと偶然一致
- **Codex**: 実値「週間利用上限 13% 残り」に対し、popup 表示は「月 15% / 0% / 100% + 週間 15% / 0% / 100%」。0% / 100% は SVG chart 軸ラベルの false positive、15% は近いが不正確、13% そのものは拾えていない

原因は複合的(SVG 除外なし、window 内 dedup なし、font-size や孤立度を見ていない、`nearbyContext` が element+parent のみで context の precise な label が取れない)。C3-b として改善策 5 点(SVG 除外・孤立度ボーナス・font-size ボーナス・window 別 dedup・threshold 引き上げ)を積んでも、サイトごとの微妙なズレは残る可能性が高い。

そもそも「値を **正確に** 拾う」は generic heuristic の得意分野ではなく、site-specific selector が必要な領域。親 plan §背景も「プロバイダ定義は同梱しない」を思想としていて、この思想を保ちつつ精度を上げるには **ユーザーに教えてもらう** が最も筋が良い。

## 決定

**v0.2.0 予定だった teach-mode(要素ピッカー・fingerprint 保存・stale 検出)を v0.1.0 に前倒しし、主 pipeline とする。auto detector は削除 or 候補提示に降格する。**

- 誤値表示(3% / 6% / 2% など)は tile fallback より確実に UX が悪い。「間違った値を出さない」を最優先
- teach-mode の schema (`TaughtMetric` / `AnchorFingerprint`) は親 plan §C2 で既に v1 定義済み。**書き込み経路と読み取り経路を実装するだけで動く**
- Claude / Codex のような「普通に良く設計された UI」は要素クリック 1 回で永久に読める。UX の手間はワンクリックのみ

## スコープ変更(親 plan §context 配分の差分)

| C | 親 plan での位置付け | 本 plan での扱い |
|---|---|---|
| C1 リポ骨格 | done | 変更なし |
| C2 storage schema | done(reorder テスト除く) | 変更なし(`TaughtMetric` / `AnchorFingerprint` を **実際に使う**側になる) |
| C3 自動解析エンジン | done(実 UI ノイズ有り) | **除外**: v0.1 runtime pipeline から外し、合成 regression fixture の reference として保持。picker tooltip が直接候補値をプレビューする |
| C3.5 **teach-mode**(新設) | — | **新設・v0.1.0 主 pipeline**。picker overlay + selector 生成 + fingerprint 保存 + 値抽出 + stale 検出 |
| C4 取得 pipeline | partial done | 分岐追加(mode='taught' の provider は selector で値取得、mode='embed' は tile、旧 mode='auto' は削除 or picker 起動ボタンに変換) |
| C5 options 統合画面 | partial done | 「**Track element**」ボタン追加(picker mode を起動して選択済ページを開く)。Provider settings に「教えた要素の label + selector + 最終読み取り値」表示追加 |
| C6 popup UI | partial done | 変更なし(metric 表示方式は same、backing の source が taught に変わるだけ) |
| C7 tile fallback | partial done | 変更なし。picker が拾えない or ユーザーが「これは tile でいい」と選んだ場合の受け皿 |
| C8 リリース準備 | partial done | privacy/listing/submission notes、検証・パッケージ script、タグ駆動 GHA、合成 HTML 由来スクショを追加。ストア提出は外部操作として残る |

実行順序: **C3.5(teach-mode 実装) → C4 分岐追加 → C5 UI 追加 → 実機確認 → 残り(C7 / C8)**

## C3.5: teach-mode 実装(章別詳細)

### C3.5-a: pure function 層(先行実装・TDD)

- `src/content/teach/selector.ts`: element から CSS path + fingerprint を組む pure function
  - CSS path: `tag[.class1.class2][#id][:nth-of-type(N)]` を親方向に組む(全体で unique になる最短形)
  - fingerprint: `tagName` / `role` / `textFingerprint`(hash) / `nearbyLabel`(近傍テキスト先頭 40 char) を捕捉
- `src/content/teach/extract.ts`: element から数値抽出 pure function
  - 優先順: `aria-valuenow` → `<progress>` の `value/max` → textContent の `\d+(\.\d+)?%?`
  - unit 推定: `%` があれば percent、`$` があれば dollars、`credits?/tokens?` 語彙で credits/tokens
- 単体テスト: 合成 fixture で selector 生成が再選択可能なこと + 各種 element から値が正しく抽出されること

### C3.5-b: picker overlay(content script)

- `src/content/teach/picker.ts`: overlay UI + mouse ハンドラ
  - `chrome.runtime.onMessage` で `START_PICKER` 受信 → picker mode ON
  - `mouseover`: element を橙枠でハイライト + tooltip で候補値プレビュー
  - `mouseout`: ハイライト解除
  - `click`: element を capture し、`selector.ts` + `extract.ts` を呼んで結果を background へ送信 → picker mode OFF
  - `keydown`(ESC): picker mode OFF
  - 副作用: capture 中は body に `pointer-events: none` の透明 overlay を敷いて元ページの click を吸収

### C3.5-c: background 側の taught 保存経路

- 新メッセージ `SAVE_TAUGHT_METRIC`: `{ providerId, metric: TaughtMetric }`
- background で `upsertProvider` の `metrics` 配列に追加 + `mode` を `taught` に切り替え
- capture pipeline(親 plan §C4)は既に taught 経路を分岐実装できる余地あり(schema 上の mode 分岐がすでに存在)

### C3.5-d: taught 経路の値取得(content script)

- 既存 `detectUsage` の呼び分けを `detectUsage` or `readTaught` に変更
- `readTaught`: provider.metrics の各 TaughtMetric について:
  - `document.querySelector(selector.selectors[0])` で element 引く
  - 見つからなければ fingerprint(nearbyLabel + textFingerprint) で fallback 探索
  - それでも見つからなければ **needs_re-teach** ステータス
  - 引けたら `extract.ts` で値抽出
- 結果を `NormalizedSnapshot` に詰めて既存経路に流す

### C3.5-e: stale/再教育 検出(親 plan §v0.2 から前倒し)

- 値取得失敗が **連続 3 回** 続いたら runtime state を `needs_teaching` に遷移
- popup の異常アコーディオンに「教え直しが必要」カード表示(既存 needs_permission と同じ枠)
- options 側で「Re-teach」ボタン(既存 Track element と同じ picker を再起動)

### C3.5-f: options に「Track element」ボタン追加(既存 C5 に混ぜる)

- Provider settings セクションに「Track this element」ボタン追加
- クリック: 対象タブを findMatchingTab で探す → 無ければ新規タブ open → tab.id に `START_PICKER` メッセージ送信
- 教え終わったら options 側は自動再取得して「教えた metric」欄に反映

## 完了条件(v0.1.0 リリース定義・書き換え)

- サンプル 2 件(Claude / Codex)を登録 + それぞれ 1 回ずつ「Track element」で教えた状態で、popup に **実値と一致する 1〜複数個の metric** が並ぶ
- teach したことのない provider は tile fallback として popup 下部アコーディオンに並ぶ(旧仕様と同じ)
- 教えた element がページ改訂で見つからなくなったら popup で「教え直しが必要」カードとして提示され、Re-teach で修復できる
- permission 拒否シナリオは変更なし(needs_permission カード + Allow access / Delete ボタン)
- Chrome Web Store と AMO の両ストアに v0.1.0 を提出済(審査結果は問わない)
- README / CLAUDE.md / privacy policy / LICENSE(MIT) が pivot 後の実装と整合(`repo-consistency` / `changelog-freshness` 緑)

## 工数感

- C3.5-a pure function 層: 0.5 日(TDD 込)
- C3.5-b picker overlay: 0.5 日
- C3.5-c background 保存経路: 0.25 日
- C3.5-d taught 経路の値取得: 0.5 日
- C3.5-e stale 検出: 0.25 日
- C3.5-f options UI: 0.5 日
- 実機確認 + 微調整: 0.5 日
- **合計: 3 日規模**

C3-b の「auto detector 5 点改善」で同等以上の労力を掛けても Claude / Codex の精度は 100% 保証されない。teach-mode に振ったほうが同工数で確実に価値が出る。

## リスク

- **selector fragility(サイトの UI 改訂で selector が壊れる)**: C3.5-e で stale 検出 + Re-teach ボタンを入れることで対処。技術的には常に発生しうる問題だが、UX 上「壊れたら教え直す」の 1 手で復旧できる状態を維持する
- **picker overlay の副作用(元ページの機能を壊す)**: `pointer-events: none` の透明 overlay で元ページのクリックを吸収する設計にする。picker mode OFF 時は完全除去。副作用テストを Claude / Codex で必ず実施
- **fingerprint 単体では unique 保証がない**: selector 主軸、fingerprint は fallback として使う。fingerprint fallback は「セレクタ壊れた場合の救済」であって「正確に同じ element を引く保証」ではない。fallback で不整合が出たら needs_re-teach に落とす方針で許容する

## 親 plan への反映

- `docs/local/plan_v0.1.0-mvp.md` §context 配分 の C3 を「降格(候補提示のみ)」に更新
- 同 §context 配分 に C3.5(teach-mode) を新設
- 同 §残タスク に C3-b(auto detector 5 点改善) は「本 pivot により不要化」として punt 記述
- 同 §完了条件 は本 plan §完了条件で上書き

## 参照

- 親 plan: `docs/local/plan_v0.1.0-mvp.md`
- 実 Claude / Codex 動作検証時の会話: 2026-07-14(セッション内)
- schema 既定義: `src/shared/schema.ts` の `TaughtMetric` / `AnchorFingerprint`
- 参考実装(picker 系): 未特定(必要なら DevTools の element picker or MetaMask の Snap dashboard picker を参考にする)

## 実装時の必須手順(引継ぎ用・毎回確認)

- **rebuild 忘れ防止の 4 段セット**: コード修正 → `pnpm test`(通過) → `pnpm run build`(dist 更新) → `chrome://extensions/` で many-ai-usage の ↻ → 対象タブ close→reopen。前ターンで `pnpm test` だけで満足して build を飛ばし、実機で 2 ターン無駄にした事故があった。detector / content script / background に触るときは特に厳守
- **secrets-scan 責務**: 動作確認で取得した実 HTML / 実アカウント ID / 実残量値を fixture・ドキュメントに貼らない。合成データで組む(親 plan §実行時の共通ルール参照)
- **ビルド / コミットは指示があるまで自動実行しない**(親 plan と同じ)

## 実装開始前の一時実装(解消済み)

- `StorageDump` コンポーネントと `.storage-dump` 系スタイルは削除済み(v0.1.0 の公開画面にデバッグ JSON を残さない)。Diagnostics は既存の要約表示を維持し、詳細な storage dump は v0.2 以降で別途設計する。
- `tests/detector.test.ts` に「Japanese remaining percentage」「Codex-shaped nested Japanese percentage」の 2 テストが追加済み。auto detector を降格しても、これらは i18n regex の regression 防止として残す価値あり(削除しない推奨)
