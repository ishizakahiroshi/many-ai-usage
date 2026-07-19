# [様子見] 障害対応記録: popup 行の Settings が常に一覧先頭（Claude 等）を開く

## 症状

popup ダッシュボードで **対象エージェント行を展開 → ⚙ Settings** を押しても、options 画面の初期選択が常に **Registered providers の一番上**（例: Claude）になる。行ごとに違うエージェントを開いているつもりでも、設定パネルの表示名・URL・Tracked elements が先頭プロバイダの内容になる。

再現手順:
1. 複数プロバイダを登録する（例: 並び順 Claude → Fable → 他）
2. popup で **先頭以外** の行を展開する
3. その行の **⚙ Settings** を押す
4. options が開くが、サイドバー選択・メイン見出し・フォームが **先頭プロバイダ** になっている

影響:
- v0.1.0 の popup → options 遷移（行 Settings）
- ヘッダの「⚙ options」は provider 指定なしで従来どおり先頭初期選択（意図どおり）
- teach / capture 本体のロジックには非影響（起動先の選択 ID のみ）

## 根本原因（root cause）

二つの欠落が組み合わさっていた。

1. **popup が provider を渡さない**  
   `src/popup/main.tsx` の `ProviderRow` で Settings が `onClick={openOptions}` のまま。`provider.id` をメッセージにも URL にも載せていなかった。`openOptions` も常に素の `options.html` / `{ type: 'OPEN_OPTIONS' }` のみ。

2. **options が常に `providers[0]` を初期選択**  
   `src/options/main.tsx` の `reload` が `selectedId == null` のとき:

   ```ts
   if (selectedId == null && next.providers[0]) {
     setSelectedId(next.providers[0].id);
     setDraft(draftFrom(next.providers[0]));
   }
   ```

   のため、起動直後は **並び順の先頭だけ** が選ばれる。ユーザーが「行の Settings」と解釈していても、UI 契約上は「options を開く」だけで対象 ID が無かった。

背景: `OPEN_OPTIONS` はもともと zombie options タブの再ナビ（拡張 reload 後）対策として導入されており、provider deep-link はスコープ外だった。

## 修正内容

行 Settings から `providerId` を通し、options 起動時にその ID を初期選択する。未指定・未知 ID のときだけ従来どおり先頭にフォールバック。

### 1. メッセージ

```ts
// before
| { type: 'OPEN_OPTIONS' }

// after
| { type: 'OPEN_OPTIONS'; providerId?: string }
```

### 2. background — options URL に deep-link

```ts
// before
function optionsPageUrl(): string {
  return chrome.runtime.getURL('options.html');
}

// after
function optionsPageUrl(providerId?: string): string {
  const base = chrome.runtime.getURL('options.html');
  if (!providerId) return base;
  return `${base}?provider=${encodeURIComponent(providerId)}`;
}
```

`openOptionsPageReliable(providerId?)` が既存タブ `tabs.update` / 新規 `tabs.create` の両方でこの URL を使う。`id` に `:` が含まれる sample/custom ID も `encodeURIComponent` で安全。

### 3. popup — 行 Settings だけ ID を渡す

```tsx
// before
<button onClick={openOptions}>⚙ Settings</button>

// after
<button onClick={() => openOptions(provider.id)}>⚙ Settings</button>
```

`openOptions(providerId?)` は fallback の `tabs.create` でも同じ `?provider=` を付ける。ヘッダ「⚙ options」は引数なしのまま。

### 4. options — 起動時に deep-link を読む

- 初回 render で `bootProviderId` を `useState(() => requestedProviderId())` として固定（strip や非同期 reload より前にキャプチャ）
- `selectedId == null` のとき: `bootProviderId` に一致する provider → 無ければ `providers[0]`
- `trySamples` と同様、`provider` クエリは one-shot として `history.replaceState` で URL から除去（ブックマーク再読込で選択が固定されないようにする）

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `src/shared/messages.ts` | `OPEN_OPTIONS` に optional `providerId` |
| `src/background/index.ts` | `optionsPageUrl` / `openOptionsPageReliable` / handler が deep-link URL を生成 |
| `src/popup/main.tsx` | `openOptions(providerId?)`、行 Settings から ID を渡す |
| `src/options/main.tsx` | `bootProviderId` で初期選択、クエリ strip |
| `tests/background.test.ts` | deep-link 新規タブ / 既存タブ再ナビの 2 ケース追加 |

## 検証

自動:
- `pnpm run typecheck` — 成功
- `pnpm test -- tests/background.test.ts` — 12 件成功（うち deep-link 2 件追加）

実機（様子見・ユーザー確認待ち）:
1. 拡張をリロードする
2. popup で **先頭以外** の行 → Settings → options サイドバーとそのプロバイダが選択されていること
3. 先頭行 → Settings → 先頭が選ばれること（回帰なし）
4. ヘッダ「⚙ options」→ 先頭（または前回操作後の状態。deep-link なし）で開くこと
5. 既に options タブが開いている状態で別行 Settings → その行の ID に切り替わること（既存タブ re-navigate）

## 備忘

- `chrome.runtime.openOptionsPage()` フォールバック経路は query を付けられない。通常は `tabs.create` / `tabs.update` が先に使われるため、zombie 復旧の最終手段でのみ deep-link が欠ける可能性がある。
- Issue カード側には Settings ボタンが無い（Open / Capture / Re-teach のみ）。必要なら同様に `openOptions(provider.id)` を足せる。
- 並び順の「一番上が初期値」は **deep-link 無し起動のフォールバック** として残す。reorder で先頭が変わるとフォールバック先も変わる（従来仕様）。
- 秘密情報・実 usage 値は本記録に含めない（fixture ID 例のみ）。
- ビルド / コミット / push はユーザー明示指示があるまで行わない（家標準）。
