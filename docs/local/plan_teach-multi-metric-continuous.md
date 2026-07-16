---
type: plan
status: planned
tags: [teach-mode, picker, ux, multi-metric, new-tab]
owner: ishizakahiroshi
review_status: draft
related: [plan_try-samples-onboarding.md]
last_reviewed: 2026-07-16
due: 2026-07-30
---

# plan: teach-mode 刷新 — 新規タブで開いて Continuous mode で複数 metric を一気に teach

## 背景

v0.1.0 の実機動作確認（2026-07-16 セッション）で teach-mode の UX 問題が 2 件見つかった:

1. **同じ URL のタブが複数開いていると、意図しないタブに picker が注入される**
   - 症状: user が 2 つの Codex usage タブを開いていた状態で Track this element を押すと、古い方のタブ（0% 残り）に picker が飛び、user が見ていた新しい方のタブ（100% 残り）ではなかった
   - 応急処置: 「古い方のタブを閉じて再試行」だが、エンドユーザーに案内できるレベルではない
2. **1 つの provider に複数の metric（例: 5-hour 制限 + 週次制限 + 残クレジット）を teach したい時、Track this element を metric の数だけ押す必要がある**
   - Codex の場合: 週間利用上限 (0%) と 残りのクレジット (0) を両方追跡したいが、現状は 2 セッション必要
   - 途中で流れが途切れる（options ↔ usage ページを往復）ため UX が悪い

会話で「拡張が provider.url を新規タブで開けば曖昧性がゼロ」「複数 metric は 1 タブで連続追加できるべき」との user フィードバックを受けて本 plan を起こす。**v0.1.0 リリースは現状の UX で出し、この改善は v0.1.1 or v0.2 の feature として次セッションで実装する**（v0.1.0 は blocker ではない）。

## 目標 UX

### 案 D: 新規タブで開いて picker を注入

- Track this element を押すと、拡張が **`chrome.tabs.create({ url: provider.url, active: true })`** で新規タブを開き、そのタブが load 完了した瞬間に picker を注入する
- 既存タブがあろうがなかろうが、対象タブは 1 つに決まる（曖昧性ゼロ）
- ログイン状態は cookie 共有で維持される

### Continuous picker mode: 1 タブで N 個の metric を追加

- picker が起動すると同時に、対象タブの右上に **floating panel** が現れる:
  ```
  ┌─ many-ai-usage 学習中 ─────────────┐
  │ 追跡したい数値をクリック            │
  │                                    │
  │ 保存済み: 0 個                     │
  │                                    │
  │ [完了して戻る] [キャンセル]         │
  └────────────────────────────────────┘
  ```
- 数値をクリックするたびに **保存 → panel が更新**:
  ```
  保存済み: 2 個
  ・週間利用上限 (0%)  [名前を変える] [削除]
  ・残りのクレジット (0)  [名前を変える] [削除]
  ```
- 「完了して戻る」で確定 → options タブに戻る → dashboard に全 metric 反映
- 「キャンセル」or Esc で全て破棄

### metric の名前は自動抽出

- クリックしたエレメントの近くにある text (`nearbyLabel`) を候補として拾う
- 例: `週間利用上限` `残りのクレジット` `5-hour window` `Premium requests`
- panel 上で「名前を変える」で編集可能。後から options でも編集できる

### Reset anchor は自動推測（明示 teach しない）

- 値の近くに「リセット: 2026/07/22」や「Resets in 4 days」があれば **自動抽出**
- picker では reset anchor を明示的に選ばせない（毎回 2 クリック要求は UX 重い）
- 自動推測が失敗した metric は options で個別に「reset を re-teach」ボタンから修正可能（後付け）

## 現状の実装（変更対象）

- `src/background/index.ts`: START_PICKER ハンドラで既存マッチングタブを検索して inject
- `src/content/teach/`: picker overlay 実装（1 クリックで完結・panel なし）
- `src/options/main.tsx`: Track this element ボタン + trackSelected() 関数
- `src/shared/schema.ts`: `TaughtMetric` (valueAnchor / resetAnchor 別々)

## 変更範囲

### A. 拡張本体コード

1. **`src/background/index.ts`**
   - START_PICKER ハンドラを変更: 既存タブ検索を廃止 → `chrome.tabs.create({ url: provider.url, active: true })` で新規タブを開く
   - `pendingPickerByTabId: Map<tabId, { providerId }>` で新規タブへの picker 起動待ちを保持
   - `chrome.tabs.onUpdated` リスナーで status='complete' を待って、対応する pendingPicker があれば content script に `START_PICKER` メッセージ送信

2. **`src/content/teach/`（overlay 実装）**
   - Continuous mode の状態管理を追加（1 クリック → 保存 → picker 継続）
   - Floating panel（Preact or vanilla DOM）を right-top に固定表示
     - "追跡したい数値をクリック" ヒント文
     - 保存済み一覧（label / 値 / [名前を変える] / [削除] ボタン）
     - [完了して戻る] / [キャンセル] ボタン
   - panel から `SAVE_METRIC` / `RENAME_METRIC` / `REMOVE_METRIC` / `DONE_TEACH` / `CANCEL_TEACH` メッセージを background に発信
   - Esc キー: [キャンセル] と同義
   - 完了時: 対象タブを閉じて options タブにフォーカス戻す（or ユーザー設定で残す）

3. **`src/shared/messages.ts`**
   - 上記の新規メッセージ型を追加

4. **`src/options/main.tsx`**
   - trackSelected() を「新規タブで開く + Continuous mode で起動」に対応
   - Continuous mode 終了時に自動 reload で dashboard 反映（既存 storage.onChanged リスナーで対応可能）
   - metric ごとに個別削除ボタンを追加（現状の Re-teach と併記）

### B. schema・データ

- `TaughtMetric` schema は変更なし（valueAnchor + resetAnchor + metricId + label のまま）
- reset anchor は Continuous mode の中では取らない → 自動推測に頼る（現状の heuristic を再利用）
- 後付け reset teach 用に options 側に「reset を教え直す」ボタンを追加（別 sub-flow）

### C. テスト

5. **`tests/`**
   - `background`: START_PICKER が新規タブを開いて pending picker を記録するか（mock chrome.tabs）
   - `background`: onUpdated で対応する pendingPicker が起動するか
   - `content`: Continuous mode で複数 metric を追加できるか（DOM simulation）
   - `content`: floating panel の [完了して戻る] / [キャンセル] / Esc の動作

### D. ドキュメント

6. **`docs/store/submission-notes-v0.1.x.md`**
   - teach-mode の新しい UX を審査担当者向けに追記
   - "拡張が provider の URL に新規タブを開き、そのタブに picker を注入する" を明記
7. **usage.html（github.io 側）**
   - S-02 練習場の手順を新 UX に合わせて改訂（別 plan md で対応 or 同 md に含める）
   - 「Track this element を押すと拡張が対象タブを開き、picker が起動します」

## 実装ステップ

1. `src/background/index.ts`: START_PICKER を新規タブ open に切り替え、pendingPicker Map + onUpdated リスナー追加
2. `src/shared/messages.ts`: `SAVE_METRIC` / `RENAME_METRIC` / `REMOVE_METRIC` / `DONE_TEACH` / `CANCEL_TEACH` メッセージ型追加
3. `src/content/teach/`: floating panel を DOM で追加、Continuous mode の状態機械実装
4. `src/content/teach/`: panel → background のメッセージ送信配線
5. `src/background/index.ts`: 新規メッセージハンドラで storage に metric を merge / rename / remove
6. `src/options/main.tsx`: trackSelected() を新 UX に対応、metric 個別削除ボタン追加
7. テスト追加・更新
8. `pnpm run typecheck` + `pnpm test` + build 緑
9. Chrome / Firefox unpacked で実機動作確認
10. github.io の usage.html S-02 練習場を新 UX に合わせて改訂
11. store submission notes を v0.1.x として更新
12. 本 md の H1 に `[完了]` を付与 + status: done

## 検証

- Track this element → 新規タブが開く（既存の同 URL タブがあっても新規で開く）
- 対象タブに floating panel が右上に出る
- 数値クリック → 保存 → panel の 保存済み数字が増える
- 複数 metric を連続追加できる
- 各 metric の名前が自動抽出される（近くの text label から）
- [完了して戻る] → タブが閉じて options に戻る → dashboard に全 metric が並ぶ
- [キャンセル] / Esc → 全 metric 破棄・options に戻る（何も保存されない）
- reset anchor が自動抽出される（テスト対象: 「リセット: 2026/07/22」形式の text）
- 既存 provider の metric 編集は options 側で個別 rename / delete 可能

## リスク

- **既存 v0.1.0 ユーザー影響**: 既に teach 済みの metric は保存されたまま残る（schema 変更なし・storage 互換維持）。新規 teach セッションだけ挙動が変わる
- **タブが増える**: Track を N 回押すと毎回新規タブが開く。teach 完了時に自動でタブを閉じる or user 設定で選択可能に
- **content script の権限**: 新規タブが即 load → picker 注入までのラグ（数秒）。picker 起動前に user が操作を始めると混乱するので、load 完了までは panel を "loading" 表示にする
- **floating panel の DOM 衝突**: 対象ページの z-index や shadow DOM と衝突する可能性。Shadow DOM でカプセル化するのが安全
- **Continuous mode の "何度もクリック" によるサービス側の疑心**: 正常な user 操作なので通常は問題なし。ただし短時間に大量クリック時は picker 側で軽く debounce

## 関連（後続 bugfix）

本 plan で扱わない・別 md で対応する項目:

- **`bugfix_picker-year-misdetection.md`（未起草）**: picker のヒューリスティックが「リセット: 2026/07/22」の "2026" を数値候補（"2026%"）として誤検出する件。4 桁の数字を年号として除外・「%」記号との近接度を優先・「リセット」文言があれば日付扱い、等の改善が必要。本 plan の Continuous mode 実装後に別途対応

## 完了条件

- 上記 12 ステップ完了 + テスト緑 + 実機動作確認済み
- 本 md の H1 に `[完了]` を付与
- v0.1.1 or v0.2 リリースフローに本 feature を組み込む

## 実装担当

次セッション。作業リポ = `C:\dev\github\public\many-ai-usage`。v0.1.0 リリース後の任意タイミングで着手。
