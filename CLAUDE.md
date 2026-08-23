<!-- このファイルはプロジェクト固有ルールのみを書く。個人/グローバル AI ルール
（言語・確認スタイル・出力フォーマット等）は各 AI ツールのグローバル設定へ。
fresh public clone でも有効な内容に保つこと。 -->

# many-ai-usage 開発ガイド

## プロジェクト概要

**many-ai-usage** — 複数の AI サービスのサブスクリプション使用量（レート上限・残枠）を 1 画面のダッシュボードで一覧表示するブラウザ拡張（Manifest V3・Chrome / Firefox ハイブリッド）。ユーザーは各サービスにブラウザでログインし、usage ページを登録して表示値を teach するか、review 済み starter 設定を明示的に取り込む。

プロバイダ定義は bundle へ自動 seed せず、初期状態は 0 件。ユーザーが **Try samples** を明示実行した場合だけ、このリポジトリの `main/resources/starter.json` から 7 provider の公開設定を取得する。現行 pack は 4 provider に review 済み taught metric（selector / fingerprint）、残り 3 provider にページタイル設定を含み、実行コードや利用者データは含まない。取得の主経路は**ユーザーが要素を 1 回クリックして教える teach-mode**（CSS selector + DOM fingerprint を保存し、後続訪問で再読取）で、Auto のまま teach していない provider は**タイルとして表示**する。旧ローカルヒューリスティック解析（%・progress 要素・リセット日時。日英中対応）は runtime から除外し、合成 fixture の regression reference / tests-only としてのみ保持する。解析はブラウザ内のみで行い、ページ HTML を外部 AI に送らない。独自サーバーは持たず、認証情報も usage データもすべてブラウザ内で完結する。

starter は公開ページ変更へ extension 再配布なしで追従するため live `main` を意図的に使う。固定 owner の HTTPS host、schema / byte size、provider origin と urlMatch の同一 origin を import 時に検証する。更新は `resources/starter.json` の公開合成設定として review し、不具合時は該当変更を revert する。無断で実在利用者由来の文字列を追加しない。

配布は Chrome ウェブストア + Firefox AMO の 2 チャネルのみで、GitHub リポジトリを正典とする。npm の `many-ai-usage` はブランド保護の予約スタブのみ（配布経路ではない・リリース時に version だけ追従更新）。

## やらないこと（スコープ外）

- Chrome / Firefox 以外のブラウザ対応（Safari は検証環境がなく対象外。Edge は Chrome ストア経由の利用は妨げないが公式サポートしない）
- 独自サーバー・アカウント・クラウド同期（データはブラウザ内のみ）
- 各 AI サービスへのログイン代行・認証情報の保存（ユーザー自身のブラウザセッションを読むだけ）
- usage の書き換え・チャット送信など読み取り以外の操作
- API キー方式（従量課金）の残高管理 <!-- TODO: 壁打ちで確定 -->

## 技術スタック

| レイヤ | 採用 |
|------|------|
| 拡張形式 | WebExtension Manifest V3（Chrome / Firefox ハイブリッド） |
| 配布 | Chrome ウェブストア + Firefox AMO（正典: GitHub） |
| 言語 / UI | TypeScript / Preact |
| ビルド | esbuild |
| データ保存 | `chrome.storage`（ブラウザ内完結） |
| 参考実装 | always-pinned（Chrome 拡張 / webstore 公開済み）・tab-title-prefix（WebExtension） |

## ディレクトリ構成

- `src/content/teach/`: teach-mode の selector/fingerprint、値抽出、picker overlay、再読取
- `src/background/`: provider mutation、refresh lifecycle、storage 更新の単一 owner
- `src/content/detector/`: runtime 未接続の regression reference / tests-only ヒューリスティック解析
- `src/shared/`: schema、storage、runtime message
- `src/options/` / `src/popup/`: 設定（Track/Re-teach）とダッシュボード UI
- `src/extension/` / `src/locales/`: manifest・HTML・asset と言語 pack

## 主要コマンド

- `pnpm test` — 合成 DOM fixture の単体テスト
- `pnpm run typecheck` — TypeScript 型検査
- `pnpm run build:chrome` / `pnpm run build:firefox` — 各ストア向け bundle

## AI 作業共通ルール

ビルド・コミット禁止、secrets-scan 責務、plan/bugfix/pending md の作成ルール等の AI 作業共通ルールは、各利用者のグローバル AI 設定に従う（作者環境の例: `~/.claude/CLAUDE.md` および `~/.claude/guides/`）。

- 動作確認で取得した実レスポンス（アカウント ID・メール・トークン・使用率の実値）をテスト fixture・ドキュメントに貼らない。最初から合成データで書く

## secrets-scan（このリポジトリの配線）

書く瞬間の責務（固有名詞の一般化・fixture は合成データ等）は上記「AI 作業共通ルール」の参照先に従う。このリポジトリ固有の配線は以下:

- scanner: `scripts/secrets-scan.mjs`（手動実行: `node scripts/secrets-scan.mjs --staged --block`）
- layer 2: pre-commit hook（`.githooks/` 方式。有効化: `scripts/install-hooks.ps1` または `.sh`）
- layer 3: `.github/workflows/secrets-scan.yml`（branch / PR の tracked file、CI では構造 regex）
- layer 4: `.github/workflows/release.yml` が tag build 前に `--all-tracked --block` を再実行する。作者環境の外部 release 手順が KB watchlist 付き scan を追加する場合があるが、それは public clone の保証には含めない
- env (full coverage に必要・未設定なら構造 regex のみで継続): `KB_ROOT` / `FAMILY_ROOT`。設定詳細は `scripts/secrets-scan.mjs` の冒頭コメント
- 参照実装・設計詳細: `worklog-bridge` リポの `docs/local/secrets-scan-design/`（gitignored・公開しない）

## 関連ドキュメント

| 項目 | パス |
|---|---|
| ユーザー向け README | `README.md` |
| Codex/他 AI 用入口 | `AGENTS.md` |
| ローカル作業ノート（非公開） | `docs/local/`（存在する場合） |
