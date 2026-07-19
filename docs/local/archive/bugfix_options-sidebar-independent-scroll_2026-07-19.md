# [完了] 障害対応記録: Settings の左 provider 一覧が大きく、右詳細と一緒にスクロールする

## 症状

Settings（options）画面で、左側の **Registered providers** 一覧の各カードが大きく、登録数が増えると画面の縦方向を大きく占有する。

また、右側の provider 詳細を下へスクロールするとページ全体がスクロールし、左の provider 一覧も一緒に移動する。そのため、詳細を読んでいる間に選択・切替対象の一覧が画面外へ消える。

再現手順:
1. 複数の provider を登録する
2. Settings を開き、左の Registered providers 一覧を確認する
3. 右側の Provider settings / Tracked elements / Diagnostics までスクロールする
4. 左の一覧が右詳細と同じページスクロールで移動することを確認する

影響:
- v0.1.0 の Settings 画面のレイアウトと操作性
- provider の保存、teach、capture、並べ替えのロジックには影響しない

観察日: 2026-07-19(日)。ユーザー提供スクリーンショットで確認。

## 根本原因（root cause）

`src/options/styles.css` の options レイアウトが `min-height` ベースだったため、詳細コンテンツの高さに応じて文書全体が伸びていた。

左 sidebar は flex コンテナ化されていたものの、provider 一覧にも sidebar 本体にも独立した `overflow-y` が無い。そのため、右詳細を読むためのホイール操作は body のページスクロールになり、左右が一体で動いていた。

あわせて、sidebar は 260px 幅・provider 行は 22px icon、8px padding、11px 補助テキストという密度で、一覧用途としては画面占有が大きかった。

## 修正内容

Settings を viewport 内に固定し、左の provider 一覧と右の詳細をそれぞれ独立したスクロール領域にする。

### 1. 画面全体を viewport に収める

- `html` / `body` / `#app` を 100% 高さにする
- `body` と `.options-shell` の外側スクロールを抑止する
- `.options-shell` を縦 flex レイアウトにし、ヘッダーを 68px 固定にする
- `.options-layout` を残りの高さに収め、子要素が縮めるよう `min-height: 0` を付ける

### 2. 左 sidebar をコンパクト化して独立スクロール

- 左カラムを 260px から 220px へ縮小
- `.provider-sidebar-list` に `overflow-y: auto` と `overscroll-behavior: contain` を付与
- provider 行を 6px padding・18px icon・小さめの文字にし、一覧密度を上げる
- report ボタンは sidebar 下部へ固定し、一覧だけがスクロールするようにする
- **追記 (2026-07-19 再発)**: 一覧を viewport 高さに伸ばしたあと、`display: grid` の既定 `align-content: stretch` で各行が均等に引き伸ばされ、カードが巨大に見えた。`align-content: start` + `grid-auto-rows: max-content` + `align-self: start` で行高を内容に固定する

### 3. 右詳細を独立スクロール

- `.main-panel` に `height: 100%` / `overflow-y: auto` / `overscroll-behavior: contain` を付与
- `#app` を flex カラムにして高さチェーンを確実にする
- 右詳細をスクロールしても、左の provider 一覧位置は変わらない

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `src/options/styles.css` | viewport 固定、左右の独立スクロール、左 provider 行のコンパクト化 |

## 検証

自動:
- `pnpm run typecheck` — 成功
- `git diff --check` — 成功

実機:
1. 拡張をリロードして Settings を開く
2. 右詳細を最下部までスクロールしても、左の provider 一覧位置が変わらないこと
3. provider 数が多い場合、左一覧だけをスクロールして選択・ドラッグ並べ替えできること
4. 左下の Report ボタンが一覧スクロールに巻き込まれないこと
5. 左一覧または右詳細を端までスクロールしても、もう一方のスクロール位置に連鎖しないこと
6. 900px 以上の画面幅で左右カラムが横並びのまま表示されること
7. 左一覧の各行が縦に引き伸ばされず、内容高さのまま上寄せになること

確認結果: 2026-07-19 ユーザー実機で OK（独立スクロール + 行の引き伸ばし修正）。

## 備忘

- 本修正は CSS レイアウトのみで、provider のデータ・権限・usage 値は変更しない。
- `overscroll-behavior: contain` は、各ペインの端まで到達したホイール操作が外側へ伝播することを抑えるために付与した。
- 秘密情報・実 usage 値は本記録に含めない。
- ビルド / コミット / push はユーザー明示指示があるまで行わない（家標準）。
