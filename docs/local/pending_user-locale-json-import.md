# [保留] ユーザー持ち込み言語パック（ローカル JSON import）

記録日: 2026-07-19(日)

## 概要

UI の多言語はすでに **言語セット JSON を実行時ロード**する形になっている（`src/locales/catalog.json` + `en.json` / `ja.json`、`src/shared/i18n.ts`）。セレクトで言語を選び、`chrome.storage.local` の `uiLocale` に保存する。

将来、同梱以外の言語（例: ベトナム語）を **ユーザー自身が JSON で足せる**ようにする案がある。2026-07-19 の方針として次を採用し、**実装は保留**する。

| 方針 | 内容 |
|---|---|
| **採用（将来）** | ユーザーが **ローカルの `.json` を import** → 検証 → `chrome.storage.local` に保存 → セレクトに載せる |
| **不採用** | 任意 URL からの言語パック取得、コミュニティ自動配信、アプリ内フル翻訳エディタ |
| **当面** | 言語追加は **作者が `src/locales/<code>.json` + catalog 登録**で同梱するだけ |

Chrome 拡張として技術的に可能。文言はテキスト表示のみ（コード実行しない）なら XSS 系のリスクは低い。残るのは誘導文のなりすまし・壊れた JSON・storage 容量・キー欠落時の en フォールバック混在。

## 保留理由

- v0.1 時点で必要十分なのは en / ja 同梱 + catalog 拡張。ユーザー翻訳の需要がまだ顕在化していない
- リモート URL 配信は権限・審査説明・改ざん対策・独自サーバー方針と衝突しやすい。import 限定でも UI・検証・storage スキーマが増える
- 拡張のキー追加のたびにユーザー持ち込みパックの欠落キーが増え、運用説明が要る

## 着手条件

次が揃ったら `plan_*.md` に昇格して実装する。

- ユーザーまたは作者が「同梱以外の言語を自分で入れたい」と明確に要求した
- または同梱言語が増えすぎてリリースに載せきれず、コミュニティ翻訳を受ける必要が出た
- 実装方針は次を崩さないこと:
  - **ローカル JSON import のみ**（任意 URL 取得はしない）
  - キーは既存 en キー集合に対する検証（未知キーは無視、必須欠けは警告）
  - サイズ上限（例: 1 pack 数十〜数百 KB）と JSON parse 失敗時の安全フォールバック
  - 表示はテキストノードのみ（HTML 挿入禁止）
  - 保存先は `chrome.storage.local`（拡張パッケージ内 `locales/` への書き込みは不可）
  - セレクトは `listLocales(catalog)` 相当 + storage 上のユーザーパックをマージ

## 関連情報

### 現状実装（2026-07-19）

- ローダー: `src/shared/i18n.ts`（catalog ロード、`uiLocale` 永続化、欠落キーは default=en へフォールバック）
- 同梱パック: `src/locales/catalog.json` / `en.json` / `ja.json`
- ビルド: `scripts/build.mjs` が `src/locales` を `dist/*/locales` へコピー
- UI: popup 右上（options 隣）と options ヘッダの言語セレクト
- 作者が言語を足す手順: `src/locales/<code>.json` を en キー互換で作成 → `catalog.json` に `{ "label", "file" }` を追加 → ビルド

### 将来 import 実装のスケッチ（未着手・参考）

1. options に「言語パックを読み込む」ボタン（`input type=file accept=application/json`）
2. parse → フラット `Record<string, string>` であること・キー数上限・バイト上限を検証
3. storage 例: `userLocalePacks: { "vi": { label: "Tiếng Việt", messages: { ... } } }`
4. `initI18n` で catalog にユーザー code を合成し、messages は pack 優先
5. 削除 UI と「壊れたパックを捨てて en に戻す」導線

### 明示的にやらないこと（この pending のスコープ外）

- 任意 URL から言語パックを `fetch`
- 署名付きリモート配信・CDN
- teach-mode のページ DOM 検出語（使用済等）のユーザー翻訳（別系統）
