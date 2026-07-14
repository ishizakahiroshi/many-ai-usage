---
type: plan
status: in-progress
tags: [implementation, mvp, browser-extension, mv3]
owner: ishizakahiroshi
review_status: draft
related: [reference_study-synthesis.md, reference_study-ai-usage-dashboard.md, reference_study-openusage.md, plan_codex-study-reference-oss.md, review_v0.1.0-mvp-open-topics_2026-07-14.html, review_v0.1.0-mvp-open-topics_2026-07-14_decisions.md, review_v0.1.0-mvp-plan-fixes_2026-07-14_decisions.md, mockup_v0.1.0-mvp_2026-07-14.html, design_v0.1.0-mvp-visual_2026-07-14.html, review_v0.1.0-mvp-visual-v3_2026-07-14_decisions.md, plan_v0.1.0-mvp-pivot-to-teach-mode_2026-07-14.md]
last_reviewed: 2026-07-14
due: 2026-07-21
---

# [進行中] many-ai-usage v0.1.0 MVP 実装計画

> 最終更新: 2026-07-14 (進捗点検・C1〜C3 done 反映 → その後 teach-mode ピボット決定)
> **2026-07-14 pivot**: 実 Claude / Codex での動作検証で auto detector が誤値検知することが判明し、v0.2 予定だった teach-mode を v0.1.0 に前倒しする決定。差分は `docs/local/plan_v0.1.0-mvp-pivot-to-teach-mode_2026-07-14.md` を参照。本 plan の C3 は「降格」、C3.5 新設、完了条件は pivot 側で上書きされる
> 前提: `docs/local/reference_study-synthesis.md` の設計決定表を v1 方針として採用する
> 論点確定: 未確定論点シート(23 決着) + 齟齬修正シート(5 決着) + ビジュアル v3 決定(8 決着)
> UI 実装イメージ: `design_v0.1.0-mvp-visual_2026-07-14.html` (v3・popup 560px + 1 行モード + 異常アコーディオン + options 統合)
> 本ファイルは実装フェーズの入口 plan

## 背景と目的

many-ai-usage は複数 AI サービスのサブスク使用量を 1 画面で見るブラウザ拡張(MV3・Chrome / Firefox ハイブリッド・サーバーなし・ブラウザ内完結・OSS)。プロジェクト概要は `CLAUDE.md` を先に読むこと。

v0.1.0 は「URL を登録したら、表示したい値を 1 回教えて一覧化する」という核体験を、誤値を出さずに成立させることを目的とする。teach-mode の前倒し差分は `plan_v0.1.0-mvp-pivot-to-teach-mode_2026-07-14.md` を正本とする。

## スコープ

### v0.1.0(MVP・B 案)

含む:

- teach-mode(要素 picker + selector/fingerprint 保存 + stale 検出 + Re-teach)
- 自動解析(ローカル DOM ヒューリスティック、候補プレビュー専用。誤値は保存しない)
- tile fallback(自動解析で拾えない登録 URL を「開くリンク付きのカード」として残す)
- 取得経路: **user visit capture + 手動再取得ボタン** のみ(手動再取得は「即時取得」の役割も兼ねる)
- popup UI(§C6): 幅 560px × 高さ最大 600px・1 プロバイダ 1 行に全 window ミニバー横並び・登録順固定・下部異常アコーディオン
- options 統合画面(§C5): サイドバー(登録済み一覧 + ドラッグ並べ替え + 新規追加)+ メインパネル(現在の残量 + 設定フォーム + 診断 + 保存/削除)。登録・編集・詳細・permission 要求を 1 画面で兼ねる
- サンプル 2 件(Claude / Codex)のプロバイダ登録雛形
- Chrome / Firefox ハイブリッドビルド + secrets-scan 4 層 + LICENSE(MIT) + GitHub Actions

含まない(v0.2 以降):

- provider-specific parser(汎用 detector のみ。サイト固有知識はユーザーが teach)
- background tab capture(opt-in の非アクティブタブ再読取)
- iframe 経由 embed(常時 proxy は審査リスクで採用しない方針は継続)

### v0.2.0 以降のロードマップ(短メモ)

- background refresh(明示 opt-in、concurrency/interval 制限)
- 診断 UI(evidence の可視化・needs_teaching 状態の修復導線)
- ダークモード対応(`prefers-color-scheme` に追従)

## 全体アーキテクチャ

```
+-------------------+       user visit capture       +---------------------+
|  content script   | ─────────────────────────────▶ |  background worker  |
|  (DOM heuristic)  |    normalized snapshot         |  (schedule/limit)   |
+-------------------+                                +----------┬----------+
                                                                │
                                                                ▼
                                              +----------------------+
                                              |  chrome.storage      |
                                              |  - ProviderConfig[]  |
                                              |  - Snapshot[]        |
                                              |  - RuntimeState[]    |
                                              +----------┬-----------+
                                                         │
                              +--------------------------+--------------------------+
                              │                                                     │
                              ▼                                                     ▼
                     +-------------------+                                +---------------------+
                     |  popup(§C6)       |                                | options(§C5)        |
                     |  幅 560px         |                                | 統合画面            |
                     |  1 行 = 全 window |                                | サイドバー +        |
                     |  下部異常畳み込み |                                | 設定/実測値/診断    |
                     +-------------------+                                +---------------------+
```

## context配分

| C | 内容 | 種別 | 並列 |
|---|---|---|---|
| C1 | リポ骨格(TS + esbuild + Chrome/Firefox ハイブリッド manifest + project-init 配線 + icon 初期セット + secrets-scan 動作確認) | done(実機読み込み確認除く) | — |
| C2 | storage schema 実装(synthesis §3/§4 を v1 として凍結、valibot) | done | [並列OK with C3] |
| C3 | 自動解析エンジン(共通 DOM ヒューリスティック) | v0.1 runtime から除外(reference fixture のみ。誤値の保存経路なし) | C2 の後 |
| C3.5 | teach-mode(picker + selector/fingerprint + taught reader + stale/Re-teach) | done(合成 fixture + UI 接続) | C2 の後 |
| C4 | 取得 pipeline(content script + background、taught/user visit capture + 手動再取得) | partial done(骨格実装済・実 URL 動作確認未) | C3.5 の後 |
| C5 | **options 統合画面**(サイドバー + 登録 + 編集 + 詳細 + 診断 + Track/Re-teach + 並べ替え + permission 要求) | partial done(Track/Re-teach 接続済・実機確認未) | C3.5/C4 の後 |
| C6 | **popup UI**(560×600 + 1 行モード + 全 window ミニバー + 行内展開 + 異常アコーディオン + needs_teaching) | partial done(骨格実装済・実機確認未) | C4/C5 の後 |
| C7 | tile fallback(拾えない URL の表示型カード + popup 下部アコーディオンに集約) | partial done(page_only 判定と IssueCard 実装済・favicon ローカル取得と昇格経路の検証未) | C5/C6 と並走 |
| C8 | リリース準備(store 素材 + privacy policy + GHA 配線確認) | partial done(privacy/listing/submission notes・検証/パッケージ script・GHA 配線済み。ストア提出と実スクショ未) | 最後 |

実行順序: `C1 → C2 → C3.5 → C4 → (C5, C6, C7) → C8`

---

## C1: リポ骨格

### 目的

TypeScript + esbuild + Chrome/Firefox ハイブリッド manifest + house 標準 4 層 secrets-scan + LICENSE(MIT) + GHA + icon 初期セットを配線し、`pnpm build` で `dist/chrome/` と `dist/firefox/` が出るところまで持っていく。

### やること(確定)

- `project-init` skill で CLAUDE.md/AGENTS.md/.gitignore + 4 層配線
- `license-init` で LICENSE(MIT)
- TS 選定: strict、`jsx: react-jsx` + `jsxImportSource: preact` で Preact に向ける
- bundler: esbuild(参考実装 2 本は bundler なし・素の JS の小規模拡張だったため、思想は踏襲しつつ本プロジェクトの規模に合わせて最薄 bundler を採用)
  - entry points: `content` / `background` / `popup` / `options` を個別バンドル
- manifest: 2 ファイル同梱を build 時に切り替え(tab-title-prefix 踏襲)
  - `src/extension/manifest.chrome.json` / `src/extension/manifest.firefox.json`
  - build 時に対象ブラウザの manifest を `dist/<target>/manifest.json` にコピー
- build script: Node の pnpm scripts(`scripts/build.mjs`)
- `pnpm run build` / `pnpm run build:chrome` / `pnpm run build:firefox` / `pnpm run dev`(watch)
- `github-actions` skill で CI(lint + typecheck + build + secrets-scan) 配線
- secrets-scan 動作確認: 空 commit + テスト commit(合成 secret 入り) で `.githooks/` 配線を落とすことを確認
- icon 初期セット: `make-icon` skill で favicon/128/256/512 一式を作成

### ディレクトリ構成(叩き台)

```
src/
  extension/
    manifest.chrome.json
    manifest.firefox.json
    popup.html
    options.html
    _locales/
    assets/icons/
  content/          … content script(detector 含む)
  background/       … service worker
  popup/            … Preact popup UI(§C6)
  options/          … Preact options 統合画面(§C5)
  shared/           … schema / storage / utils(valibot)
scripts/
  build.mjs
  install-hooks.ps1 / .sh
  secrets-scan.mjs
dist/
  chrome/
  firefox/
```

### 完了条件

- `pnpm install && pnpm run build` で `dist/chrome/`, `dist/firefox/` が生成
- Chrome / Firefox の「パッケージ化されていない拡張機能」として読み込み popup が空の状態で開く
- CI が緑(typecheck + secrets-scan + build)
- 合成 secret 入りの test commit が `.githooks/` の pre-commit で block されることを確認済み
- icon 初期セットが `src/extension/assets/icons/` に配置され両 manifest から参照される
- `pnpm run dev` で TS 変更が esbuild watch でリビルドされる

---

## C2: storage schema 実装

### 目的

synthesis §3(provider.v1) と §4(NormalizedSnapshot / NormalizedMetric) を v1 として凍結し、TS 型 + `chrome.storage` ラッパを実装する。

### やること(確定)

- `src/shared/schema/` に valibot で type + runtime validator
- `ProviderConfig`(schema="many-ai-usage.provider.v1")
  - 追加フィールド: `order`(数値・昇順で並べる。ドラッグ並べ替えで更新)
- `NormalizedSnapshot` / `NormalizedMetric`
- `ProviderRuntimeState`(status enum: never_seen / ok / warning / error / stale / needs_teaching / needs_permission / rate_limited の 8 値)
- `metrics` 配列は synthesis §3 準拠で型を全部入れる(taught/page_only 分岐も型として存在)。v0.1.0 の writer は taught/page_only を主経路とし、auto は候補プレビュー専用
- storage ラッパ: `getProviders() / upsertProvider() / getSnapshot(id) / setSnapshot() / getRuntimeState() / setRuntimeState() / reorderProviders(ids[])`
- migration hook(v1 では no-op)
- stale 判定: `capturedAt` から `refreshIntervalMinutes × 2` 経過で stale フラグ

### 完了条件

- `pnpm test` で schema validator の unit test が通る(合成データで)
- storage ラッパを popup から呼んで空配列が返るところまで確認できる
- stale 判定の境界テスト(interval × 2 直前 / 直後) が通る
- `reorderProviders` で order フィールドが更新される単体テストが通る

---

## C3: 自動解析エンジン

### 目的

2026-07-14 の teach-mode ピボットにより、ここは v0.1 runtime から除外した regression reference である。検出結果を v0.1.0 の主 metric として保存せず、picker の直接プレビューだけを使用する。実装差分と主 pipeline は C3.5 を参照する。

synthesis §1 の 4 種類の evidence(`%` / `progress`/`meter` / `used/total` / `reset` 近傍)を扱う既存 detector は、合成 fixture の regression reference として保持する。

### やること(確定)

- `src/content/detector/` に候補生成器を種類別に分離
  - `percentDetector.ts`(数値 + `%` + 近傍語 `remaining|left|used`)
  - `progressElementDetector.ts`(`HTMLProgressElement` / `role=progressbar` / `aria-valuenow`)
  - `usedTotalDetector.ts`(`used / total`、通貨・件数)
  - `resetDetector.ts`(`reset|renews|next window` + 日英中)
- `scorer.ts`: label 近傍/role/unit/window/reset 一貫性で confidence(0-1) を出す
- `normalize.ts`: candidates → `NormalizedMetric[]`
- 多言語ラベル辞書: `src/content/detector/i18n/labels.ts` に静的テーブル(決定 C-1)
- DOM 対応範囲: top document + open shadow root のみ(決定 C-2)。closed shadow root と cross-origin iframe は対象外(schema 反映: snapshot の `source` を `page_only` にし、runtime state の `status` を `ok` にする — §C7 と同じ扱い)
- 採用閾値: confidence >= 0.6 で採用、下回ったら tile fallback にフォールスルー(決定 C-3)
- HTML 生データはストレージにも fixture にも残さない
- 単体テストは合成 HTML fixture のみ

### 完了条件

- 合成 HTML fixture(percent / progress / used-total / reset の 4 種類)で detector が期待どおりの `NormalizedMetric[]` を返す
- 誤検出テスト(navigation の `%`、料金表の `%`、広告の `off`)で false positive が採用されない
- confidence < 0.6 のケースで tile fallback へフォールスルーする経路が単体テストで確認できる

---

## C4: 取得 pipeline(user visit capture + 手動再取得)

### 目的

登録 host のページをユーザーが開いた時に content script が動き、taught selector で抽出した snapshot を background へ送って storage に書く。popup / options からの「今すぐ再取得」も同経路を通す。未 teach の provider は page tile として扱う。

### やること(確定)

- `src/content/index.ts`: URL match → hydration wait → detector 起動 → snapshot を message で送信
- URL match は origin+path のみで判定し hash(`#`) は無視する(E2)
- `src/background/index.ts`: message 受信 → snapshot 書き込み → runtime state 更新
- 手動再取得: popup/options から `chrome.tabs.sendMessage` で content script を再起動 → 即時に再解析
- hydration wait: `MutationObserver` の quiet window 500ms + 上限 5 秒(D1)
- 手動再取得中に tab が閉じた時: runtime state を `error` にし、原因ラベルを `tab closed during refresh` に(D2)
- concurrency: 同一 host 同時 1 件、失敗 backoff は synthesis §5「取得・認証」に従う
- 429 は `Retry-After` を尊重、なければ指数 backoff + jitter

### 完了条件

- permission 許可済み host で content script が snapshot を書き込める(実 HTML は fixture には保存しない・popup 反映は §C6 完了条件へ移動)
- 手動再取得ボタンで最終取得時刻が更新される
- hash が変わっても content script が二重起動しない
- 再取得中に tab を閉じた時、runtime state が `error` + `tab closed during refresh` になる

---

## C5: options 統合画面(登録 + 編集 + 詳細 + 診断 + 並べ替え)

### 目的

**「URL を登録するだけ」+「登録後に自分の provider を細かく見る/直す」を 1 画面で兼ねる**。従来の「登録 UI」と「詳細ビュー」を分離せず、options を 1 画面に統合する(V7 決定)。

### 画面構成(V7)

- 上部ヘッダ: ブランド名 + バージョン
- 左サイドバー(幅 260px):
  - `+ 新規追加` ボタン(選択で右側が空フォーム状態になる)
  - 登録済みプロバイダ一覧(1 行 = 表示名 + 現在の lowest 残量% + `☰` ドラッグハンドル)
  - **ドラッグで並べ替え可能**(V8 決定・MVP に含める)。並べ替えると `ProviderConfig.order` を更新
  - needs_permission / tile の provider は右側にサブラベル("要許可" / "tile")を表示
- 右メインパネル(選択中 provider の):
  1. ヘッダ: プロバイダ名 + status バッジ + 最終取得 / lowest 情報
  2. 現在の残量(全 window の水平バー・lowest は ▶ マーカー) + [手動再取得][対象ページを開く]
  3. 設定フォーム(表示名 / URL / 更新間隔 / mode)
  4. 診断(status / source / confidence / evidence / stale 閾値)
  5. 下部ボタン行: 左端 [削除] / 右端 [変更を破棄][保存]

### やること(確定)

- 新規追加時: 同じレイアウトが空フォーム状態。URL 入力後の「保存」で `chrome.permissions.request` を呼ぶ導線 + 説明文
- 権限拒否時は provider を保存しつつ runtime state の status を `needs_permission` にする(E1)
- 拒否したまま残された provider entry の掃除: 自動削除しない。needs_permission provider を選ぶと右側に「許可を要求 / 削除」の 2 ボタンを添える(I4)
- **URL 変更時の permission 再要求**(V6): 既存 provider の URL を編集して origin が変わった場合、`chrome.permissions.request` を再度呼ぶ導線を出す
- **dirty state 管理**: 設定フォームに変更が入ると「変更を破棄 / 保存」ボタンが有効化される
- サンプル 2 件(登録済み雛形として同梱):
  - Claude: `https://claude.ai/new#settings/usage`(E2)
  - Codex: `https://chatgpt.com/codex/cloud/settings/analytics#usage`(E2)
- ドラッグ並べ替え実装: 軽量ライブラリ or 素の HTML5 drag API。dragend で `reorderProviders(ids[])` を呼ぶ
- `Track this element`: 対象ページを開いて picker overlay を起動し、教えた label / selector / 最終読み取り値を設定画面に表示する。既存 metric は `Re-teach` で同じ slot を更新する

### 完了条件

- URL を入力 → 権限説明ダイアログ → 許可 → 該当ページを開くと popup と options に反映
- 拒否した場合の `needs_permission` 状態が UI に見え、「permission 要求 / 削除」の 2 ボタンが機能する
- サンプル 2 件が初回インストール時に登録済みで表示される(permission は未許可)
- サイドバーの ☰ ドラッグで並び順が変わり、popup 側にも即反映される
- URL の origin を変更した保存で permission 再要求ダイアログが出る
- 未保存変更がある状態で別 provider を選ぶと「変更を破棄しますか?」の確認が出る

---

## C6: popup UI(560×600 + 1 行モード + 異常アコーディオン)

### 目的

popup を「登録済みプロバイダの残量が全部一目で分かる」場所にする。**F2 差し戻し**(V2): 主表示は「lowest 1 個」ではなく **全 window ミニバー横並び**。**位置は登録順で固定**(V3)し、ヤバさは色 + マーカーで伝える。

### 寸法(V1)

- 幅: 560px 固定
- 高さ: 最大 600px(内容が多いと popup 内スクロール)
- Chrome/Firefox 拡張の technical 制限は 800×600 だが、popup の「サッと確認する」用途に合わせて幅 560 を採用

### レイアウト(V2)

- 上部ヘッダ: ブランド名 + バージョン + `⚙ options` リンク
- 中部プロバイダ一覧(order 昇順で固定):
  - 1 プロバイダ = 1 行(高さ ~52px、展開時 +40px)
  - 行グリッド: `名前(82px) + windows(1fr) + ↻(30px) + ▾(30px)`
  - windows は grid で 1/2/3 分割(プロバイダの window 数で切替)
  - 各 window ミニユニット: ラベル(5h/wk/mo) + 値(%) + 細バー + reset(短縮表記)
  - lowest window はオレンジ枠 + オレンジラベル + `▶` マーカーで強調(色 + 記号 + 数値の 3 重伝達)
- 下部異常アコーディオン(V4):
  - 閉状態: `▼ 対処が必要 · N 件` の 1 行ヘッダ(N > 0 のとき表示)
  - 開状態: needs_permission カード / tile カードが並ぶ

### 行内展開(V5)

- 行の `▾` ボタンで下に詳細エリアが展開
- 展開内容: confidence(window 別) / source(dom / user_taught / page_only) / 取得時刻 + [↗ 対象ページを開く][⚙ 設定を開く] ボタン
- 展開中は行に `expanded` state(薄いオレンジ背景)

### 色運用(数値必ず併記・色覚配慮)

- 残量 70%+ → `--ok`(緑)
- 残量 30〜70% → `--warn`(黄)
- 残量 30%未満 → `--bad`(赤)
- lowest window の強調は `--accent`(オレンジ)+ `▶` マーカー
- confidence(heuristic / taught / page_only)は行内展開でテキスト表示

### 順序(V3)

- popup 順序は `ProviderConfig.order` で決まる登録順で固定
- **自動ソートしない**(位置記憶を壊さないため)
- 並べ替えは options のドラッグでのみ

### 昇格ロジック(状態遷移)

- **needs_permission → 許可**: アコーディオンから消え、上部の通常バー領域の登録順の位置に戻る
- **needs_permission → 削除**: provider が消える
- **tile → 再解析で拾えた**: 通常バーに昇格
- **tile → 開いて閉じた**: 次の user visit capture で自動的に snapshot 上書き
- 位置は「登録順の予約席」的な扱いで、昇格しても場所は動かない

### 完了条件

- popup を開くと登録済み全プロバイダの一覧が 1 秒以内に描画される(10 プロバイダで 560×600 に収まる)
- サンプル 2 件(Claude / Codex)で Track this element を 1 回ずつ行うと popup に taught snapshot のミニバーが並ぶ
- window 数が違う(5h+wk+mo / wk のみ / mo のみ)プロバイダで grid が破綻しない
- lowest window が色 + オレンジラベル + `▶` で 3 重に強調される
- 各行の `▾` で行内展開ができ、confidence / source / 取得時刻が下に出る
- 手動再取得ボタンで snapshot が即時更新される
- 異常アコーディオン: N=0 なら非表示、N>0 なら閉じ状態でヘッダ 1 行、開けば needs_permission / tile カードが並び対処ボタンが機能する
- needs_permission → 許可、tile → 拾えた で通常バー領域の予約席に自動昇格する
- taught anchor の読み取り失敗が 3 回連続すると `needs_teaching` カードになり、Re-teach で復旧できる

---

## C7: tile fallback

### 目的

未 teach の登録 URL を「開くリンク付きのタイル」として popup 下部アコーディオン内に残し、一覧化という一次価値を必ず成立させる。

### やること(確定)

- tile 化の条件: **mode が `embed` / `auto`** なら snapshot の `source` を `page_only` にする。taught anchor の読み取り結果が空なら `source: user_taught`, `status: no_data` とし、3 回連続で `needs_teaching` にする(G1)
- popup 表示位置は **下部の異常アコーディオン内**(§C6 の V4 と噛み合わせる)。通常バー領域には並べない
- tile カードは「タイトル + 開くリンク + 最終取得時刻 + 再解析ボタン」の 4 要素
- favicon: host permission がある host のみローカル取得で表示(`<link rel=icon>` を ローカル解決)。permission が無い host は非表示(G2・Google の favicon proxy は使わない)
- tile 判定と heuristic 判定は将来 taught に昇格できるよう `source` フィールドを保持
- 再解析で拾えたら通常バーに昇格(§C6 昇格ロジック)

### 完了条件

- 自動解析で拾えない URL を登録すると、popup 下部アコーディオン内に tile カードとして並ぶ
- 「開く」で対象ページが新しいタブに開き、閉じると最新 snapshot が反映される
- host permission がある host は favicon が表示され、無い host は非表示
- 再解析成功で通常バー領域の登録順の位置に昇格する

---

## C8: リリース準備

### 目的

Chrome Web Store + AMO の両出しに必要な素材と、GHA タグ駆動リリースを配線する。**v0.1.0 直出し**(H1)なので、release 前チェックを確実に走らせる。

### やること(確定)

- store 素材: description(日英)、screenshots、privacy policy(ishizakahiroshi.github.io に独立ページ)(H2・「ページ HTML は外部送信しない」明記)
- icon の最終素材化(初期セットは C1 で作成済み。ストア用サイズ・色調整をここで扱う)
- `chrome-webstore-publish` skill で init(参考: `always-pinned`)
- `firefox-amo-publish` skill で init(参考: `tab-title-prefix`)
- `release` skill 用の manual_release md を用意
- release 前チェックを 3 種すべて緑にする:
  - `changelog-freshness`(README / version 表記整合)
  - `repo-consistency`(LICENSE / URL / owner ドリフト)
  - `secrets-scan`(手動 + hook + CI + release gate 全 4 層)
- version 戦略: 0.0.1 での pipeline 動作確認は行わず、0.1.0 直出し(H1)

### 実装済み(2026-07-14)

- `CHANGELOG.md`、`PRIVACY.md`、`docs/store/` の日英 listing / privacy / v0.1.0 submission notes を追加
- `scripts/validate-extension.ps1` と `scripts/package-webstore.ps1` を追加(ビルド成果物の検証、Chrome ZIP / Firefox XPI と SHA-256 出力)
- `.github/workflows/release.yml` で `v*.*.*` タグから両ブラウザ成果物と `SHA256SUMS.txt` を GitHub Release に添付
- Firefox manifest に AMO の `data_collection_permissions.required: [none]` を追加

### 未完了(外部操作)

- 実スクリーンショットの撮影・ストア掲載フォームへの入力
- Chrome Web Store / AMO への v0.1.0 提出(アカウント認証とタグ push が必要)

### 完了条件

- Chrome / Firefox 両方の store 審査に提出できる .zip / .xpi が GHA 経由で成果物として出る
- `release` skill で `v0.1.0` タグ push → GitHub Release まで自動化され、両ストア審査提出は手動フォームで実施できる
- privacy policy が ishizakahiroshi.github.io に公開されストア提出フォームの URL 欄に貼れる(HTML は準備済み、公開作業は未実施)

---

## 完了条件(v0.1.0 リリース定義)

- サンプル 2 件(Claude / Codex)を登録した状態で、Chrome/Firefox どちらでも 2 動線が動く:
  - permission 許可済み + Track this element 済みシナリオ: popup 上部の通常バー領域に実値と一致する taught ミニバーが並ぶ
  - permission 拒否シナリオ: popup 下部の異常アコーディオン内に `needs_permission` カードが並び「permission 要求 / 削除」の 2 ボタンが機能する
- ページ改訂で taught anchor が 3 回連続して読めない場合、`needs_teaching` カードの Re-teach で修復できる
- 任意 URL を登録して自動解析で拾えなければ popup 下部アコーディオン内に tile カードで並ぶ
- options 統合画面(サイドバー + 設定 + 実測値 + 診断)で登録・編集・削除・並べ替え・permission 再要求が動く
- Chrome Web Store と AMO の両ストアに v0.1.0 を提出済(審査結果は問わない)
- README / CLAUDE.md / privacy policy / LICENSE(MIT) が現行実装と整合(`repo-consistency` / `changelog-freshness` 緑)

## 残タスク(実装着手前に潰す)

- **A1a**: 解消済(2026-07-14)。参考実装 2 本は bundler なし・素の JS だったため、思想踏襲(2 manifest 同梱)+ bundler は esbuild で確定
- **F1 連動**: 解消済。Preact は esbuild 単体で対応可能(tsconfig の `jsx: react-jsx` + `jsxImportSource: preact`)。signals は必要になったら追加検討
- **C1-a**(進捗点検 2026-07-14 で追加): Chrome/Firefox の「パッケージ化されていない拡張機能」読み込みで popup が空描画されることを人手確認。証跡未取得
- **C1-b**(同上): 合成 secret を含む test commit が `.githooks/pre-commit` で block されることを人手確認。証跡未取得
- **C2-a**: 解消済み。`tests/storage.test.ts` で `reorderProviders(ids[])` の順序永続化を検証
- **plan 表記微修正**(解消済み): §C2 の runtime status 列挙を `rate_limited` までの 8 値に統一
- **C1-c**: popup.html / options.html が生成 CSS を `<link>` していなかった bug を修正 → 実機再ロードで popup(560px + 下線ヘッダ + Needs attention アコーディオン) と options(260px サイドバー + メインパネル 2 カラム + サンプル 2 件登録済 + needs_permission カード + Provider settings + Diagnostics) が visual spec 通りに描画されることを 2026-07-14 に確認・解消
- **C3-a**: detector i18n regex の `\b(...|残り|...)\b` bug(JS の `\b` は ASCII 語境界のみで CJK 文字が挟まると恒常 false) を修正 → 日本語 fixture テスト追加(tests/detector.test.ts) + Codex-shaped 合成 fixture テスト追加 → 実機で Codex 利用状況ページの残量が popup 通常バー領域に昇格することを 2026-07-14 に確認・解消。詳細: `docs/local/bugfix_detector-word-boundary-cjk_2026-07-14.md`(未作成)
- **C3-b**: 本 pivot により不要化。detector は候補プレビュー専用に降格し、誤値の保存経路を廃止。精度改善は v0.2 以降の候補 UI で再検討
- **[プロセス改善]**(進捗点検 2026-07-14 で追加): コード修正後の反映漏れ防止。detector など bundle 対象を触ったら **「pnpm test → pnpm run build → chrome://extensions で ↻ → 対象タブ close→reopen」の 4 段セット** を毎回実行。今回 pnpm test で通過確認したまま build を飛ばして 2 ターン無駄にした事故があった

## リスク(横断・監視のみ)

- host permission 拒否率が高いと popup 下部アコーディオンが常時展開状態になる可能性(§C5/§C6)。v0.2 で「まとめて permission 要求」導線を検討
- Claude/Codex の usage ページが hash route を捨てて別 URL に移った場合、サンプル URL の追従が要る(release 前に `changelog-freshness` で拾えない類の drift。v0.2 で URL 更新運用を検討)
- ドラッグ並べ替えの実装コスト: HTML5 drag API + `order` フィールド更新で足りるが、モバイル対応や tab 内 keyboard 対応まで作り込むかは C5 実装時に判断

---

## 実行時の共通ルール

- 各 C 完了時に本ファイルの `## context配分` 表の該当行を `plan` → `done`(残タスク有りは `done(条件除く)`) に更新する
- 実装前に synthesis §5「避けるべき落とし穴」を再読する
- 動作確認で取得した実 HTML / 実アカウント ID / 実使用率を fixture・ドキュメントに貼らない(secrets-scan 責務)
- ビルド・コミットは指示があるまで AI から自動実行しない
