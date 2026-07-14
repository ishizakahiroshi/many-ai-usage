# 参考 OSS 調査: openusage

調査日: 2026-07-12

対象: `C:\dev\github\study\openusage`

ライセンス: MIT（`LICENSE`）。many-ai-usage への実装転用ではなく、正規化モデル・更新・エラー表示・情報設計の考え方だけを参考にする。

## 読み方

- **コードで確認**: 実装から直接確認できた事実。
- **Docs 記載**: `docs/` に書かれた provider 契約・挙動。コードの全細部まで追跡していない場合がある。
- **推測/示唆**: many-ai-usage に移す際の解釈。

## 先に訂正: 外部プラグイン配布型ではない

計画書では openusage を「全 provider がプラグイン駆動」と位置づけているが、今回のソース確認では、**外部から recipe/plugin をロードして配布・更新する仕組みは確認できなかった**。

**コードで確認**:

- 各 provider は `Sources/OpenUsage/Providers/<Name>/` の Swift module。
- `ProviderRuntime` が `provider`、`widgetDescriptors`、`refresh()`、`hasLocalCredentials()` を要求する。
- `AppContainer.swift` が `ClaudeProvider()`、`CodexProvider()`、`CursorProvider()`、`AntigravityProvider()`、`CopilotProvider()`、`DevinProvider()`、`GrokProvider()`、`OpenRouterProvider()`、`ZAIProvider()` をハードコードで登録する。
- `WidgetRegistry.from(_:)` が provider と descriptor を静的に集約する。
- 新規 provider の追加手順は「module を作る → `AppContainer` に register → test → docs」を要求する。

根拠: `Sources/OpenUsage/Providers/ProviderRuntime.swift`, `Sources/OpenUsage/App/AppContainer.swift`, `Sources/OpenUsage/Stores/WidgetRegistry.swift`, `docs/architecture.md`, `docs/adding-a-provider.md`。

したがって、openusage から学ぶべき「プラグイン思想」は、実際には **provider adapter を共通契約に閉じ込め、UI を provider-specific knowledge から分離する設計思想**である。many-ai-usage はこれを compile-time module ではなく、ユーザー登録 recipe / DOM parser schema に置き換える余地がある。

## 1. Provider contract と正規化モデル

### provider の構成

`docs/architecture.md` と `docs/adding-a-provider.md` は provider を3層に分ける。

1. **Auth store**: 既に Mac にある credential（file、Keychain、SQLite、environment、companion app/CLI state）を読む。
2. **Usage client**: provider API や local source を呼ぶ。
3. **Mapper**: provider response を `ProviderSnapshot` と `MetricLine` に変換する。

`hasLocalCredentials()` は network を発生させない安価な probe であり、初回起動・新規 provider 登場時の enabled 判定に使う。blocking な `security` / `sqlite3` CLI 読み取りは `loadOffMainActor` で main actor を塞がない。

根拠: `Sources/OpenUsage/Providers/ProviderRuntime.swift`, `Sources/OpenUsage/App/FirstRunSeeder.swift`, `Sources/OpenUsage/App/NewProviderSeeder.swift`, `docs/adding-a-provider.md`。

### 共通データ型

`ProviderSnapshot` は provider ID、display name、plan、`lines`、`refreshedAt`、soft warning、error category を持つ。`MetricLine` の主な variant は次の通り。

| 型 | 使いどころ | many-ai-usage への含意 |
|---|---|---|
| `progress(used, limit, format, resetsAt, periodDurationMs)` | session/weekly quota、credits、bounded dollars/count | `used/remaining/total/reset` を型で保持し、表示文字列を parser が再解釈しない |
| `values([MetricValue])` | spend、tokens、balance、credits のような unbounded 数値 | 1 row に cost と tokens を同居させ、UI が表示項目を選択できる |
| `badge(text)` | Disabled、pay-as-you-go cap、状態 | 状態を数値 meter と混同しない |
| `chart(points)` | 日次 trend | 時系列を単独の optional payload にする |
| `text(value)` | local API に残す provider notice | dashboard の numeric widget は text を parse しない |

`MetricValue` は `number`、`kind`、unit label、`estimated` を持つ。`estimated` を値ごとに持つため、token は measured、dollar は local estimate のような混在を明示できる。

根拠: `Sources/OpenUsage/Models/ProviderSnapshot.swift`, `Sources/OpenUsage/Models/MetricLine.swift`, `Sources/OpenUsage/Models/MetricValue.swift`, `Sources/OpenUsage/Models/WidgetData.swift`, `Sources/OpenUsage/Models/WidgetDescriptor+Factories.swift`。

### provider 別の取得方式一覧

以下は `docs/providers/*.md` と対応する `Sources/OpenUsage/Providers/` の client/auth/mapper を突き合わせた整理である。API endpoint は provider 側の undocumented/internal API を含むため、将来変更前提で読む。

| Provider | credential の出所 | API / local source | 主な正規化対象 |
|---|---|---|---|
| Claude | macOS Keychain、`~/.claude/.credentials.json` / `CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_OAUTH_TOKEN` | `GET https://api.anthropic.com/api/oauth/usage`。spend は `~/.claude/projects/` と Cowork の local logs | 5h session、weekly、Sonnet/Fable、extra usage、日次 cost/tokens。dollar は pricing による estimate |
| Codex | Codex CLI auth file（`CODEX_HOME`）、Keychain fallback | `GET https://chatgpt.com/backend-api/wham/usage`、reset credits endpoint。spend は `sessions/` / `archived_sessions/` | session/weekly、Spark、reset credits、flex credits、日次 cost/tokens |
| Cursor | Cursor local state DB、Keychain | Connect RPC `api2.cursor.sh`、REST `cursor.com/api/usage`、Stripe balance、usage-events CSV export | credits、billing period、requests、auto/API、extra usage、日次/trend cost/tokens |
| Copilot | `~/.config/github-copilot/apps.json`、`gh/hosts.yml`、GitHub CLI Keychain | `GET https://api.github.com/copilot_internal/user`。org managed seat は `/user/orgs` と org billing summary | personal credits、extra、org credits/spend、chat/completions。org 値は user 個人ではなく org-wide |
| Grok | `~/.grok/auth.json` / `GROK_HOME` | billing `cli-chat-proxy.grok.com/v1/billing?format=credits`、settings、token refresh `auth.x.ai`。spend は `logs/unified.jsonl` | weekly pool、extra cap、日次 cost/tokens |
| Devin | `~/.local/share/devin/credentials.toml`、Devin app state DB | Connect RPC `GetUserStatus`、configured server（default `server.codeium.com`） | weekly/daily quota、extra balance。API の remaining を used に反転 |
| Antigravity | local language server の CSRF/port、または Antigravity/`agy` Keychain OAuth | language server の `RetrieveUserQuotaSummary` / legacy status、または Cloud Code `v1internal:retrieveUserQuotaSummary` 等 | Gemini pool と non-Gemini pool の 5h/weekly、plan。Keychain refresh token と短期 access-token cache の account binding がある |
| OpenRouter | `~/.config/openusage/openrouter.json`、`~/.config/openrouter/key.json`、`OPENROUTER_API_KEY`、Settings で保存した key | Bearer API の `/api/v1/credits` と `/api/v1/key` | credits、balance、日/週/月 spend、optional key limit |
| Z.ai | `~/.config/openusage/zai.json`、`~/.config/zai/key.json`、`ZAI_API_KEY` / `GLM_API_KEY` | `GET https://api.z.ai/api/biz/subscription/list` と `GET https://api.z.ai/api/monitor/usage/quota/limit` | 5h token、weekly token、monthly web-search count |

根拠: `docs/providers/claude.md`, `codex.md`, `cursor.md`, `copilot.md`, `grok.md`, `devin.md`, `antigravity.md`, `openrouter.md`, `zai.md`; 対応する `Sources/OpenUsage/Providers/*AuthStore.swift`, `*UsageClient.swift`, `*UsageMapper.swift`。

## 2. ブラウザ拡張へ移植可能 / 不可能の仕分け

| 方式 | ブラウザ拡張への判定 | 理由 / many-ai-usage での扱い |
|---|---|---|
| 公開 HTTPS API + ユーザーが明示的に入力した API key | 条件付きで可能 | host permission、CORS、key の local storage、store disclosure が必要。many-ai-usage の主方式にはせず、将来の optional JSON source/公式 API mode として隔離 |
| ログイン済み provider の web usage page を DOM 読み取り | 可能 | `tabs` / content script / scripting と optional host access で可能。many-ai-usage の自動解析・ユーザー補正の中心候補 |
| ブラウザ cookie を provider API の認証に使う | 技術的には可能だが、現方針では避ける | cookie permission、審査、アカウント境界、provider の session 変更に依存。openusage 自身も Copilot について web billing page/cookie を使わないと説明している |
| macOS Keychain | 不可能（通常の拡張） | browser extension API から Keychain を読めない。Native Messaging helper が必要になり、サーバーなし・ブラウザ内完結のスコープから外れる |
| macOS SQLite / companion app state DB | 不可能（通常の拡張） | filesystem access がない。Native Messaging か companion app が必要 |
| CLI の local JSONL/session logs | 不可能（通常の拡張） | `~/.claude/projects`、`~/.codex/sessions` 等は browser から見えない。many-ai-usage はページで表示された値を読む方が境界に合う |
| local language server / process discovery | 不可能（通常の拡張） | process/port/CSRF の発見と local IPC は native app 前提 |
| environment variable / login shell | 不可能（通常の拡張） | browser はユーザーの shell environment を取得できない |
| API mapper / typed normalization | 可能 | UI に依存しない純粋な正規化層として移植しやすい。many-ai-usage の `NormalizedMetric` の設計根拠にする |
| desktop menu bar / `NSPanel` / hover popover | 不可能（そのまま） | ただし情報密度、expand/collapse、tooltip、quick link、badge という UI パターンは popup/side panel に翻訳できる |

**結論**: openusage の provider fetcher そのものを browser に持ち込むのではなく、(a) 認証済みページからローカルに取得する、(b) provider 固有値を共通 metric に落とす、(c) source failure を stale-while-revalidate で表示する、という3つの層だけを移植対象にする。

## 3. 更新系・cache・エラー処理

### 更新

**コードで確認 / Docs 記載**:

- 起動時に refresh、その後は固定5分 cadence。
- enabled providers は同一 pass で refresh し、provider fetch は並列。
- provider を enable した時は次の5分を待たず即 refresh。
- `RefreshWakeSignal` が enablement change を `AsyncStream` に buffer し、refresh 中に発生した wake を取りこぼさない。
- popover を開くだけでは追加の自動 refresh を起こさない。footer の countdown/⌘R で force refresh できる。

根拠: `docs/refreshing.md`, `Sources/OpenUsage/App/AppContainer.swift`, `Sources/OpenUsage/App/RefreshWakeSignal.swift`, `Sources/OpenUsage/Stores/RefreshSetting.swift`。

### cache / stale-while-revalidate

`ProviderSnapshotCache` は `UserDefaults` に snapshot blob を保存する。起動時は期限切れでも前回値をすぐ表示し、同じ session で書き込まれた値だけを TTL（5分）の fresh 判定に使う。したがって、起動直後は旧値を見せながら再 fetch し、失敗しても旧値は消えない。

失敗時は error snapshot を cache に書かず、`WidgetDataStore` が `providerErrors` を持ちながら last good snapshot を表示する。refresh failure が続き snapshot の年齢が refresh interval の2倍（通常約10分）を超えると `Outdated` タグと正確な age tooltip を出す。

根拠: `Sources/OpenUsage/Stores/ProviderSnapshotCache.swift`, `Sources/OpenUsage/Stores/WidgetDataStore.swift`, `docs/refreshing.md`。

### retry / rate limit / 認証エラー

`ProviderAuthRetry` は OAuth provider 共通の「試行 → 401/403 の時だけ token refresh → 1回 retry → なお 401/403 なら auth failure」シーケンスを持つ。429 と 5xx はこの共通処理では retry せず、provider mapper に返す。`ErrorCategory` は 429 を `rateLimited`、4xx/5xx を別 bucket にする。

Docs 上、Claude の throttling は last values を維持して retry timing を示し、backoff する。`WidgetDataStore` 側にも provider failure 用 60 秒 negative cache/backoff があり、wake burst による同じ provider の連続 probe を抑える。手動 force refresh は backoff を bypass する。

**推測/示唆**: provider-specific な 429 response の意味を UI に漏らさず、共通層は「rate limited / next retry」、provider adapter は `Retry-After` や response body の解釈、という責務分離が適切である。

根拠: `Sources/OpenUsage/Providers/ProviderAuthRetry.swift`, `Sources/OpenUsage/Providers/ErrorCategory.swift`, `Sources/OpenUsage/Stores/WidgetDataStore.swift`, `docs/providers/claude.md`。

## 4. UI / 情報密度

### メニューバー常駐 UI

**コードで確認 / Docs 記載**: `NSStatusItem` と key-capable `NSPanel` を AppKit bridge が持ち、SwiftUI の dashboard を panel に載せる。popover では keyboard focus が不安定という判断から、non-activating `NSPanel` を使う。

UI の情報構造は次の通り。

- provider section の header: icon、provider name、plan、refreshing spinner、warning triangle、Outdated tag。
- Always Visible / On Demand: provider card の caret で詳細 metric を折りたたむ。
- row: bounded meter（used/left、fill、reset、pace）、unbounded numeric row、badge、chart。
- hover: reset absolute/relative の切替、pace projection、model breakdown、unknown model、estimated dollar note。
- quick links: provider の Status/Dashboard/API Keys 等を最大2件。
- menu bar strip: Customize で star した metric を表示。provider あたり最大2 stars、Bars/Text style。
- Total Spend: Claude/Codex/Cursor/Grok の local spend を Cost / Cost per MTok / Tokens で cross-provider 集計。

根拠: `docs/architecture.md`, `docs/menu-bar.md`, `docs/dashboard.md`, `Sources/OpenUsage/App/StatusItemController.swift`, `Sources/OpenUsage/Views/WidgetGroupedListView.swift`, `Sources/OpenUsage/Views/WidgetRowView.swift`, `Sources/OpenUsage/Views/ProviderSectionHeader.swift`, `Sources/OpenUsage/Views/TotalSpendCard.swift`。

### ブラウザ拡張への翻訳

| openusage のパターン | many-ai-usage での翻訳 |
|---|---|
| menu bar strip | toolbar badge + popup summary |
| NSPanel dashboard | side panel / full-page extension tab |
| provider card + caret | provider tile の Always Visible / details |
| hover tooltip | accessible details button / title / expanded diagnostic |
| quick links | usage page を開く / source URL を開く |
| star metric | badge candidate / popup pin |
| `No data` | 未解析・未取得・対象外を区別した empty state |
| Outdated | stale tag + last success + next retry |

## 5. 弱点・many-ai-usage の改善余地

### openusage 自体の制約

1. **外部 plugin ではない**: provider を増やすにはアプリの compile/register/release が必要。provider knowledge の maintainer 集中が残る。
2. **macOS 専用**: Keychain、SQLite、process、CLI logs、NSPanel に依存し、browser/Firefox に直接移せない。
3. **reverse-engineered endpoint 依存**: undocumented internal API、Connect RPC、local DB schema、CSV export の変更で壊れうる。
4. **固定 cadence**: 5分間隔は理解しやすいが、ユーザーが provider ごとに重要度・rate limit・quota window を調整できない。
5. **数値の意味が混在**: measured quota、org-wide usage、local estimated dollars、provider-side stale credits が同じ dashboard に並ぶ。disclaimer はあるが、ユーザーが比較軸を自分で理解する必要がある。
6. **認証状態の複雑さ**: 複数 credential source の優先順位、token rotation、account-bound cache、Keychain unlock をユーザーが把握しづらい。

根拠: `docs/architecture.md`, `docs/adding-a-provider.md`, `docs/providers/*.md`, `Sources/OpenUsage/Providers/*AuthStore.swift`, `Sources/OpenUsage/Providers/ProviderAuthRetry.swift`。

### many-ai-usage が UX で勝てる要件

- provider を追加するためにアプリの release を待たず、URL 登録だけで開始できる。
- 自動解析の confidence と evidence（例: `%`、`progress`、`reset` の近傍）を表示する。
- 解析できない場合は「未解析」「認証ページ」「ページ未ロード」「値が見つからない」を分け、単なる `No data` にしない。
- user-taught selector は selector 単独でなく、label/context/relative position/role を保存し、SPA rerender に対応する再発見 strategy を持つ。
- 1 provider につき 5h/weekly/monthly など複数 metric を保持し、表示時に `window`・unit・confidence・source を必ず併記する。
- estimated / inferred / exact / cached を数値の隣に出し、local estimate を measured balance と同じ色・文言で扱わない。
- 自動更新は「last successful capture」「age」「next attempt」「ページを開いて再取得」の4点を一つの状態にまとめる。
- 初回設定は URL → host access → ログイン済み確認 → 自動解析 → 必要時だけ教える、の wizard にする。

## 出典一覧

- `C:\dev\github\study\openusage\docs\architecture.md`
- `C:\dev\github\study\openusage\docs\adding-a-provider.md`
- `C:\dev\github\study\openusage\docs\refreshing.md`
- `C:\dev\github\study\openusage\docs\dashboard.md`
- `C:\dev\github\study\openusage\docs\menu-bar.md`
- `C:\dev\github\study\openusage\docs\providers\claude.md`
- `C:\dev\github\study\openusage\docs\providers\codex.md`
- `C:\dev\github\study\openusage\docs\providers\cursor.md`
- `C:\dev\github\study\openusage\docs\providers\copilot.md`
- `C:\dev\github\study\openusage\docs\providers\grok.md`
- `C:\dev\github\study\openusage\docs\providers\devin.md`
- `C:\dev\github\study\openusage\docs\providers\antigravity.md`
- `C:\dev\github\study\openusage\docs\providers\openrouter.md`
- `C:\dev\github\study\openusage\docs\providers\zai.md`
- `C:\dev\github\study\openusage\Sources\OpenUsage\Providers\ProviderRuntime.swift`
- `C:\dev\github\study\openusage\Sources\OpenUsage\Models\MetricLine.swift`
- `C:\dev\github\study\openusage\Sources\OpenUsage\Models\MetricValue.swift`
- `C:\dev\github\study\openusage\Sources\OpenUsage\Stores\ProviderSnapshotCache.swift`
- `C:\dev\github\study\openusage\Sources\OpenUsage\Stores\WidgetDataStore.swift`

