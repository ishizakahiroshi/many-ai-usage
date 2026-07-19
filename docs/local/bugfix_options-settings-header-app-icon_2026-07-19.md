# [様子見] 障害対応記録: Settings 画面ヘッダーにアプリアイコンが無い

## 症状

options（Settings）画面のヘッダーがテキストのみで、拡張のアプリアイコンが表示されない。popup ダッシュボードにはヘッダー左にアイコンがあるのに、Settings だけ欠落している。

再現手順:
1. 拡張を読み込んだ状態で options を開く（popup の ⚙ options / 行 Settings / 直接 `options.html` いずれでも可）
2. 画面上部ヘッダーを見る
3. `many-ai-usage` `Settings · v0.1.0` の文字だけがあり、左にアイコンが無い

影響:
- v0.1.0 の options UI ヘッダーのみ（teach / capture / storage 本体には非影響）
- popup ヘッダーは既にアイコン表示済み（回帰対象外）
- 左サイドバーの provider 横の灰色枠は **Custom icon（ユーザー任意アップロード）** 用で本バグとは別。ブランド favicon は商標・プライバシー方針で自動取得しない

観察日: 2026-07-19(日)。実機スクショでヘッダー左にアイコン枠が無いことを確認。

## 根本原因（root cause）

`src/options/main.tsx` のヘッダーがテキストだけの markup だった。

```tsx
// before（概略）
<header class="options-header">
  <div>
    <strong>many-ai-usage</strong>
    <span>Settings · v0.1.0</span>
  </div>
  <span class="privacy-note">Local-only · read-only page capture</span>
</header>
```

一方 `src/popup/main.tsx` は同じ資産を既に使っている:

```tsx
<img
  class="app-icon"
  src={chrome.runtime.getURL('assets/icons/icon-192.png')}
  width={22}
  height={22}
  alt=""
/>
```

`src/extension/assets/icons/icon-192.png` はパッケージ済みで、ストア用モック（`docs/store/screenshot-settings.png`）でもブランド左にアイコンがある。options 側の UI 実装だけが popup / モックに追従していなかった。

## 修正内容

options ヘッダーを popup と同じく brand 行（アイコン + タイトル + 副題）にし、CSS で左寄せ配置する。

### 1. markup（`src/options/main.tsx`）

```tsx
// after
<header class="options-header">
  <div class="brand">
    <img
      class="app-icon"
      src={chrome.runtime.getURL('assets/icons/icon-192.png')}
      width={28}
      height={28}
      alt=""
    />
    <strong>many-ai-usage</strong>
    <span>Settings · v0.1.0</span>
  </div>
  <span class="privacy-note">Local-only · read-only page capture</span>
</header>
```

サイズは options のヘッダー高（68px）に合わせ 28px（popup は 22px）。

### 2. スタイル（`src/options/styles.css`）

- `.options-header .brand` — flex + gap でアイコンと文字を横並び
- `.options-header .app-icon` — 28×28・角丸 8px
- 旧 `.options-header span { margin-left: 12px }` は brand 内の副題にも privacy-note にも当たっていたため、`.options-header .brand > span` と `.privacy-note` に色指定を分離

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `src/options/main.tsx` | ヘッダー左に `icon-192.png` を配置（`.brand` 構造） |
| `src/options/styles.css` | brand / app-icon / privacy-note の配置・色 |

## 検証

自動:
- 本修正は markup/CSS のみのため typecheck / unit test の追加は無し（回帰対象のロジック変更なし）

実機（様子見・ユーザー確認待ち）:
1. 拡張をリロードする
2. options を開き、ヘッダー左にアプリアイコンが出ること
3. アイコンが壊れていないこと（`chrome-extension://…/assets/icons/icon-192.png` が読めること）
4. popup ヘッダーのアイコンが従来どおり出ること（回帰なし）
5. サイドバー provider 行・Custom icon 欄の挙動が変わっていないこと

## 備忘

- provider 横の空枠を「頭文字 fallback」で埋める話は本バグのスコープ外。必要なら別 plan / bugfix で扱う。方針上、ホスト favicon の自動取得はしない（Custom icon ヘルプ文・`src/shared/icon.ts` コメントと一致）。
- アイコンパスは popup と同じ `assets/icons/icon-192.png`。manifest の `action.default_icon` は 512 系を参照しているが、UI 用 PNG は `src/extension/assets/icons/` 一式が build でコピーされる前提。
- 秘密情報・実 usage 値は本記録に含めない。
- ビルド / コミット / push はユーザー明示指示があるまで行わない（家標準）。
