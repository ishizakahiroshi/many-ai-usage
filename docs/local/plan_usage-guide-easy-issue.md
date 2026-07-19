# [様子見] 使い方 URL 正規化と「かんたん不具合報告」

## context配分

| C | 種別 | 内容 | 並列 |
|---|---|---|---|
| C1 | fix | 使い方ページの正典 URL を `.com` に揃え、拡張・README・store 文案・テストガイドのリンクを直す | — |
| C2 | fix | 「かんたん報告」UX（テンプレ生成 + 常時コピー / GitHub 簡易投稿 / mailto なし）。敵対レビュー指摘の「GitHub 前に常時 copy」反映済み | — |
| C3 | fix | サイト側 usage FAQ・support.html・Issue テンプレ整備（ソースは private ishizakahiroshi.com。**本番反映は push/デプロイ待ち**） | [並列OK with C2] |
| C4 | fix | Chrome/Firefox ストア listing の Support URL・返信運用・禁止事項の固定 | — |

実行順序: `C1 → (C2, C3) → C4`

---

## このファイルを開いた AI へ

この plan を指されたら、下記スコープ内だけ実装する。`git commit` / `git push` / `git tag` / 本番デプロイ / ストア申請はユーザー指示があるまで行わない。ビルド（`pnpm run build:*`）も明示指示があるまで実行しない。型検査・単体テストは実装確認のため実行してよい。

秘密情報（Cookie・トークン・実アカウント・実 usage 値・実ページ HTML）をコード・fixture・Issue テンプレの例示に入れない。fixture は合成データのみ。

---

## 概要

ストア公開後のユーザーが「不具合をどこに出せばいいか」を迷わないようにする。Chrome ウェブストアのレビュー欄は Google 上の公開評価であり、開発者向けのバグトラッカーではない。正典のサポート窓口を自前で示す必要がある。

同時に、すでに公開されている使い方ページの URL ドリフトを直す。

- **使い方は ishizakahiroshi.com に載っている**（2026-07-19 時点で 200）
- **拡張と README は github.io を指しており、そちらは 404**（リンク切れ）
- 不具合は **GitHub Issues を主経路**にし、非 GitHub ユーザー向けに **テンプレ txt のコピペ**と任意の **mailto** を足す

スコープ外:

- 独自問い合わせサーバー・DB・チケットシステムの新設
- 実 usage 値や DOM の自動アップロード（プライバシーモデル違反）
- ストアレビューの自動収集・スクレイプ
- API 従量課金サポート窓口

---

## 現状と問題（2026-07-19 調査スナップショット）

### 使い方ページ

| URL | 状態 | 備考 |
|---|---|---|
| `https://ishizakahiroshi.com/articles/many-ai-usage/usage.html` | **200・公開中** | S-01〜S-04（3分ガイド / 練習場 / レシピ / FAQ）。FAQ 末尾は GitHub Issues 誘導済み |
| `https://ishizakahiroshi.github.io/articles/many-ai-usage/usage.html` | **404** | 拡張・README がまだここを指している |
| `https://ishizakahiroshi.com/work.html?id=many-ai-usage` | **200** | works カード側 |

コード上の正典定数:

```ts
// src/shared/samples.ts
export const USAGE_GUIDE_URL = 'https://ishizakahiroshi.github.io/articles/many-ai-usage/usage.html';
```

参照箇所（少なくとも）:

- `src/shared/samples.ts` — `USAGE_GUIDE_URL`
- `src/popup/main.tsx` — 空状態「使い方を見る →」
- `src/options/main.tsx` — Try samples onboarding 内リンク
- `README.md` — Japanese usage guide リンク
- `docs/local/design_unpacked-testing-guide_2026-07-16.html` — T5 期待 URL
- 過去 plan / mockup（`docs/local/mockup_usage-page_2026-07-16.html` 等）— 履歴として github.io 表記が残る。実装対象は現行コードとユーザー向け docs を優先

ローカル作業ツリー `C:\dev\works\github.io`（remote: `ishizakahiroshi/ishizakahiroshi.github.io`）には 2026-07-19 時点で `articles/many-ai-usage/` が無い。本番 `.com` には載っているため、**デプロイ元とローカル clone のズレ**があり得る。C3 着手時にサイトリポの実体パスを再確認する。

### 不具合報告の現状

- usage.html FAQ: 「GitHub Issue で報告」「秘密情報を載せない」と書いてある（良い）
- 拡張 UI 内に「報告する」導線が無い（options / popup に About・Report なし）
- ストア listing 下書き（`docs/store/listing.*.md`）に Support URL 欄が未記載
- Chrome ストアのレビューは公開評価のみ。構造化バグ管理には使えない

### 前回会話での方針（要約）

- Google に「開発者バグトラッカー」はない → 自前窓口が必要
- OSS では GitHub Issues 誘導で問題ない
- ユーザー提案: かんたんモード（`.com` 宛メール / GitHub 簡単投稿 / txt 作ってコピペ）

---

## 方針

### A. 使い方 URL

**正典を `https://ishizakahiroshi.com/articles/many-ai-usage/usage.html` に一本化**する。

- 拡張定数 `USAGE_GUIDE_URL` を `.com` に変更
- README・store 文案・テストガイドの期待 URL を追随
- github.io への redirect は任意（サイト側で余裕があれば）。必須ではない。リンク切れを直すだけで v0.1.x は足りる

### B. かんたん報告（推奨パッケージ）

ユーザー案 3 つを **排他ではなく段階** で載せる。

| 経路 | 誰向け | 扱い |
|---|---|---|
| **1. レポート txt 生成 → コピー** | 全員（最優先） | 拡張が非秘密の診断項目を埋めたテキストを生成し、クリップボードへ。GitHub / メール / どこでも貼れる |
| **2. GitHub Issues 簡易投稿** | GitHub アカウントあり | `issues/new?title=&body=` で本文プリフィル。主経路・追跡可能 |
| **3. mailto（任意）** | GitHub が使えない人 | 公開サポート用アドレスへ。チケット化は手動。アドレス未決なら v0.1 では出さない or サイト Contact に寄せる |

**推奨 UI 置き場（拡張）:**

1. **options フッター or サイドバー下部**に「Report a problem / 不具合を報告」リンク（常時見える）
2. クリックで **簡易フォーム（同一 options 内パネル or 軽いモーダル）**
3. 自動埋め込み（秘密にしないものだけ）:
   - 拡張 version（`manifest.version`）
   - browser: Chrome / Firefox（`navigator.userAgent` から粗い判定で可。UA 全文は任意・デフォルト OFF）
   - 登録 provider 数、各 `displayName` と `runtimeStates.status`（`ok` / `needs_permission` / `re_teach` 等）
   - 選択中 provider があればその displayName と status
4. ユーザー入力:
   - 短いタイトル（必須）
   - 何が起きたか（必須・数行）
   - 再現手順（任意）
   - 「スクショは個人情報を隠して添付してください」注意文（固定）
5. アクションボタン:
   - **Copy report**（必須・成功トースト）
   - **Open GitHub Issue**（必須・新規タブ）
   - **Email**（公開アドレス決定後のみ。未決なら hidden）

**絶対に自動で入れないもの:**

- Cookie / トークン / Authorization ヘッダ
- ページ HTML / innerText の生値
- 実 usage 数値・リセット日時の実値
- ログインメール・アカウント ID
- provider.url にクエリトークンが載る可能性があるため、**URL はデフォルト OFF**（ユーザーが明示チェックしたときだけ「ホスト名のみ」または「パスまで・クエリ除去」）

### C. サイト側

- usage.html S-04 FAQ の「うまく動きません」に、拡張内「かんたん報告」への言及を 1 行追加（実装後）
- 任意: `articles/many-ai-usage/support.html` を薄く作り、ストア Support URL の着地点にする（FAQ 要約 + GitHub + メール + 「拡張の Report を使ってください」）
- 正典が `.com` なので、ストア Support URL も `.com` 配下

### D. 採用しない / 後回し

| 案 | 理由 |
|---|---|
| 独自 form → 自前 API | サーバーを持たない方針と衝突。運用コスト増 |
| ストアレビューだけに任せる | 追跡不能・公開低評価が主戦場になる |
| GitHub Discussions を主経路 | Issue の方がバグ向き。Discussions は Q&A 用に後から足せる |
| 自動で DOM スナップショット添付 | プライバシー違反リスク大 |

### E. メールアドレス方針（判断ポイント）

ポートフォリオ Contact は「メールアドレスを表示」式。サポート専用アドレスをどうするかは実装前に 1 点だけ決める。

| 選択肢 | メリット | デメリット |
|---|---|---|
| **E1: 当面メールなし**（Recommended） | 実装単純・スパム少・Issue に集約 | GitHub 不可ユーザーは txt コピペのみ |
| E2: サイト Contact と同じ個人メールを mailto | すぐ届く | スパム・個人受信箱汚染 |
| E3: サポート専用アドレス（例: 転送のみ） | 分離できる | 設定作業・DNS が別タスク |

plan 実行時の既定は **E1**。ユーザーが E2/E3 を指示したら mailto ボタンを出す。

---

## C1: 使い方 URL の正規化

### 作業内容

1. `USAGE_GUIDE_URL` を  
   `https://ishizakahiroshi.com/articles/many-ai-usage/usage.html` に変更
2. 定数を使う UI はそのまま（popup / options）
3. `README.md` の usage guide リンクを同じ URL に
4. `docs/store/listing.en.md` / `listing.ja.md` の末尾に「Usage guide」1 行を足してよい（任意だが推奨）
5. ローカル検証ガイド `docs/local/design_unpacked-testing-guide_2026-07-16.html` の T5 期待 URL を更新
6. テストがあれば定数期待値を追随（現状 `samples.ts` を直接 import するテストの有無を確認）

### 変更予定ファイル

- `src/shared/samples.ts`
- `README.md`
- `docs/store/listing.en.md` / `docs/store/listing.ja.md`（任意追記）
- `docs/local/design_unpacked-testing-guide_2026-07-16.html`
- 関連テスト（あれば）

### 完了条件

- リポジトリ内の **ユーザー向け現行導線** が `.com` の usage.html を指す
- ブラウザで当該 URL が 200 であることは既知（再確認可）
- github.io 404 を指す実行時コードが残っていない（`rg ishizakahiroshi.github.io/articles/many-ai-usage` が src/ と README で 0）

---

## C2: 拡張内「かんたん報告」UI

### 作業内容

1. **診断テキスト生成モジュール**を shared に置く（例: `src/shared/report.ts`）
   - 入力: dashboard 相当の非秘密フィールド + ユーザー記入
   - 出力: Markdown or プレーンテキスト 1 本（Issue body とクリップボード兼用）
2. **options に Report パネル**を追加
   - 置き場候補: サイドバー下部 or ヘッダ横メニュー。実装時は既存 CSS（`options/styles.css`）のトーンに合わせる
   - 英語 UI が本体ならラベルは英語主・日本語は usage ページ側で説明、でも可。既存 UI が混在（「使い方を見る →」等）なので、Report も **日本語短ラベル + 英語併記** か **英語のみ** のどちらかに揃える。既存の空状態が日本語ボタンなので **日本語ラベル可**
3. ボタン
   - Copy → `navigator.clipboard.writeText`
   - Open GitHub Issue →  
     `https://github.com/ishizakahiroshi/many-ai-usage/issues/new?title=${encodeURIComponent(t)}&body=${encodeURIComponent(body)}`  
     （body が長すぎる場合は title のみ開き、body は「クリップボードにコピー済みなので貼ってください」と案内。目安: URL 全体 1500〜2000 文字超でフォールバック）
   - Email → E1 なら非表示
4. 単体テスト: `report.ts` が秘密フィールドを出力に含めないこと、必須項目の組み立て、長文フォールバック判定
5. popup からは深リンク不要でもよい。options を開く「Report」1 本で足りる。余裕があれば popup フッターに小さなリンク

### レポート本文テンプレ（直書き・実装に使う）

```text
## Summary
<user title>

## What happened
<user description>

## Steps to reproduce
<user steps or "(not provided)">

## Environment (auto-filled, non-secret)
- Extension: many-ai-usage v<version>
- Browser: <Chrome|Firefox|Other>
- Providers: <n>
- Status summary:
  - <displayName>: <status>
  - ...

## Notes
- Do not paste cookies, tokens, account emails, raw HTML, or real usage numbers.
- Screenshots: mask personal data before attaching.
```

### 変更予定ファイル

- `src/shared/report.ts`（新規）
- `src/options/main.tsx`
- `src/options/styles.css`
- `tests/report.test.ts`（新規）
- 必要なら `src/popup/main.tsx`（小さなリンク）

### 完了条件

- options からレポート文面を生成しコピーできる
- GitHub Issue 新規作成タブが開く（ネットワーク実投稿はユーザー操作）
- 自動埋め込みに usage 実値・URL クエリ・Cookie が無い（テストで担保）
- `pnpm test` / `pnpm run typecheck` が通る

---

## C3: サイト側・Issue テンプレ

### 作業内容

1. サイト作業ツリーを特定（候補: `C:\dev\works\github.io` = `ishizakahiroshi/ishizakahiroshi.github.io`）。**`articles/many-ai-usage/usage.html` の実ファイル場所を確認**してから編集
2. usage.html S-04「うまく動きません」に追記:
   - 拡張の Settings → Report a problem（最終ラベルに合わせる）
   - 引き続き GitHub Issues リンク
   - 秘密情報を載せない注意（既存文を維持）
3. 任意: `support.html` を薄く追加し、ストア Support URL の着地にする
4. 拡張リポ側: `.github/ISSUE_TEMPLATE/bug_report.yml`（または md）を追加し、上記テンプレと項目を揃える
5. github.io 404 対策は任意（`.com` 正典化で足りる）。やるなら同一 path に短い meta refresh か「moved」1 枚

### 変更予定ファイル

- サイトリポ: `articles/many-ai-usage/usage.html`（および任意 `support.html`）
- 本リポ: `.github/ISSUE_TEMPLATE/bug_report.yml`（または `.md`）
- 本リポ: `docs/store/listing.*.md` の Support 1 行（C4 と重複可）

### 完了条件

- FAQ から「拡張内レポート」と Issues の両方に辿れる
- Issue テンプレが公開リポに存在し、秘密情報注意が先頭付近にある
- サイト変更はユーザーがデプロイするまで公開反映されない（AI は push / デプロイしない）

---

## C4: ストア listing の Support 運用

### 作業内容

1. `docs/store/listing.en.md` / `listing.ja.md` に明記:
   - Homepage: `https://github.com/ishizakahiroshi/many-ai-usage` または works ページ
   - Support: usage.html の FAQ アンカー、または `support.html`
   - Privacy policy: 既存 `docs/privacy-policy.html`（公開 URL は既存方針に従う）
2. `docs/store/submission-notes-v0.1.0.*.md` に「Support URL の意図」を 2〜3 行（審査員向け）
3. 運用メモ（本 plan 末尾または listing に短く）:
   - ストアレビューにバグが来たら: 短く返信し、Report / Issues へ誘導
   - 星評価はコントロールしきれない前提

### 変更予定ファイル

- `docs/store/listing.en.md`
- `docs/store/listing.ja.md`
- `docs/store/submission-notes-v0.1.0.en.md` / `.ja.md`（軽微追記）

### 完了条件

- 次のストア提出時に Support URL を迷わず埋められる
- 拡張・サイト・ストアの 3 箇所で「報告先」が矛盾しない

---

## 検証チェックリスト（全体）

1. `.com` の usage.html が 200
2. 拡張「使い方を見る →」が `.com` を開く
3. Report パネルで Copy した結果に秘密らしき自動項目が無い
4. Open GitHub Issue で new issue 画面が開き、title/body または「paste from clipboard」案内が出る
5. `pnpm test` / `pnpm run typecheck`
6. ストア下書きの Support / Homepage / Privacy が埋まっている

---

## 禁止・停止条件

- ユーザー指示なしの `git commit` / `push` / `tag` / ストア申請 / サイト本番デプロイ
- 報告機能で HTML・Cookie・実 usage を収集・送信する実装
- 独自サーバーへの POST

停止してユーザーに返す条件:

1. サイトリポに `usage.html` のソースが見つからず編集不能
2. サポート用メールを E2/E3 にするかユーザー判断が必要で、mailto を必須要件にされた場合
3. GitHub Issue URL 長制限でプリフィルが実用にならず、方針変更が必要な場合（Copy 必須で逃げられるなら自走可）

---

## 成果物のイメージ

| 成果物 | 場所 |
|---|---|
| 正典 usage URL 定数 | `src/shared/samples.ts` |
| レポート生成 | `src/shared/report.ts` + options UI |
| Issue テンプレ | `.github/ISSUE_TEMPLATE/` |
| FAQ / 任意 support ページ | ishizakahiroshi.com 側 articles |
| ストア Support 文案 | `docs/store/listing.*.md` |

---

## 判断ログ

| 日付 | 判断 | 内容 |
|---|---|---|
| 2026-07-19 | 調査 | usage は `.com` に存在、github.io は 404。拡張は github.io 参照 |
| 2026-07-19 | 方針案 | 報告は txt コピー + GitHub 簡易投稿を必須、mailto は E1（当面なし）既定 |
| 2026-07-19 | 未決 | サポート用メールを出すか（E1/E2/E3）。実行時既定は E1 |
| 2026-07-19 | 敵対レビュー | support.html live 404・GitHub 短い本文時の未コピー・FAQ 未反映（本番）を指摘 |
| 2026-07-19 | フォロー実装 | openGitHub は常時 copy + `githubOpenUserMessage`。privacy allowlist テスト追加。support 文言強化。サイト本番はユーザー push/デプロイ待ち |

---

## 実装時の推奨ラベル案（UI 文言）

- 導線: `不具合を報告` / `Report a problem`
- ボタン: `レポートをコピー` / `GitHub で開く` / （任意）`メールで送る`
- 成功: `クリップボードにコピーしました。Issue に貼り付けてください`
- 注意: `Cookie・トークン・実利用量・ページ本文は書かないでください`
