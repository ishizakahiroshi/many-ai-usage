# 参考 OSS 調査の統合: many-ai-usage への設計示唆

調査日: 2026-07-12

入力レポート:

- `docs/local/reference_study-ai-usage-dashboard.md`
- `docs/local/reference_study-openusage.md`

この文書は上記2本の統合であり、新規の外部調査は行っていない。以下の「案」は many-ai-usage の次タスクで設計に流し込むための叩き台である。

## 1. 自動解析 + 教える型の実現性

### 判断

**実現性は高い。ただし、完全自動ではなく「候補抽出 → 根拠付き採用 → 必要時だけ教える」の段階的設計にする。**

AI_Usage_Dashboard は既知 provider の page route と parser を運営側が持ち、openusage は provider ごとの API client/mapper を compile-time に持つ。many-ai-usage はこの provider knowledge を持たない代わりに、usage page の可視情報を共通ヒューリスティックで拾う。対象範囲を「ページに人間が見て理解できる usage 情報」に置けば、provider の追加・変更を運営側が追い続ける負担を減らせる。

### 強み

- provider ごとの API endpoint、token format、ローカル credential の知識を同梱しない。
- 読み取り対象はユーザーが登録した URL だけで、ページ HTML を外部 AI や自前サーバーへ送らずに済む。
- AI サービス側が公式 API を提供しない場合も、ログイン済み browser session の画面を使える。
- 自動解析で取れない provider だけ user-taught に落とせるため、運営側の parser メンテを限定できる。
- 最終的に tile/embed を残すことで、数値抽出に失敗しても「登録したページを一つの場所で見る」という価値を失わない。

### 弱み・急所

| 急所 | 起きること | 設計案 |
|---|---|---|
| SPA / React の再レンダリング | 初回 selector が消える、数値だけ差し替わる、route が hash/history で変わる | `MutationObserver` と短い hydration wait、複数回の安定化判定、anchor の再探索。固定 CSS selector だけを正本にしない |
| 背景 tab の throttling | 非アクティブ tab の timer/render が遅く、空の skeleton を読む | `document.readyState` だけで成功扱いにせず、usage evidence が現れるまで段階 retry。上限時間を設けて stale として返す |
| 数値の誤検出 | navigation、料金、日付、広告の `%` を usage と誤認 | label 近傍、role/aria、`progress`/`meter`、unit、reset 近傍、数値の一貫性を evidence としてスコア化。低 confidence は自動採用しない |
| `%` 以外の表記ゆれ | `90 / 100`、`1,200 requests`、`$12.50 remaining`、`90% left`、日中英の混在 | 数値の意味を `used/remaining/total` に直ちに決めず、unit/window/label と一緒に候補化。`remaining` と `used` の語がない場合は percent と断定しない |
| reset 時刻 | `Resets in 5h`、`Renews tomorrow`、絶対日時、locale/timezone が混在 | `resetAt` と `resetLabel` を別に保持。解析できた絶対時刻だけ countdown に変換し、相対文字列しかない場合は原文を残す |
| iframe / shadow DOM | 数値が別 frame や shadow root 内にあり、通常の DOM walk で取れない | 初期版は top document と open shadow root のみ。cross-origin iframe は対象外または「ページ表示型」に落とす |
| user-taught selector | class 名や DOM path が provider 更新で壊れる | selector 候補、role、label、近傍テキスト、tag、value pattern の複数 fingerprint を保存し、再探索できなければ `taught_anchor_stale` にする |

### 自動解析の最小 pipeline 案

1. 登録 URL の host access を要求し、ユーザーが許可した tab だけを対象にする。
2. top document の text、`aria-*`、`progress`/`meter`、visible input/value、open shadow root をローカル取得する。raw HTML は保存しない。
3. 候補を作る。
   - `%` / `percent` / `remaining` / `left` / `used` と近傍の数値。
   - `HTMLProgressElement`、`role=progressbar`、`aria-valuenow/min/max`。
   - `used / total`、`remaining / total`、currency/count と unit。
   - `reset` / `renews` / `next window` / 日英中の相当語と近傍日時。
4. label、unit、window、reset、value、evidence、confidence を含む候補をスコア化する。
5. 閾値以上なら snapshot に採用し、閾値未満なら「候補あり・要確認」として user-taught UI を提案する。
6. user-taught でユーザーが数値要素・label 要素・reset 要素をクリックし、候補を修正/削除する。
7. 解析不能なら同じ card の中で「ページを開く」「もう一度解析」「そのまま表示」を提示する。

## 2. 自動更新機構の検討

| 候補 | 技術的実現性 | UX / store リスク | 判定 |
|---|---|---|---|
| 非アクティブ tab を開いて取得 | Chrome/Firefox の tabs+scripting で実現可能。ログイン済み session を使える | background tab throttling、画面を勝手に開く印象、provider の bot/automation 判定、頻繁な reload が負荷になる | **明示 opt-in の補助経路**。既存の user-bound tab を第一にし、interval・retry・concurrency を厳しく制限 |
| 拡張ページ内 iframe + header 加工 | 一部ページは埋め込み可能 | `X-Frame-Options`/CSP、third-party cookie、SAMEORIGIN、auth session、remote page の content を拡張が扱う説明責任。任意ページを proxy/加工する設計は store 審査リスクが高い | **採用しない**。最終 fallback は表示型でも、provider が許す embed のみ |
| ユーザー訪問時 capture | content script/active tab で最も自然。ユーザーが見た DOM は hydration 済みである確率が高い | ページを開いていない時間は更新されない | **既定経路**。訪問時に保存し、popup に「最終取得時刻」を出す |
| ユーザー操作による手動 capture | 失敗時の再現性が高い | 自動更新の利便性は低い | **常設 fallback**。「このページを今すぐ再読取」を提供 |

**推奨順**: user visit / bound active tab → 明示 opt-in の non-active tab capture → page tile/embed。完全バックグラウンド自動更新を v1 の保証にしない。どの経路でも provider への write API、form submit、navigation 操作は行わず、読み取りだけに限定する。

## 3. レシピ / provider 登録スキーマ案

ユーザーが登録するものと、拡張が計算する runtime state を分離する。登録データに raw page body、cookie、token、response body は含めない。

```json
{
  "schema": "many-ai-usage.provider.v1",
  "id": "custom:example-ai",
  "displayName": "Example AI",
  "url": "https://example.com/account/usage",
  "urlMatch": ["https://example.com/account/usage*"],
  "mode": "auto",
  "displayEnabled": true,
  "refreshIntervalMinutes": 15,
  "metrics": [],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

`mode` は次の3値とする。

- `auto`: ヒューリスティック解析を第一に使う。
- `taught`: ユーザーが登録した element anchor を第一に使い、自動解析は再発見補助にする。
- `embed`: 数値化せず、ユーザーが登録した page を表示型 tile として扱う（embed 不許可なら「ページを開く」リンクにする）。

`metrics` は user-taught 後に追加される。案:

```json
{
  "metricId": "weekly",
  "label": "Weekly quota",
  "kind": "percent",
  "unit": "percent",
  "windowLabel": "weekly",
  "valueAnchor": {
    "selectors": ["[aria-label*=Weekly]", "[role=progressbar]"],
    "tagName": "DIV",
    "role": "progressbar",
    "textFingerprint": "70% remaining",
    "nearbyLabel": "Weekly quota"
  },
  "resetAnchor": {
    "selectors": ["..."],
    "textFingerprint": "Resets tomorrow"
  },
  "interpretation": "remaining_percent",
  "enabled": true
}
```

実装上の注意:

- `selectors` は候補順であり、単独の CSS path を正本にしない。
- `textFingerprint` は実値を保存せず、label/shape/locale pattern と短い非機密テキストだけを保存する。アカウント名・メール・ID は除去する。
- `interpretation` は `used_percent`、`remaining_percent`、`used_total`、`remaining_total`、`absolute_value`、`reset_only` のように明示する。曖昧な自動候補には `unknown` を許す。
- 1 provider に複数 metric を持たせ、5h・weekly・monthly・credit balance を混ぜてもそれぞれの unit/window を保持する。
- `refreshIntervalMinutes` は既定15、最小3、最大240程度から始め、provider/host ごとの同時実行を制限する。

runtime state は別 schema にする。

```text
ProviderRuntimeState
  lastAttemptAt
  lastSuccessAt
  lastFailureAt
  status: never_seen | ok | warning | error | stale | needs_teaching
  stale: boolean
  confidence: none | heuristic | taught
  evidenceSummary: string[]
  retryAfter: timestamp | null
  pageBinding: unbound | bound | stale
```

## 4. usage の共通正規化モデル案

```text
NormalizedSnapshot
  providerId
  displayName
  capturedAt
  source: dom | user_taught | page_only
  status: ok | warning | error | no_data
  metrics: NormalizedMetric[]
  warningReason
  lastFailureReason

NormalizedMetric
  id
  label
  kind: percent | amount | count | status
  unit: percent | requests | credits | tokens | dollars | sessions | custom
  window: { id, label, durationMs? }
  used: number | null
  remaining: number | null
  total: number | null
  resetAt: ISO timestamp | null
  resetLabel: original human-readable text | null
  confidence: heuristic | taught
  evidence: { value, label, reset, semanticSignals[] }
```

### invariant

- percent metric は `total=100` を標準とする。ただしページが `used` か `remaining` か明示している時だけ相互変換する。
- `used + remaining = total` を自動補正の根拠にしない。丸め、複数窓、独立 metric があるため、矛盾は warning として残す。
- count/amount は total がない unbounded balance を許す。`remaining` だけの credit balance と `used/total` の quota を同じ `kind` でも表現できる。
- reset は exact timestamp と display label を分離する。`Resets tomorrow` しか取れない場合、`resetAt=null` のまま label を表示する。
- confidence/source/capturedAt/stale を値の横に出し、`used=70` だけを UI の正体にしない。
- provider や metric の名称に依存した「一番少ない値」選択は共通層で行わず、popup summary だけが lowest remaining を選ぶ。複数窓を隠さない。

このモデルは openusage の `MetricLine.progress` / `values` / `badge` と、AI_Usage_Dashboard の custom JSON `quota` / `windows` / `balances` / `facts` を合わせたもの。ただし many-ai-usage では page parser の confidence と evidence を追加する。

## 5. 避けるべき落とし穴

### 取得・認証

- 429 に対して固定 interval で無限 retry しない。`Retry-After` を解釈できる時だけ延期し、できない時は指数 backoff + jitter。
- API 側の 401/403 と、ページ側の logged-out/permission missing、host access denied を別状態にする。
- 認証情報、Cookie、authorization header、ページ本文、実アカウント ID/メールを送信・保存・fixture 化しない。
- endpoint/DOM 取得は GET/read-only。usage の書き換え、form submit、chat、設定変更をしない。

### DOM / SPA

- `document.readyState=complete` を描画完了とみなさない。
- class 名、DOM depth、innerText の全文一致だけに依存しない。
- shadow DOM、cross-origin iframe、virtualized list、locale、RTL、日付 timezone を想定する。
- `0%`、`100%`、料金表の `%`、広告の「off」などの false positive をテストする。
- ページが表示する「使用量」と「残量」を取り違えない。label と aria semantics を先に読む。

### 拡張機能 / store

- `scripting`、`tabs`、host permission は用途と対象 origin を画面で説明し、登録 URL 単位で optional request する。
- 任意の remote code を読み込まない。ページから取得した文字列を `innerHTML` や script として実行しない。
- iframe/proxy で第三者ページを常時加工する設計は、CSP/cookie/審査の複合リスクが高い。
- 非アクティブ tab の自動 reload を既定にせず、ユーザーの明示選択・頻度制限・停止スイッチを用意する。
- raw HTML は diagnostics に残さず、fixture は合成データだけにする。

### state / UX

- 失敗時に数字を消すだけでも、古い数字を成功値のように残すだけでも不親切。last success、age、stale、next retry を同時に表示する。
- refresh storm を防ぐため、全体 concurrency、source ごとの interval、in-flight coalescing、failure backoff を持つ。
- selector が壊れた時に silently zero を表示しない。`needs_teaching` にする。
- exact、heuristic、taught、page-only、policy-only を同じ色/同じ文言で表さない。

## 6. UX で勝つポイント

1. **URL を登録してすぐ試せる**: 最初の画面は URL、表示名、更新間隔だけ。host permission は登録後に理由付きで要求する。
2. **解析根拠を見せる**: 「Weekly quota の `70% remaining` を検出」「reset label は未解析」のように、数字の出所を説明する。
3. **教える操作を軽くする**: 「この数字」「このラベル」「この reset」をクリックして metric を完成。不要な候補はワンクリックで削除。
4. **失敗を修理可能にする**: `ページ未ログイン`、`ページ未表示`、`host access 未許可`、`selector stale`、`rate limited` を修復ボタン付きで出す。
5. **複数 window を隠さない**: 5h/weekly/monthly を折りたたみ可能にし、summary は最も制約の強い metric とその window を明記する。
6. **古い値に正直である**: card に `Last captured 12m ago`、`stale`、`next attempt` を出し、更新不能でも判断材料を残す。
7. **プライバシーを UI で確認できる**: 「ページ本文は外部送信しない」「Cookie/token は保存しない」「読み取りのみ」を Settings と初回登録に表示する。
8. **最終 fallback を価値にする**: 自動解析できないサイトは空の error card にせず、ユーザーが開ける page tile/link として残す。
9. **アクセスしやすい表示**: 色だけで status を表さず、percent/amount/unit/reset/source/confidence をテキストでも提示する。
10. **運営側の勝ち筋を守る**: provider-specific parser の追加を成功条件にせず、汎用 detector・user-taught anchor・safe normalization・stale UX の改善を主戦場にする。

## 次タスクにそのまま渡す設計決定

| 決定 | v1 方針 |
|---|---|
| provider knowledge | Claude/Codex はサンプル登録のみ。built-in parser は持たない |
| 第一取得 | user visit / bound tab のローカル DOM heuristic |
| fallback | user-taught anchor、その次に page-only tile/link |
| background refresh | 既定保証にせず、明示 opt-in の non-active tab capture として検証 |
| iframe | 任意ページの常時 embed/proxy はしない。provider が許す場合だけ page-only |
| auth | browser の既存 session を読むだけ。Cookie/token を表示・外部送信・保存しない |
| storage | 登録設定、normalized snapshot、anchor fingerprint、diagnostic summary のみ。raw HTML は保存しない |
| normalized value | used/remaining/total/unit/window/reset/confidence/source/capturedAt を共通化 |
| error | logged-out / permission / not-rendered / parse-failed / stale / rate-limited を別状態にする |
| refresh safety | concurrency、coalescing、minimum interval、backoff、stale-while-revalidate |

