---
type: plan
status: planned
tags: [v0.1.0, teach-mode-hardening, blocker, release]
owner: ishizakahiroshi
review_status: draft
related: [plan_teach-multi-metric-continuous.md, plan_try-samples-onboarding.md, review_teach-mode-ux_2026-07-16.html, design_unpacked-testing-guide_2026-07-16.html]
last_reviewed: 2026-07-16
due: 2026-07-23
---

# plan: v0.1.0 teach-mode hardening — 既知バグ 3 件を v0.1.0 出荷前に潰す

## 背景

v0.1.0 の実機テスト（`design_unpacked-testing-guide_2026-07-16.html` セッション）で teach-mode に **3 件の UX 課題**が確認された:

1. **同 URL タブ複数時の picker 迷子** — 意図しないタブに picker が飛ぶ（エンドユーザーへの案内が「古いタブを閉じてください」で説明しにくい）
2. **複数 metric 追跡時に Track this element を N 回押す必要** — Codex の週間 + 残クレジット追跡等で UX が悪い
3. **picker tooltip "2026%" 誤検出** — 日付の年号を数値候補として拾う

当初はこの 3 件を v0.1.1 or v0.2 で対応する予定で `plan_teach-multi-metric-continuous.md` に落としていた。しかし **「エンドユーザーが最初に触るバージョンでこの UX を出したくない」との user 判断**（2026-07-16）により、**v0.1.0 のリリース前に全 3 件を潰す**方針に変更。

## 昇格した内容（v0.1.1 → v0.1.0）

`plan_teach-multi-metric-continuous.md` の以下の実装項目を v0.1.0 に取り込む:

- **案 D**: Track this element を押したら拡張が新規タブで provider URL を開いて picker 注入（既存タブは探さない）
- **Continuous picker mode**: 対象タブに floating panel を出して 1 セッションで複数 metric 追加可能
- **reset anchor 自動推測**: teach 中は値クリック 1 回で完結・reset は自動抽出
- **picker heuristic 改善**: 4 桁年号除外 / "リセット" 文脈除外 / % 記号近接優先 / 単位付き優先

## 実装範囲

### A. 拡張本体コード

**元 plan (`plan_teach-multi-metric-continuous.md`) の「変更範囲」節 A〜C（14 実装ステップ）をそのまま実施**する。詳細（変更ファイル・関数名・schema）は元 plan を正典として参照する（本 md では重複しない）。

- 対象: `src/background/index.ts` / `src/content/teach/` / `src/content/detector/` / `src/shared/messages.ts` / `src/options/main.tsx`
- テスト: `tests/` に detector 候補優先順位・Continuous mode 状態機械・START_PICKER 新規タブ挙動を追加

### B. v0.1.0 リリース向け追加更新

拡張本体だけでなく、リリース周辺ドキュメントも「Continuous mode を持つ v0.1.0」に合わせて更新する:

1. **`CHANGELOG.md`** — v0.1.0 のエントリに teach-mode の Continuous mode / 新規タブ picker / heuristic 改善を追記
2. **`docs/release-notes-v0.1.0.md`** — リリースノートを「Continuous mode 対応版」に書き換え
3. **`docs/store/listing.ja.md` / `listing.en.md`** — 主な機能に「複数の metric を 1 タブで連続追跡」を明記
4. **`docs/store/submission-notes-v0.1.0.ja.md` / `.en.md`** — 審査担当者向けに「provider の usage ページを新規タブで開いて picker を注入する」動作を追記
5. **`articles/many-ai-usage/usage.html`（github.io リポ側）** — S-02 練習場の手順を Continuous mode 用に改訂 / S-04 FAQ から「同 URL タブが複数あるとき」項目を削除
6. **`docs/local/design_unpacked-testing-guide_2026-07-16.html`** — 「6. 既知の問題」セクションを削除（もう存在しないため）+ T4 teach-mode の手順を Continuous mode 版に差し替え

### C. plan md の後始末

7. **`plan_teach-multi-metric-continuous.md`** の H1 を `[統合済み → v0.1.0 hardening]` にし、frontmatter を `status: done` に。以降は本 md（`plan_teach-hardening-v0.1.0.md`）が正典
8. **本 md** の H1 を `[完了]` に、frontmatter を `status: done` に

## 実装ステップ

1〜14. `plan_teach-multi-metric-continuous.md` の実装ステップ 1〜14 と同一（拡張本体コード + テスト + typecheck + build + unpacked 実機動作確認）
15. `CHANGELOG.md` に teach-mode 改修点を追記
16. `docs/release-notes-v0.1.0.md` を書き換え（Continuous mode + 案 D + heuristic 改善を明記）
17. `docs/store/listing.ja.md` / `listing.en.md` 主機能に「複数 metric を 1 タブで連続追跡」を追記
18. `docs/store/submission-notes-v0.1.0.ja.md` / `.en.md` の「Reviewer notes」に「新規タブでの picker 起動」を追記
19. `C:\dev\works\github.io\articles\many-ai-usage\usage.html` を Continuous mode に合わせて改訂・github.io 側で commit + push
20. `docs/local/design_unpacked-testing-guide_2026-07-16.html` を Continuous mode 版に更新（既知の問題節を削除、T4 手順を差し替え）
21. 更新した実機テストガイドで Chrome / Firefox の T1〜T5 を全緑まで通す
22. `plan_teach-multi-metric-continuous.md` を `[統合済み]` に更新
23. 本 md の H1 を `[完了]`、frontmatter を `status: done` に更新
24. v0.1.0 のタグ切りへ進む（`git tag v0.1.0 && git push --tags`）→ ストア提出フェーズ

## 検証

unpacked 実機テストで以下がすべて満たされること:

- **案 D 検証**: 同 URL タブが 2 個開いている状態で Track this element → 3 個目のタブとして拡張が provider URL を開き、そこに picker が出る（既存 2 タブに picker が飛ばない）
- **Continuous mode 検証**: Codex で Track this element → 週間利用上限 → 保存 → 続けて残りのクレジット → 保存 → 完了ボタン → options に戻ると Codex CLI に metric 2 個並ぶ
- **heuristic 検証**: Codex ページで picker tooltip が「2026%」ではなく「0 %」「62 %」等の正しい候補を表示
- **既存機能の回帰なし**: Try samples フロー / 冪等性 / 使い方ページ遷移 は従来通り動く

## リスク

- **v0.1.0 リリースが数日〜1 週間遅れる**（元々 unpacked テスト段階なので大きな遅延ではないが、当初想定より延びる）
- **拡張の追加コード量が増える** → ストア初回審査が長引く可能性（複雑度は低いので影響軽微）
- **Continuous mode の floating panel が対象ページの Shadow DOM / iframe と衝突する可能性** → Shadow DOM でカプセル化して対処（元 plan の「リスク」節参照）
- **v0.1.0 出したあとに Continuous mode で更なる UX 問題が見つかる** → v0.1.1 で継続改善（本 plan の完了条件ではない）

## 完了条件

- 上記 24 ステップ完了
- Chrome / Firefox の unpacked で `design_unpacked-testing-guide` の 5 シナリオすべて緑
- 「6. 既知の問題」節が空になる（3 件全部解消）
- `plan_teach-multi-metric-continuous.md` が `[統合済み]` になる
- 本 md の H1 に `[完了]`
- `git tag v0.1.0` が切られている

## 実装担当

次セッション。作業リポ = `C:\dev\github\public\many-ai-usage` + `C:\dev\works\github.io`（usage.html 改訂のため 2 リポ跨ぐ）。実装は 1 セッションで走り切るのは重い可能性あり（14 + 10 ステップ）。分割するなら:

- **A セッション**: ステップ 1〜14（拡張本体 + テスト + build 緑）
- **B セッション**: ステップ 15〜24（ドキュメント更新 + 実機テスト再走 + タグ切り）
