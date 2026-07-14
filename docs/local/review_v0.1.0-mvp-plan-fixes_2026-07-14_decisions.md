# plan_v0.1.0-mvp 齟齬修正シート 決定記録

> 出典: `review_v0.1.0-mvp-plan-fixes_2026-07-14.html` の interactive セッション
> 決定日時(端末側): 2026-07-14(火) 02:22:54
> 決定者: ishizakahiroshi(1 人決定)
> 反映先: `plan_v0.1.0-mvp.md`、`review_v0.1.0-mvp-open-topics_2026-07-14_decisions.md`(表記整合)

## 決定サマリ

| ID | 論点 | 採択 |
|---|---|---|
| A1 | 決定 ID の C1/C2/C3 が plan 章 C1/C2/C3 と表記衝突(優先度 高) | 決定 ID を `C-1` / `C-2` / `C-3` のハイフン区切りに変える |
| A2 | `page_only` が runtime state か snapshot source かで揺れ(優先度 高) | 「snapshot の <code>source</code> を <code>page_only</code> にし、runtime state の <code>status</code> を <code>ok</code>(表示型) にする」に書き換え |
| A3 | ダークモードが MVP スコープ「含む」に明記なし(優先度 中) | §C6 から削除して v0.2 ロードマップへ移す |
| A4 | C4 完了条件が permission 許可済みを暗黙前提(優先度 低) | C4 完了条件を「permission 許可済み host で content script が snapshot を書き込める」に抽象化し、popup 反映は C6 完了条件へ移す |
| A5 | v0.1.0 リリース完了条件も permission 許可済み前提(優先度 低) | 「(permission 許可済みシナリオで) 自動解析結果が並ぶ / 拒否シナリオでは needs_permission カードが並ぶ」の 2 系統を並記 |

## plan への反映方針

- **A1**: plan §C3 章内の「(C1 決定)」「(C2 決定)」「(C3 決定)」を「(決定 C-1)」「(決定 C-2)」「(決定 C-3)」に。前回 decisions md の 3 行(C1/C2/C3)も同時に `C-1/C-2/C-3` にリネームして整合
- **A2**: §C3 の「runtime state で page_only に落とす」と §C7 の「runtime state を page_only に落とす」を、schema の 2 概念(snapshot.source と runtime state.status)に分解した表現へ
- **A3**: §C6 やること節から「ダークモード: prefers-color-scheme に追従(実装最小)」を削除。v0.2 ロードマップに「ダークモード対応」を追加
- **A4**: §C4 完了条件 1 行目を pipeline 単体で検証可能な形に抽象化(popup 反映は §C6 完了条件へ移動)
- **A5**: v0.1.0 リリース完了条件 1 行目を許可済み/拒否の 2 系統並記に
