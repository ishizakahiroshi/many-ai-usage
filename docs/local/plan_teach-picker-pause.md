---
type: plan
status: done
tags: [teach-mode, picker, ux, pause, v0.1.x]
owner: ishizakahiroshi
review_status: draft
related:
  - plan_teach-multi-metric-continuous.md
  - plan_teach-hardening-v0.1.0.md
  - design_unpacked-testing-guide_2026-07-16.html
  - recap_2026-07-19_firefox-unpacked-dogfood.md
last_reviewed: 2026-07-19
due: 2026-08-02
---

# [様子見] teach picker 一時停止 — ページ操作・コピーを teach 中に可能にする

## context配分

| C | 種別 | 内容 | 並列 |
|---|---|---|---|
| C1 | fix | Pause/Resume の UX 確定と panel 文言・状態遷移 | — |
| C2 | fix | `picker.ts` で capture / highlight を Pause 中オフ、Resume で復帰 | — |
| C3 | fix | i18n・options/popup ヘルプ・unpacked ガイド追記 | [並列OK with C4] |
| C4 | fix | 単体・実機（Chrome 優先 → Firefox）と完了条件確認 | [並列OK with C3] |

実行順序: `C1 → C2 → (C3, C4)`

---

## この md を開いた AI へ

`<このファイルパス> これやって` だけで実装セッションを始められること。  
ユーザー明示があるまで **commit / push / tag / ストア提出 / ビルドを AI から勝手に始めない**（型チェック・テストは可。ビルドはユーザーが動作確認すると言ったとき、または本 plan の検証で明示されたとき）。

秘密情報・実アカウントの usage 値・Cookie をコード・fixture・docs に書かない。

---

## 概要

**問題:** Continuous teach（右上 panel + オレンジ marker + window capture）中は、ページ上のテキスト選択・コピー・通常クリックが使いづらい。ユーザーが usage ページ上で説明文や数値をコピーしたいときに teach を **Cancel してからやり直す**しかない。

**目的:** teach セッションを破棄せず、**一時停止（Pause）** してページを普通に操作でき、**再開（Resume）** で同じ Saved 一覧のまま teach に戻れるようにする。

**スコープ外（やらない）:**

- 修飾キー押しながらだけ teach（別案。今回は Pause を採用）
- スターター「プロバイダ名指定 import」（2026-07-19 判断で過剰・見送り）
- teach 自体の自動開始 / 常時マーカー
- v0.1.0 ストア申請ブロック扱い（本 plan は **v0.1.x 改善**。申請を止めない）

**きっかけ:** 2026-07-19 dogfood（Chrome Copilot / ページ操作）。会話で「一時停止」案を採用し、別セッション実装用に本 plan を起こした。

---

## 現状と問題

### 実装の要点（現状）

- 本体: `src/content/teach/picker.ts`
- teach 開始後、window capture で click を teach 用に処理
- host は `pointer-events: none`、panel だけ `pointer-events: auto`
- オレンジ `highlight-box` が hover 追従
- 終了: panel **Cancel** / **Esc**（破棄）または **Done and return**（保存して戻る）
- 文言の一部は picker 内ハードコード英語（panel HTML）。locale は popup/options 中心

### ユーザー影響

| やりたいこと | 現状 |
|--------------|------|
| 数値をクリックして teach | できる |
| ページ上のテキストを選択してコピー | **しづらい**（クリック横取り・マーカー） |
| 少しページを触ってからまた teach | Cancel → 再 Track（Saved が消える） |

### 採用しない案（メモ）

| 案 | 理由 |
|----|------|
| 修飾キー中だけ teach | 発見しづらい・モバイル無し。Pause の方が明示的 |
| teach を短くして毎回 Cancel 運用だけ | 運用で足りるが Continuous の価値を削る |
| 全面 overlay をやめる | SPA の click 横取り対策として capture が必要だった経緯あり（hardening） |

---

## 方針

### 目標 UX（C1 確定・実装済み）

右上 teaching panel に **トグル 1 ボタン**（`Pause page` ↔ `Resume teaching`）を追加する。

**Pause 中:**

- オレンジ marker・hover tooltip を消す
- teach 用の pointer/click capture を detach（Esc は残す）
- ページは通常どおり選択・コピー・スクロール・リンク可能
- panel は残す（hint: `Paused — page is free to select/copy. Resume to teach more.` + Resume + Cancel / Done）
- **Saved 一覧は保持**（破棄しない）
- metric 追加は不可（Resume が必要）

**Resume 中:**

- 再び capture + highlight を有効化
- 状態は Pause 前と同じ Continuous セッション

**Cancel / Esc / Done:**

- 現行どおり。Pause 中でも Cancel / Esc で全破棄、Done で保存可（Done は Saved≥1 のとき有効のまま）

### 状態機械（最小）

```
active  --Pause-->  paused  --Resume-->  active
  |                   |
  +-- Cancel/Esc/Done（終了）  <-- どちらからでも可
```

### 実装の当たり（C2 向け）

- `picker.ts` に `pickerSuspended`（または `paused`）フラグ
- Pause: `removeEventListener` で mousemove / pointerdown / click 系を外す、highlight 非表示、tooltip 非表示
- Resume: 同じ listener を付け直し、panel 文言更新
- panel の actions 行に Pause/Resume トグル 1 ボタン（または 2 ボタン）
- 二重 Pause や Resume 連打で listener 二重登録しない（idempotent に）

参照: `src/content/teach/picker.ts`（巨大・実装詳細は Read すること。理由: 動的に変わる本体）

---

## C1: Pause/Resume UX 確定

### 作業内容

- panel レイアウト案を 1 つに固定（トグル 1 ボタン推奨: `Pause page` ↔ `Resume teaching`）
- 日本語 UI 時の表示（options/popup が ja でも picker が en 固定なら、本 plan で **ja 併記 or i18n 接続**を C3 で決める）
- Pause 中に Done を押せるか: **可**（Saved があれば保存して終了）
- Pause 中に metric 追加: **不可**（Resume が必要）— 文言で明示

### 変更予定ファイル

- 本 plan の「方針」節を必要なら 1 行更新（実装前の最終メモ）
- コードは C2

### 完了条件

- 上記状態機械とボタンラベルが md 上で曖昧でない
- 却下案（修飾キーのみ）を再採用していない

---

## C2: picker 実装

### 作業内容

- `paused` 状態と Pause/Resume ハンドラ
- capture / highlight / tooltip の on/off
- listener の idempotent attach/detach
- Cancel / Esc / Done が Pause 中も動作
- 可能なら `diagLog` / `obsLog` に `picker.pause` / `picker.resume` を 1 行ずつ

### 変更予定ファイル

- `src/content/teach/picker.ts` — 本体
- 必要なら `src/content/index.ts` — メッセージ経路のみ（Pause は content 内完結が望ましい）

### 完了条件

- Pause 中にページでテキスト選択・コピーができる（実機 or 可能な範囲のテスト）
- Resume 後に Saved 件数が消えず、続けて metric クリックできる
- Cancel で Saved 破棄、Done で保存、の現行契約を壊さない
- `pnpm test` / `pnpm run typecheck` 緑

---

## C3: 文言・ドキュメント

### 作業内容

- picker 内英語のままなら最低限わかりやすい英語 + 必要なら shadow 内への簡易 i18n
- options の teach ヘルプに「Pause でページ操作できる」1 文
- `docs/local/design_unpacked-testing-guide_2026-07-16.html` の T4 またはトラブルシュートに Pause 手順を 1 ブロック

### 変更予定ファイル

- `src/locales/en.json` / `ja.json`（picker がキー参照する場合）
- `src/options/main.tsx` または teach ヘルプ文字列のみ
- `docs/local/design_unpacked-testing-guide_2026-07-16.html`

### 完了条件

- ユーザーが「コピーしたいときは Pause」と options/ガイドから辿れる
- 新規 skill は作らない（ガイド HTML 更新で足りる）

---

## C4: 検証

### 作業内容

- 自動: picker / teach 関連テストがあれば Pause の unit を最小追加。無ければ typecheck + 既存 teach テストが落ちないこと
- 実機（**Chrome 優先**）:
  1. Track 開始 → metric 1 件 Saved
  2. Pause → ページで文字列を選択してコピーできる
  3. Resume → Saved が 1 のまま → 2 件目 teach → Done
  4. Pause 中 Cancel → storage に途中 Saved が残らない
- Firefox は Chrome 緑のあと軽い回帰（一時アドオン + 同上の短縮）

### 完了条件

- 上記 1〜4 が Chrome で緑
- Firefox で致命的退行なし（マーカー常時など）
- 本 plan の `## context配分` を全 C `fix` にし、H1 を `[様子見]` へ（archive はユーザー判断）

### 検証ログ（2026-07-19 実装セッション）

- 自動: `pnpm test` 89/89 緑、`pnpm run typecheck` 緑。Pause unit 3 本追加。先行テストの document click リークを finally で掃除
- 実機 Chrome/Firefox: ユーザー未実施（unpacked 再読込後の dogfood を推奨）

---

## 禁止・停止条件

**禁止（ユーザー明示まで）:**

- `git commit` / `git push` / `git tag`
- ストア提出・release タグ
- 大規模リファクタ（picker の全面書き直し）
- 秘密・実 usage 数値の docs 貼付

**停止してよい:**

1. plan と矛盾する破壊的変更が必要になった
2. Pause と SPA capture の両立が技術的に破綻し、設計変更が必要（そのとき本 plan に判断ログを追記してユーザーへ）

**止まらない:**

- Pause ボタンの微文言、英語/日本語のどちらを先にするか → 既存 picker 英語 + options は ja の現状に倣う

---

## 完了報告フォーマット（各 C）

- 完了/未完了
- 変更ファイル一覧
- 検証結果 1 行
- context配分表 C\<N\> 更新済み: Y/N

---

## 関連

- Continuous teach 本体: `docs/local/plan_teach-multi-metric-continuous.md`（理由: 背景・panel 設計の正典が長い）
- Hardening: `docs/local/plan_teach-hardening-v0.1.0.md`（理由: overlay/capture 導入経緯）
- dogfood メモ: `docs/local/recap_2026-07-19_firefox-unpacked-dogfood.md`（理由: 同時期の実機知見）
