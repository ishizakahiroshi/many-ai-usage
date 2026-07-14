# many-ai-usage v0.1.0 未確定論点シート 決定記録

> 出典: `review_v0.1.0-mvp-open-topics_2026-07-14.html` の interactive セッション
> 決定日時(端末側): 2026-07-14(火) 01:29:59
> 決定者: ishizakahiroshi(1 人決定)
> 反映先: `plan_v0.1.0-mvp.md` の各 `<OPEN §Cx-y>`

## 決定サマリ

| ID | 論点 | 採択 |
|---|---|---|
| A1 | bundler の選定 (§C1-1) | 参考実装(always-pinned / tab-title-prefix)と同一の bundler に揃える |
| A2 | LICENSE (§C1-2) | MIT |
| B1 | runtime validator (§C2-1) | valibot |
| B2 | metrics 配列の MVP 範囲 (§C2-2) | 型は synthesis §3 準拠で全部入れる / v0.1.0 の writer は auto 由来のみ |
| B3 | stale 判定閾値 (§C2-3) | refreshIntervalMinutes × 2 |
| C-1 | 多言語ラベル辞書の置き場所 (§C3-1) | `src/content/detector/i18n/labels.ts` に静的テーブル |
| C-2 | shadow DOM 対応範囲 (§C3-2) | top document + open shadow root のみ |
| C-3 | confidence 採用閾値と tile fallback (§C3-3) | 閾値 0.6、下回ったら tile fallback |
| D1 | hydration wait (§C4-1) | MutationObserver quiet window 500ms + 上限 5 秒 |
| D2 | 手動再取得中に tab が閉じた時の handling (§C4-2) | error 状態にし、原因ラベルを `tab closed during refresh` にする |
| E1 | needs_permission の扱い (§C5-1) | runtime state の status enum に `needs_permission` を追加して凍結 |
| E2 | サンプル 2 件の URL 具体 (§C5-2) | Claude=`https://claude.ai/new#settings/usage` / Codex=`https://chatgpt.com/codex/cloud/settings/analytics#usage` |
| F1 | UI フレームワーク (§C6-1) | Preact (signals or classic) |
| F2 | popup の情報密度 (§C6-2) | lowest remaining の 1 metric を主表示 / それ以外は折りたたみ |
| F3 | icon 生成タイミング (§C6-3) | **C1 の直後に作る**(プロジェクトの顔を早く決める) |
| G1 | tile 化の条件 (§C7-1) | 候補ゼロ OR confidence < 閾値(§C3) の両方で tile 化 |
| G2 | tile に favicon を出すか (§C7-2) | host permission がある host のみローカル取得で表示 / 無ければ非表示 |
| H1 | version 戦略 (§C8-1) | **0.1.0 直出し**(0.0.1 での pipeline 動作確認は行わない) |
| H2 | privacy policy の置き場所 (§C8-2) | ishizakahiroshi.github.io に独立ページ |
| I1 | secrets-scan 実配線の動作確認タイミング (§Cross-1) | C1 完了直後に空 commit + テスト commit(合成 secret 入り)で確認 |
| I2 | Chrome/Firefox manifest 差分の吸収層 (§Cross-2) | build 時生成 (共通 base manifest + 差分パッチ) |
| I3 | bundler / UI framework の確定順序 (§Cross-3) | 参考実装(always-pinned / tab-title-prefix)を確認 → bundler → framework の順 |
| I4 | host permission 拒否後の provider entry の掃除 (§Cross-4) | 残す + popup で「permission 要求 or 削除」の 2 ボタンを添える |

## 各論点メモ

### B3

取得ボタン押したら即時取れる機能もほしいよね(→ 既に MVP スコープの「手動再取得」で担保。B3 章と popup 節にその役割を明記する)

### E2

- Claude: `https://claude.ai/new#settings/usage`
- ChatGPT Codex: `https://chatgpt.com/codex/cloud/settings/analytics#usage`
- 両方とも hash(`#`) 以降で view が切り替わる SPA。URL match は origin+path で判定し hash は無視する運用が必要

## 未解決の派生タスク

- **A1a**: 参考実装 `always-pinned` と `tab-title-prefix` の bundler / build 構成 / manifest 差分吸収の実採用を Read で確認して A1 を具体化する(次のマイルストーン)
- **H1 補償**: 0.1.0 直出しなので、release 前チェック(changelog-freshness / repo-consistency / secrets-scan) が確実に緑になることを C8 完了条件に組み込む
- **E2 派生**: content script の URL match で hash を無視する仕組みを §C4 の pipeline 設計に明記
- **F3 派生**: icon 初期セット作成を C1 の完了条件に組み込む(C8 では最終素材化に責務を残す)
