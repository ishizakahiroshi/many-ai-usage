# plan_v0.1.0-mvp ビジュアル v3 決定記録

> 出典: `design_v0.1.0-mvp-visual_2026-07-14.html` の v3 での確定
> 決定日時: 2026-07-14(火)
> 決定者: ishizakahiroshi(1 人決定)
> 反映先: `plan_v0.1.0-mvp.md`

## 決定サマリ(v3 で確定した 7 点 + 1)

| ID | 論点 | 採択 |
|---|---|---|
| V1 | popup 寸法 | 幅 560px × 高さ最大 600px 固定(Chrome/Firefox 制限内の実用スイートスポット) |
| V2 | popup 情報密度(**F2 差し戻し**) | 「lowest 1 metric + 折りたたみ」ではなく **1 プロバイダ 1 行に全 window ミニバー横並び**。lowest は色 + ▶ マーカー + オレンジラベルで強調 |
| V3 | popup 順序 | 登録順で固定・自動ソートなし。並べ替えは options でユーザー手動のみ |
| V4 | 異常状態の見せ方 | popup 下部に `▼ 対処が必要 · N 件` アコーディオン。needs_permission カードと tile カードを集約 |
| V5 | 行内展開 | popup の各プロバイダ行に「▾」ボタン。展開で confidence / source / 取得時刻 + [開く][設定] を下に表示 |
| V6 | URL 変更時 | options で URL の origin を変更すると host permission を再要求 |
| V7 | §C5 / §C6 の統合 | 登録 UI と詳細ビューを分離せず、**options を「サイドバー + 統合パネル」1 画面**に。C5 = options / C6 = popup で責務分離 |
| V8 | ドラッグ並べ替え | options サイドバーで手動ドラッグ並べ替えを MVP に含める(1 人 UX の中核) |

## 昇格ロジック(状態遷移)

- **needs_permission → 許可**: 上部の通常バー領域の「登録順の予約席」に戻る(位置は動かない)
- **needs_permission → 削除**: provider が消える
- **tile → 再解析で拾えた**: 上部の通常バー領域の「登録順の予約席」に戻る
- **tile → 開いて閉じた**: 次回の user visit capture で自動的に snapshot 上書き

## F2 差し戻しの記録

- 元 F2 決定(2026-07-14 未確定論点シート): lowest remaining の 1 metric を主表示 / それ以外は折りたたみで見せる
- **v3 差し戻し(V2)**: 全 window をミニバー横並びで見せる。lowest は色/マーカー/ラベル色で強調(位置固定)
- 差し戻し理由: (1) 実 AI サービスの usage 表示は水平バーが主流、(2) 5h + weekly 両方持ちのプロバイダで片方が見えない情報欠落、(3) 「▶ lowest」の視覚強調で lowest 選択の意思決定コストは維持されている

## popup 実装仕様(V1〜V5 の集約)

- 幅 560px × 最大高さ 600px
- 1 プロバイダ 1 行、行高 ~52px(展開時は追加 +40px)
- 行内グリッド: `名前(82px) + windows(1fr) + ↻(30px) + ▾(30px)`
- windows は grid で 1/2/3 分割(プロバイダの window 数で切替)
- window 数バリエーション: 3(Claude: 5h+wk+mo) / 2(OpenCode: 5h+wk) / 1(Copilot: mo のみ / Codex: wk のみ) / 特殊(Ollama: ローカル・上限なし表示)
- 色: 70%+ = --ok / 30〜70% = --warn / 30%未満 = --bad(数値必ず併記)
- lowest 強調: オレンジ枠 + オレンジラベル + `▶` マーカー
- 順序変更禁止(自動ソートしない)
- popup 下部アコーディオン: `▼ 対処が必要 · N 件`。閉じ状態は 1 行ヘッダ、開くと needs_permission と tile が並ぶ
