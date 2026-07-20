# [様子見] 障害対応記録: Settings の操作ボタン幅・高さが不揃い

## 症状

options（Settings）画面で、操作ボタンの見た目が不揃いだった。

- 「この要素を追跡」と「追跡を修正（クリアして再教示）」は左端だけが揃い、右端が揃わない
- Custom icon 欄の「削除」ボタンだけが「画像を選ぶ」より縦に引き伸ばされる

再現手順:
1. 追跡済み要素を持つ provider の options を開く
2. 「このページを教える」欄の右側の二段ボタンを見る
3. Custom icon 欄で画像を選択し、「削除」が有効な状態にする

影響:
- options の見た目だけ。teach、保存、削除、画像アップロードの動作には影響しない
- popup および content script の UI は対象外

観察日: 2026-07-20(日)。実機スクリーンショットで確認。

## 根本原因（root cause）

二つの Flexbox の既定挙動が原因だった。

1. `.teach-panel-actions` が横方向の `flex` + `flex-wrap: wrap` だったため、2 個目の長いボタンだけが次の行に折り返され、操作群の右端が不揃いになった。
2. `.icon-actions` は `display: flex` だが `align-items` 未指定だった。既定値の `stretch` により、通常の `button` が同じ行の高さまで縦に引き伸ばされた。一方、`画像を選ぶ` は `inline-flex` の label なので同じ伸長の見た目にならず、差が目立った。

## 修正内容

`src/options/styles.css` だけを変更した。

### 1. 追跡操作を同幅の縦並びにする

`.teach-panel-actions` を column direction にし、各ボタンを cross axis で stretch する。

```css
.teach-panel-actions {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 8px;
}
```

長い「追跡を修正」ボタンの幅を操作群の幅とし、短い「この要素を追跡」も同じ右端まで伸ばす。

### 2. アイコン操作を内容の高さにする

`.icon-actions` に `align-items: center` を指定する。

```css
.icon-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
```

これにより `削除` は他要素に合わせて stretch されず、指定済みの padding による自然な高さになる。

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `src/options/styles.css` | 追跡操作の同幅縦並び、Custom icon 操作の垂直中央揃え |

## 検証

自動:
- `git diff --check` — 成功
- `pnpm run typecheck` — 成功

実機（様子見・ユーザー確認待ち）:
1. 拡張をリロードする
2. 追跡済み provider の「このページを教える」で、2 ボタンの左右端が揃うことを確認する
3. Custom icon を選択し、「画像を選ぶ」と「削除」の高さが揃うことを確認する
4. 追跡、追跡を修正、画像選択、アイコン削除が従来どおり動作することを確認する

## 備忘

- 画面幅が狭いときも、追跡操作は折り返さず一つの操作群として縦に維持する。
- 秘密情報・実 usage 値は本記録に含めない。
- ビルド / コミット / push はユーザー明示指示があるまで行わない（家標準）。
