---
type: plan
status: in-progress
tags: [try-samples, onboarding, remote-registry, providers]
owner: ishizakahiroshi
review_status: draft
related: [plan_add-providers-json.md, plan_usage-page-ja.md]
last_reviewed: 2026-07-16
due: 2026-07-23
---

# [進行中] plan: Try samples オプトイン化 (Remote Registry 版・v0.1)

> ローカル実装完了: 2026-07-16 · typecheck / test (24 passed) / build:chrome / build:firefox / Chrome・Firefox bundle validation すべて緑。Remote Registry は公開・200応答確認済み。unpacked 手動確認は未完了。

## 背景

`articles/many-ai-usage/usage.html`（使い方ページ）の設計方針として **「公式サポートに見えるプロバイダ定義は同梱しない」** を採用（会話履歴 2026-07-16）。当初は「拡張バンドルに samples.json を含めるオプトイン方式（C 案）」を検討したが、以下の理由で **Remote Registry 方式 (C+)** に格上げ:

- 拡張の dist/ を真にゼロ同梱にできる（バイナリ検査しても他社サービスの URL が入っていない）
- URL 変更・サービス追加が拡張リリース不要で反映できる
- many-ai-cli が既に同種のインフラ（`resources/usage-links/defaults.json` を raw fetch + 24h TTL キャッシュ）を持っており、そこに同居させれば **URL マスタが 1 箇所に集約**される

つまり today's build state = 「URL パターンを拡張本体に持つ準ゼロ同梱」→ target build state = 「URL パターンも remote から明示同意で fetch する完全ゼロ同梱」。

## 現状（2026-07-16 のローカル実装状態）

### many-ai-usage 拡張本体

- `initializeStorage()` は provider を自動 seed せず、空の provider 一覧で開始する
- `makeSampleProviders()` と同梱 URL は削除済み。`dist/` と `src/` に6サービスの URLが含まれないことを確認済み
- options / popup に「Try samples」導線を実装済み。取得先 URL と取得内容を表示し、明示確認後だけ Remote Registry を fetch する
- registry の schema validation、既存設定を上書きしない merge、冪等性、失敗時の再試行を実装・テスト済み
- Chrome / Firefox manifest に GitHub raw の固定 host permission を追加し、プライバシー文書・ストア文面・審査 note も更新済み

### many-ai-cli（Remote Registry）

- `resources/usage-links/providers.json` は GitHub の `main` に公開済み
- 拡張が参照する raw URL の 200 応答、schema `many-ai-usage.providers.v1`、6サービスの内容を確認済み
- fixture を使う自動検証は完了。実レジストリを使う unpacked 手動確認のみ未完了

## 目的

1. many-ai-cli リポに新規ファイル **`resources/usage-links/providers.json`** を追加（many-ai-usage 用の provider 定義）。既存の `defaults.json` は触らない（後方互換維持）
2. many-ai-usage 拡張は起動時に自動 seed **しない**（空スタート）
3. options / popup に「**Try samples ▸**」ボタンを設け、押した時に providers.json を fetch → schema validation → storage に merge
4. manifest に `host_permissions: ["https://raw.githubusercontent.com/ishizakahiroshi/*"]` を追加
5. fetch 前に同意ダイアログで取得先 URL を全表示（透明性）

## 変更範囲

### 【リポ 1: many-ai-cli】

**別 plan md に委譲**: `C:\dev\github\public\many-ai-cli\docs\local\plan_add-providers-json.md`

要点:
- `resources/usage-links/providers.json` を新規追加（6 サービス分の provider 定義・schema `many-ai-usage.providers.v1`）
- 本 plan の拡張実機動作確認は上記 plan の完了（main へ merge）が **前提**

### 【リポ 2: many-ai-usage】

作業ディレクトリ: `C:\dev\github\public\many-ai-usage`

**A. 拡張本体コード**

1. **`src/shared/schema.ts`**
   - `makeSampleProviders()` を **削除**（残すなら deprecated コメント）
   - 新規 export: `parseProvidersRegistryResponse(raw: unknown): ProviderConfig[]` — providers.json のレスポンスを validate して `ProviderConfig[]` を返す純関数
   - schema バージョン `many-ai-usage.providers.v1` 以外は拒否

2. **`src/shared/samples.ts`（新規）**
   - `PROVIDERS_REGISTRY_URL = 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json'` を export
   - `fetchProvidersRegistry(): Promise<ProviderConfig[]>` — fetch + validate + return
   - `SAMPLE_PROVIDER_IDS: readonly string[]` — id 一覧の const（UI 側で "サンプル済みか" 判定用）

3. **`src/shared/storage.ts`**
   - `initializeStorage()` から seed 除去（`makeSampleProviders()` 呼び出しを削る）
   - 新規: `applyRegistryProviders(remote: ProviderConfig[]): Promise<{ added: string[]; skipped: string[] }>` — 既存 provider があれば id で重複回避しつつ merge、追加した id と skip した id を返す

4. **`src/options/main.tsx`**
   - providers が空 or サンプル id を 1 件も持たない時、「Try samples ▸」ボタン表示
   - クリックで確認ダイアログ:
     - 「以下の URL からサンプル設定を取得します: `raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json`」
     - 「取得するのは URL パターンのみです。selector は含まれません（teach モードで教えてください）」
     - [ 取得する ] [ キャンセル ]
   - 取得後 `applyRegistryProviders()` を呼ぶ、結果を toast で表示
   - 使い方ページへのリンク: `https://ishizakahiroshi.github.io/articles/many-ai-usage/usage.html`
   - fetch 失敗時: エラーメッセージ + 再試行ボタン

5. **`src/popup/main.tsx`**
   - providers が空の時、ダッシュボードの空状態に「Try samples ▸」と「使い方を見る →」ボタン
   - サンプルボタンは options と同じフローを開く（options タブを開いてダイアログ表示、または popup 内で完結）

6. **`src/extension/manifest.chrome.json` / `manifest.firefox.json`**
   - `host_permissions` に `"https://raw.githubusercontent.com/ishizakahiroshi/*"` を追加

**B. テスト**

7. **`tests/`**
   - 既存の `initializeStorage()` テストを「providers が空でも VERSION が入る」に書き換え
   - 新規: `parseProvidersRegistryResponse()` の schema バージョン検証 / 不正データ拒否 / 6 サービスパースの正常系
   - 新規: `fetchProvidersRegistry()` を fetch mock で通す（`vitest` の `vi.stubGlobal('fetch', ...)`）
   - 新規: `applyRegistryProviders()` の冪等性（2 回呼んでも重複しない）+ 既存 provider を上書きしない

**C. ドキュメント**

8. **`README.md`**
   - "What ships out of the box" に「Zero pre-configured providers」を明記
   - "Getting started" に「Try samples で 6 サービスのサンプルを試す or 使い方ページの練習場で teach を覚える」を書く
   - Fetch する URL を明記

9. **`docs/store/`（ストア掲載文）**
   - 「初期状態で他社サイトへの自動アクセスは発生しません」
   - 「Try samples ボタンを押した時に限り、GitHub raw から URL パターンのみ取得します」

## 実装ステップ（推奨順）

1. **前提**: many-ai-cli 側 plan (`plan_add-providers-json.md`) が完了し `providers.json` が main に merge されていること（未 merge でも fixture でテストは可能）
2. `src/shared/schema.ts` に `parseProvidersRegistryResponse()` を追加、`makeSampleProviders()` を削除
3. `src/shared/samples.ts` を新規作成
4. `src/shared/storage.ts` の `initializeStorage()` から seed 除去、`applyRegistryProviders()` を追加
5. 既存テストを更新 + 新規テスト追加 → `pnpm test` 緑
6. `src/options/main.tsx` に空状態 UI + 確認ダイアログ + fetch 導線を追加
7. `src/popup/main.tsx` に空状態 UI 追加
8. `src/extension/manifest.chrome.json` / `manifest.firefox.json` に `host_permissions` 追加
9. `README.md` / `docs/store/` 更新
10. `pnpm run typecheck` + `pnpm test` + `pnpm run build:chrome` / `pnpm run build:firefox` 緑
11. Chrome / Firefox の unpacked インストールで動作確認（**未完了**。Remote Registry の公開は完了。ローカルでは fixture・bundle validation で代替検証済み）

## 検証

- Chrome / Firefox の unpacked インストール後の初回起動: providers が空、options に「Try samples ▸」ボタンが表示
- ボタン → 確認ダイアログ → 「取得する」で 6 タイル（Claude / Codex / Grok / Copilot / Cursor / Ollama）が並ぶ
- selector 未教示状態なので teach で数字が入る
- 2 回押しても重複しない（`applyRegistryProviders()` の冪等性）
- 既存 storage を持つ人（すでに sample:claude 等を持つ）に対しては何も起きない（`initializeStorage()` は seed しない、`applyRegistryProviders()` は重複回避）
- fetch 失敗（オフライン等）時にエラーメッセージ + 再試行ボタン
- ストア審査提出時の note に「fetch は data (JSON) のみで code は取得しない」明記の準備

## リスク

- **many-ai-cli の main ブランチに `providers.json` を先に push する必要**: many-ai-usage 拡張の実機動作確認は raw URL 依存。GitHub Pages ではなく raw なので反映は即時（数秒〜数分）
- **ストア審査**: MV3 の "Remote hosted code is not allowed" 規約 → data (JSON) は該当しない。selector を eval しないので RCE 経路なし。レビュー note で明示
- **既存ユーザー影響**: すでに `sample:claude` / `sample:codex` を storage に持っている人には影響なし（seed 経路を停止するだけ・migration 書かない）
- **URL 変更耐性**: providers.json を編集して push すれば拡張リリース不要で反映される。ただし新 URL に対する urlMatch が既存の match pattern から外れる場合は host_permissions 追加リリースが必要（このケースは urlMatch を広めに取ることで回避可能）

## 残作業 / 完了条件

- many-ai-usage の公開 remote を設定し、Chrome / Firefox の unpacked 手動動作確認を行う
- 上記完了後に H1 を `[完了]`、frontmatter を `status: done` に戻す
- 使い方ページとの文言・6サービス・取得先 URL の整合確認は完了済み

## 実装担当

- 本会話セッションで拡張本体、ドキュメント、使い方ページを実装・検証
