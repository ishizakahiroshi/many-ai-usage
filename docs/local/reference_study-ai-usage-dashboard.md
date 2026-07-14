# 参考 OSS 調査: AI_Usage_Dashboard

調査日: 2026-07-12

対象: `C:\dev\github\study\AI_Usage_Dashboard`

ライセンス: AGPL-3.0-only（`C:\dev\github\study\AI_Usage_Dashboard\LICENSE`、`package.json`）。このレポートは挙動・構造・設計上の含意だけを記録し、コードの転用・翻案は行わない。

## 読み方

- **コードで確認**: 実装またはテストから直接確認できた事実。
- **README/Docs 記載**: リポジトリの説明に書かれているが、実装の全経路まではこの調査で追っていない事項。
- **推測/示唆**: many-ai-usage への設計上の解釈。事実と混同しない。

## 要約

**コードで確認**: AI_Usage_Dashboard は「公式 API を使える場合は API、個人利用ではログイン済み usage ページを `tabs` + `scripting` で読む」という provider 内の複数ソース構成を採用している。ブラウザ拡張の state は `storage` に保存し、`alarms` で定期同期し、ポップアップ・side panel・full-page dashboard・toolbar badge に同じスナップショットを流す。

**コードで確認**: 任意 provider の追加に相当する custom source は、任意の実行コードや任意の HTTP header を登録する方式ではなく、ユーザーが URL を登録し、固定の `ai-usage-dashboard.custom-source.v1` JSON 契約で応答を返す方式である。レスポンス本文を表示・保存せず、正規化後のスナップショットだけを保存する。

**推測/示唆**: many-ai-usage が目指す「URL を登録してページをローカル解析」は、同リポジトリの page-session 基盤と近い。ただし、AI_Usage_Dashboard は provider ごとの parser と route knowledge を運営側が持つため、プロバイダ知識ゼロを狙う many-ai-usage とは保守責任が逆である。

## 1. データ取得方式

| Provider | 取得経路 | 認証・レスポンス処理 | 根拠 |
|---|---|---|---|
| Codex | Enterprise は公式 analytics API。個人は ChatGPT の usage / cloud analytics page の DOM | Enterprise は `Authorization: Bearer`、workspace ID と cursor pagination を使い、`data` を全ページ連結。個人 page はログイン状態を判定し、usage window・balance・reset を parser で正規化 | `src/providers/codex/official.ts`, `src/providers/codex/adapter.ts`, `src/providers/codex/personal-page-capture.ts`, `src/providers/codex/personal-page-parser.ts` |
| Cursor | Team Admin API。個人は `cursor.com/.../dashboard/usage` の DOM | Admin API は Basic 認証で `/teams/members`、`/teams/spend`、`/teams/daily-usage-data` を呼ぶ。個人 page は表示テキストから plan、request、spend、reset 等を抽出し、見えていない残高を発明しない | `src/providers/cursor/official.ts`, `src/providers/cursor/adapter.ts`, `src/providers/cursor/personal-page-capture.ts`, `src/providers/cursor/personal-page-parser.ts` |
| Claude Code | Admin analytics API。個人/Team は `claude.ai/settings/usage` の DOM | API は `x-api-key` と `anthropic-version` を付け、`/v1/organizations/usage_report/claude_code` の page pagination を連結。page は usage、team、plan、reset などの語と数値を組み合わせて判定・正規化 | `src/providers/claude-code/official.ts`, `src/providers/claude-code/adapter.ts`, `src/providers/claude-code/personal-page-capture.ts`, `src/providers/claude-code/personal-page-parser.ts` |
| Gemini Code Assist | live usage を取らず、ドキュメント化された静的 quota policy | `policy_only` の snapshot を生成。実アカウントの live usage として扱わず、policy-only の診断を表示 | `src/providers/gemini/official.ts`, `src/providers/gemini/adapter.ts`, `src/providers/diagnostics.ts` |
| JetBrains AI | JetBrains Console の `Users and licensing` page DOM | `account.jetbrains.com` / `*.jetbrains.com` のタブを探し、heading/title/html の複数マーカーでログイン済みページを判定。fixture 経路と live page-session 経路があるが、README では active promise から延期 | `src/providers/jetbrains/official.ts`, `src/providers/jetbrains/adapter.ts`, `README.md` |

### 共通 page-session 実装

**コードで確認**: `src/providers/page-session.ts` が共通クライアントであり、以下を持つ。

- URL pattern に一致する候補タブを `tabs.query` で探す。
- `pageBinding` があれば bound tab を優先し、tab の削除・URL変更・置換時に stale 化する。
- `scripting.executeScript` で isolated world の URL/title/heading/html を読む。
- extraction mode は `dom`、`boot_data`、`network_observer` の3種。ただし今回確認した Codex/Cursor/Claude/JetBrains の live page 定義は `dom` を指定する。
- タブがない場合、provider の設定が許すと非アクティブ tab を開き、load 完了を polling して、unmatched なら閉じる。
- `reloadBeforeCapture` / `reloadOnCaptureFailure`、load timeout、poll interval、post-load delay を provider ごとに指定できる。

**コードで確認**: Codex は reload 前後とも timeout 10 秒・poll 250 ms・post-load 3 秒、Claude は 15 秒・poll 250 ms・post-load 3.5 秒を指定している。背景 tab の throttling と React/Next.js hydration を見越した値で、Claude の retry 判定も別ファイルにテストされている。

根拠: `src/providers/page-session.ts`, `src/providers/page-session-tab-lifecycle.ts`, `src/providers/codex/personal-page-capture.ts`, `src/providers/claude-code/personal-page-capture.ts`, `src/providers/claude-code/personal-page-client.ts`, `src/providers/claude-code/__tests__/claude-render-timeout.test.ts`。

### endpoint / fixture の境界

**コードで確認**: official client は `source: "fixture" | "live"` を持つ。API key 等がない時は fixture を選べるため、テストは合成 JSON fixture で完結する。live API は `response.ok` が false なら HTTP status を含む Error にし、JSON を typed response として mapper に渡す。pagination の `has_more` と cursor/page の不整合もエラーにする。

根拠: `src/providers/codex/official.ts`, `src/providers/cursor/official.ts`, `src/providers/claude-code/official.ts`, `fixtures/`。

## 2. custom HTTP/HTTPS JSON sources

### スキーマと登録データ

**コードで確認**: source 設定は次の形である。

```text
CustomSourceSetting
  id: custom:<lowercase id>
  label / description
  endpointUrl: http:// または https://
  displayEnabled
  refreshIntervalMinutes: 3〜1440、既定15
  createdAt / updatedAt
```

レスポンスは `schema: "ai-usage-dashboard.custom-source.v1"`、`label`、`status: ok|warning|error`、および `summary` / `quota` / `windows` / `balances` / `facts` の少なくとも一つを要求する。metric は `unit` と `used` / `remaining` / `total` のいずれかを持ち、`window`、`resetAt`、`resetLabel` を任意に持つ。配列上限は windows 8、balances 8、facts 16。

文字列は whitespace・長さを正規化し、制御文字と `<` / `>` を拒否する。数値は finite かつ非負に限定し、応答全体は 128 KiB、timeout は 10 秒である。

根拠: `src/shared/custom-sources.ts`, `Doc/Product/Custom_JSON_Sources.md`。

### UI / validation / error handling

**コードで確認**: `src/sidepanel/components/CustomSourceSettingsSection.tsx` が登録 UI を担当する。

- Add source で draft を作成し、display name、description、endpoint URL、refresh interval、enabled state を編集できる。
- Save/Test の前に `normalizeCustomSourceSettings` で draft を検証する。
- Test はまず endpoint origin の optional host permission を要求し、許可されなければ「host access missing」で fetch しない。
- fetch は `GET`、`Accept: application/json`、`cache: no-store`、`credentials: omit`、redirect follow。raw body は JSON parse・normalize 後に破棄し、HTML は render/execute しない。
- HTTP error、timeout、network error、invalid JSON/schema、too large、unsafe text などは code/message として UI に出す。
- 既存の成功 snapshot がある状態で次回 fetch が失敗した時は、その snapshot を warning/stale にして表示し続ける。

保存は `src/background/message-bus.ts` 経由で local state に反映される。設定 export は endpoint URL と設定値を含むが、raw response、headers、API token、snapshot state は除外する。

根拠: `src/sidepanel/components/CustomSourceSettingsSection.tsx`, `src/background/custom-source-sync.ts`, `src/shared/custom-source-host-access.ts`, `src/background/message-bus.ts`, `src/shared/configuration-backup.ts`。

### できること / できないこと

| 観点 | できること | できないこと / 制約 |
|---|---|---|
| 任意 provider | ユーザー管理の JSON endpoint を追加し、quota/window/balance/fact として表示 | DOM の自動解析、HTML ページの表示、provider ごとの認証フローはない |
| 認証 | なし。host permission だけを明示要求 | Cookie、custom header、API token を設定・送信できない。`credentials: omit` 固定 |
| 安全性 | schema validation、本文上限、timeout、raw body 非保存 | endpoint はユーザーが信頼する必要があり、URL と正規化値は local storage/export に残る |
| 更新 | 手動更新、alarm と source ごとの interval、失敗時 cached snapshot | 429 専用 retry-after/指数 backoff は確認できない |
| 公式性 | Custom ラベルで built-in と分離 | endpoint の内容を verified provider として扱わない |

**推測/示唆**: many-ai-usage の「登録 URL → ページ内ヒューリスティック」は、custom JSON source より入力自由度が高い一方、認証済みページの読み取り・DOM の変化・誤検出を引き受ける。custom source の schema validation、safe text、raw body 非保存、source 別 stale state はそのまま設計原則として使える。

## 3. MV3 permissions 設計

**コードで確認**: `src/manifest.json` の固定 permissions は `alarms`、`favicon`、`sidePanel`、`storage`、`scripting`、`tabs`。host permissions は `optional_host_permissions` に置かれ、全 HTTP/HTTPS、Cursor、JetBrains、Anthropic/Claude、ChatGPT 等を含む。

`src/background/provider-permissions.ts` は provider ごとの `hostOrigins` を `chrome.permissions.contains/request/remove` で照合・変更し、状態を `granted` / `missing` として local state に保存する。`src/shared/custom-source-host-access.ts` は custom endpoint の `protocol://hostname/*` に絞って同じ仕組みを使う。

**コードで確認**: permissions API がない preview 環境では local state だけを更新する分岐がある。Firefox 側では `browser.permissions` に吸収する `src/shared/extension-api.ts` の抽象を使う。

**推測/示唆**: optional host access は store 審査で説明しやすいが、many-ai-usage が「ユーザーが登録した URL だけ」を読む場合は、manifest に全 provider origin を列挙する必要を避け、登録時に origin 単位で要求する方が最小権限である。

根拠: `src/manifest.json`, `src/background/provider-permissions.ts`, `src/shared/custom-source-host-access.ts`, `src/shared/extension-api.ts`, `src/background/message-bus.ts`。

## 4. Firefox 対応

**コードで確認**: Chrome build の `dist/chrome` を `scripts/build-firefox-package.mjs` がコピーし、manifest を変換する。

- `side_panel` と `version_name` を削除。
- `sidePanel` / `favicon` permission を削除。
- MV3 service worker を `background.scripts` に変換。
- `sidebar_action.default_panel` に sidepanel HTML を設定。
- `browser_specific_settings.gecko` に data collection `none`、固定 addon id、`strict_min_version: 142.0` を設定。

package scripts は `firefox:build`、`firefox:lint`、`firefox:lint:baseline`、`firefox:package`、`firefox:run` を提供する。lint baseline は `assets/usage-progress.js` の `innerHTML` warning 2件だけを既知扱いし、新しい warning/error/notice を失敗にする。

**README 記載**: Firefox は local beta build であり、通常配布には signed AMO/self-distribution package が将来必要。したがって「ビルド差分はあるが、配布完了ではない」と読むべきである。

根拠: `scripts/build-firefox-package.mjs`, `scripts/check-firefox-lint-baseline.mjs`, `package.json`, `README.md`。

## 5. UI 構成

**コードで確認 / README 記載**:

- toolbar popup: provider health、setup blocker、quota summary、remaining progress circle、sync status を短く提示。
- side panel: dashboard、provider detail、settings、source/credential/permission の設定面。
- full-page: sidepanel と同じ画面を extension tab として開くための route。
- toolbar badge/icon: selected provider/window の remaining を badge/title/icon に同期し、複数 selected source は rotation alarm で切り替える。
- provider card: usage windows と balances を provider ごとに並べ、normalized label、remaining、unit、reset label、warning/error を表示。

progress は popup の `featured-provider-card-view-models.ts`、sidepanel の `UsageProgress.tsx` / `UsageWindowProgressList.tsx`、共有 view model に分散する。多くの provider は 5-hour、weekly、billing period、credits など複数窓を持ち、最も制約の強い window を popup summary に使う。

**弱点/不満点（コードからの UX 推測）**:

1. 表示が provider/source contract に強く依存するため、同じ「残り」を見たいユーザーが source kind、credential、host access、page binding、diagnostic を理解する必要がある。
2. popup は compact summary、sidepanel/full-page は詳細という役割分担だが、初回 setup の概念が多く、単純な「URL を登録して見る」体験ではない。
3. personal page が開いていないと live sync できず、背景 tab を自動で開く場合もある。これはユーザーの期待する「いつでも最新」と異なる。
4. exact / partial / window-only / policy-only の境界を正直に表示する反面、数字がない provider は「No data」「policy only」になり、比較は利用者が補う必要がある。

根拠: `README.md`, `src/popup/PopupApp.tsx`, `src/popup/PopupFeaturedProviderList.tsx`, `src/popup/featured-provider-card-view-models.ts`, `src/sidepanel/routes/DashboardPage.tsx`, `src/sidepanel/routes/ProviderDetailPage.tsx`, `src/sidepanel/components/UsageProgress.tsx`, `src/background/action-badge.ts`, `src/background/action-icon.ts`。

## 6. 更新系 / cache / rate limit / session 切れ

### 更新と cache

**コードで確認**: `src/background/alarms.ts` が periodic alarm を作り、minimum interval は 3 分、初回 delay に最大2分の jitter を入れる。`src/background/sync-engine.ts` は provider 同期を最大2並列で実行し、同一 trigger の全 provider 実行を coalesce する。custom source は各 source の interval（3〜1440分）を見て refresh する。

provider snapshot は `chrome.storage` に保存される。成功値は次回まで表示し続け、失敗時は既存 snapshot を stale/warning 化する。通常の provider は `syncIntervalMinutes * 2` かつ最低60分を超えると `cached_state_stale` / `automatic_sync_overdue` を表示する。custom source も失敗時に cached snapshot を残す。

根拠: `src/background/alarms.ts`, `src/background/sync-engine.ts`, `src/background/custom-source-sync.ts`, `src/shared/settings-preferences.ts`, `src/shared/storage.ts`, `src/providers/types.ts`。

### retry と session 切れ

**コードで確認**:

- API client の一般 HTTP failure は status を Error 化する。
- page-session は load/capture failure、hydration、route drift を対象に reload/retry する。
- Cursor/Claude/Codex の personal page client は `open_page_required` 等に限定した hydration retry を持つ。
- page match が logged-out なら、UI に usage page を開いて再ログイン・再試行する導線を出す。page binding は tab close / URL change で stale になる。
- credentials は settings に保存され、provider ごとに missing/configured を state に反映する。

**コードで確認できない / 注意**: `src` で `429`、`Retry-After`、provider 共通の指数 backoff を検索したが、HTTP 429 専用の制御は確認できない。確認できる retry は page hydration/reload が中心で、API の rate limit 対策ではない。これは many-ai-usage の実装時に別途設計すべきである。

根拠: `src/providers/page-session.ts`, `src/providers/page-session-tab-lifecycle.ts`, `src/providers/cursor/personal-page-client.ts`, `src/providers/claude-code/personal-page-client.ts`, `src/providers/codex/personal-page-client.ts`, `src/shared/settings-core-localized-copy.ts`, `src/background/provider-credentials.ts`。

## 7. 弱点・many-ai-usage が勝てる余地

### 事実から見える制約

- provider ごとに route、label、source availability、API credential、parser の知識を実装・維持している。
- page-session は「見つかる既知の usage route」を読む仕組みで、未知サイトの自動意味理解ではない。
- API を使えない個人 provider は、該当ページを開いておく・host access を許可する・reload/hydration を待つ、という前提がある。
- custom source は任意 provider の追加を可能にするが、JSON endpoint を自分で用意できるユーザーに限られ、一般の usage page は対象外。
- Firefox は build/manifest 変換まであり、README 上は配布準備が未完。

### many-ai-usage の差別化（推測/示唆）

1. 既知 provider の hard-coded parser を増やさず、登録 URL を第一級データにする。
2. 自動解析の confidence と「何を根拠に拾ったか」を UI に出し、誤検出時だけ要素クリックで補正できるようにする。
3. exact / inferred / user-taught / stale を同じ card 上で区別し、数値の出所を隠さない。
4. provider ごとの setup 状態を「URL / host access / session / parse result」の4チェックに圧縮する。
5. 公式 API がある provider だけを優遇せず、DOM の見えている情報を同じ正規化モデルに入れる。
6. 自動更新に失敗した場合は、最後の成功値・取得時刻・次回試行・再取得方法を明示する。数値だけを残すと、AI_Usage_Dashboard の stale snapshot と同じ不安が出る。

## 出典一覧

主な出典は以下。レポート中の各節にも対応ファイルを記載している。

- `C:\dev\github\study\AI_Usage_Dashboard\README.md`
- `C:\dev\github\study\AI_Usage_Dashboard\src\manifest.json`
- `C:\dev\github\study\AI_Usage_Dashboard\src\providers\page-session.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\providers\codex\official.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\providers\cursor\official.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\providers\claude-code\official.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\shared\custom-sources.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\background\custom-source-sync.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\src\background\sync-engine.ts`
- `C:\dev\github\study\AI_Usage_Dashboard\scripts\build-firefox-package.mjs`

