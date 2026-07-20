# [完了] popup D&D 並べ替え（options と同経路）

> ローカル実装: 2026-07-19(日) · typecheck / tests/i18n / tests/storage 緑。C1（`src/popup/main.tsx` の drag-handle, `draggedId` state, `.provider-row.dragging`）実装確認済み。
> 2026-07-20: unpacked 実機確認はリリース前の動作確認フェーズで実施。

## context配分

| C | 種別 | 内容 | 並列 |
|---|---|---|---|
| C1 | fix | popup 通常一覧に HTML5 D&D 並べ替えを追加（REORDER_PROVIDERS 再利用） | — |
| C2 | plan | unpacked 手動確認（popup ↔ options の order 共有） | — |

実行順序: `C1 → C2`

---

## 概要

popup ダッシュボード（プロバイダ行の一覧）で、設定画面と同じく **ドラッグ＆ドロップで表示順を変えられる** ようにする。永続化は既存の `ProviderConfig.order` + `reorderProviders` + `REORDER_PROVIDERS` をそのまま使う。options サイドバーの D&D は既に MVP で入っているので触らない。

**スコープ内**

- popup の **通常一覧**（metrics がある ok / warning / stale 行）での並べ替え
- ハンドル専用 UI（refresh / 詳細ボタンと誤操作分離）
- en / ja の aria・title 文言

**スコープ外**

- 「要対応」アコーディオン内の IssueCard 並べ替え
- キーボード並べ替え（↑↓）
- メトリクス（window）単位の並べ替え
- 新ライブラリ導入（SortableJS 等）
- ビルド / コミット / タグ（ユーザー明示指示があるまでやらない）

## 現状と問題（実装前）

### 既にあったもの（再利用）

| 層 | 場所 | 役割 |
|---|---|---|
| schema | `src/shared/schema.ts` | `ProviderConfig.order: number` |
| storage | `src/shared/storage.ts` `reorderProviders(ids)` | id 配列順で `order` を振り直して local storage に保存 |
| message | `src/shared/messages.ts` | `{ type: 'REORDER_PROVIDERS'; ids: string[] }` |
| background | `src/background/index.ts` | case で `reorderProviders` を呼ぶ |
| options UI | `src/options/main.tsx` | サイドバー ☰ + HTML5 drag、`REORDER_PROVIDERS` 送信 |

`getProviders()` は常に `order` 昇順で返す。popup も options も同じ並びを読む。

### 無かったもの

- popup (`src/popup/main.tsx`) は `order` 順で表示するだけ。D&D UI なし
- MVP 決定 V3 / V8（`docs/local/review_v0.1.0-mvp-visual-v3_2026-07-14_decisions.md`）: 「並べ替えは options のみ」

### ユーザー動機（2026-07-19）

popup 実機スクショで Claude → Codex → GitHub → Cursor → Ollama が一覧されている状態で、「順番を D&D で移動できると良い。設定画面も」と要望。設定は既にあるため、**popup への追加**が本 plan の本体。

## 方針

1. **ストレージ契約は変えない** — 新キー・新 schema なし。options と同じ `REORDER_PROVIDERS` + 全 provider id リスト
2. **通常一覧だけ D&D** — `normal` フィルタ後の行同士で drop。reorder 計算は **full `dashboard.providers` id 配列** 上で splice（options と同じ）。issue 行は一覧に出ないが full list 上の相対位置は保たれる
3. **ハンドルだけ `draggable`** — 行全体を draggable にすると refresh / 詳細クリックと衝突しやすい。☰ のみ
4. **`dataTransfer` を主経路** — drop 時に `getData('text/plain')` で fromId を取る（state の stale を避ける）。`draggedId` state は視覚フィードバック（`.dragging`）用
5. **ライブラリなし** — options と同じ素の HTML5 Drag and Drop

### 採用しない案

| 案 | 理由 |
|---|---|
| popup 専用の order キー | options とズレる・同期地獄 |
| 行全体 draggable | ボタン誤ドラッグ |
| 要対応も D&D | ステータス用アコーディオンで、順序 UX の主対象は通常一覧 |

## 禁止事項（この plan 実行時）

- `git commit` / `git push` / `git tag` はユーザー指示があるまで実行しない
- `pnpm run build` / `build:chrome` / `build:firefox` は明示指示があるまで実行しない（typecheck / test は可）
- 実アカウントの usage 値・Cookie・トークンを fixture / md に書かない
- options サイドバー D&D の書き換え・共通 lib 抽出はしない（スコープ外）

---

## C1: popup D&D 実装

### 状態

**2026-07-19(日) 実装済み**（再実装しない）。

### 作業内容（記録・再演用）

1. `src/popup/main.tsx`
   - `ProviderRow` に `dragging` / `onDragStart` / `onDragEnd` / `onDropOn` を追加
   - 行左に ☰ `.drag-handle`（`draggable`、`setData('text/plain', provider.id)`）
   - `article` に `onDragOver`（`preventDefault` + `dropEffect = 'move'`）と `onDrop`（fromId 取得 → `onDropOn`）
   - `PopupApp` に `draggedId` state と `reorder(fromId, toId)`:
     ```ts
     const ids = dashboard.providers.map((p) => p.id);
     const from = ids.indexOf(fromId);
     const to = ids.indexOf(toId);
     if (from < 0 || to < 0 || fromId === toId) return;
     ids.splice(from, 1);
     ids.splice(to, 0, fromId);
     await sendMessage({ type: 'REORDER_PROVIDERS', ids });
     setDraggedId(null);
     reload();
     ```
   - 通常一覧の `normal.map` にだけ drag props を渡す（IssueCard は対象外）

2. `src/popup/styles.css`
   - `.row-main` grid: `14px 70px minmax(0, 1fr) 30px 30px`（ハンドル列追加）
   - `.drag-handle` / `.provider-row.dragging` / `.row-details` の padding-left を 105px 前後へ調整

3. `src/locales/en.json` / `ja.json`
   - `popup.reorder`: "Drag to reorder" / "ドラッグで並べ替え"
   - `popup.reorderAria`: "Reorder {name}" / "{name} を並べ替え"

### 変更ファイル

- `src/popup/main.tsx`
- `src/popup/styles.css`
- `src/locales/en.json`
- `src/locales/ja.json`

### 完了条件（C1）

- [x] popup 通常行に ☰ が表示される
- [x] drop で `REORDER_PROVIDERS` が飛び、storage の `order` が更新される経路になっている
- [x] options の reorder 実装・message 契約を変えていない
- [x] `pnpm run typecheck` 成功
- [x] `pnpm exec vitest run tests/i18n.test.ts tests/storage.test.ts` 成功（en/ja キー対称 + reorderProviders 既存テスト）

### 検証ログ（C1）

- 2026-07-19: typecheck OK / i18n+storage 11 tests passed

---

## C2: unpacked 手動確認

### 作業内容

1. 拡張を再読み込み（Chrome / Firefox どちらか dogfood 中の方。両方できれば望ましい）
2. popup を開き、通常一覧が **2 件以上** ある状態にする
3. ☰ を掴んで別行へ drop → 表示順が即変わる
4. popup を閉じ再オープン → 順が保持されている
5. 設定（options）の左サイドバーを開く → **同じ順** になっている
6. options 側 ☰ で逆順に並べ替え → popup を開き直して **同じ順** になっている
7. 要対応アコーディオンがある場合、IssueCard に ☰ が **付いていない** こと
8. refresh / 詳細ボタンが、ハンドル操作なしのクリックで従来どおり動くこと

### 変更予定ファイル

- なし（確認のみ）。不具合が出たら本 plan に C3 として bug 内容を追記するか、`bugfix_popup-dnd-*.md` を切る

### 完了条件（C2）

- [ ] 上記 3〜8 が Chrome または Firefox の unpacked で確認できた
- [ ] 失敗時は再現手順・期待/実際を本 plan 末尾「判断ログ」に 3 行以内で追記

### C2 完了時の表更新

- 本書 `## context配分` の C2 を `plan` → `fix`
- 全 C が `fix` になったら H1 を `[実行中]` → `[様子見]`（archive は手動で `[完了]` に変えるまでしない）

---

## 完了報告フォーマット（各 C）

```
fix:完了 or plan:未完了
変更ファイル: <一覧 or なし>
検証結果: <1 行>
context配分表 C<N> 更新済み: Y/N
```

---

## 判断ログ

| 日付 | 内容 |
|---|---|
| 2026-07-19 | ユーザー選択: popup にも options と同じ仕組みで D&D を載せる |
| 2026-07-19 | C1 実装。options は既存のまま。要対応は対象外 |
| 2026-07-19 | C2 未着手（unpacked 手動確認待ち） |
