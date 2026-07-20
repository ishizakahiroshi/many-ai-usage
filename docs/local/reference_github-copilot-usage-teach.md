---
type: reference
status: watching
tags: [github-copilot, billing, teach-mode, dogfood, starter-pack]
owner: ishizakahiroshi
related:
  - resources/starter.json
  - docs/local/reference_opencode-go-personal-workspace-url.md
  - docs/local/plan_starter-pack-import.md
last_reviewed: 2026-07-19
docsweep_policy: archive_with_release
---

# [参考] GitHub Copilot — usage ページが teach しづらい理由

作成日: 2026-07-19

調査トリガ: dogfood popup で GitHub Copilot だけ数値が `—`、ラベルがページ見出しっぽい  
（例: `Overview` / `Current metered usageGross m...`）。OpenCode Go は 0% 表示まで到達。

## 1. popup で見えている症状（観察）

| 項目 | 内容 |
|------|------|
| 表示 | バー無し、値 `—` |
| ラベル | `Overview`、`Current metered usage…` のように **セクション見出し** |
| 解釈 | **chrome（見出し）を teach した** — 2026-07-19 実ページで **確定** |
| starter 側 | `sample:copilot` は **URL タイルのみ**（`mode: auto`, `metrics: []`）。taught 失敗は starter のせいではない |

OpenCode 行（同スクショ）: ローリング 0%・月間 0% は取得成功。週次が無い・reset unknown は別メモ（teach 本数・reset 未教示）。

## 1b. 実ページ構造（2026-07-19 dogfood・個人 account）

URL: `https://github.com/settings/billing`（Overview）

| ブロック | 表示の型 | Copilot 残枠として使えるか |
|----------|----------|---------------------------|
| 見出し `Overview` | セクションタイトル | **不可**（chrome） |
| `Current metered usage` + ドル | **全製品合算**の gross metered（期間付き） | **不可**（Actions 等も混ざる） |
| `Current included usage` + ドル | included discounts 側 | **不可** |
| Subscriptions: `GitHub Free` / `Copilot Free` | プラン名 + 月額 $0 | プラン識別のみ |
| Metered usage → filter `Copilot` | `Copilot usage` / `Additional usage` のドル | **課金額の要約**。% 残枠バーではない |
| Usage by repository | リポジトリ別ドル（全製品混在しうる） | Copilot 専用残枠ではない |

dogfood は **Copilot Free**。Overview 上段ドルと「Usage by repository」合計は、Copilot フィルタ下の spend（$0）と一致しない → **上段は GitHub 全体 metered**。

**結論（このページ・Free）:** Claude 型の「使用 %」は無い。誤 teach ラベルはページ chrome と一致。サイドバー **Usage** は未 open。

## 2. なぜ Copilot が微妙か（確定事実 + 文脈）

### 2.1 ページが「Copilot 専用 usage」ではない

starter / 公式導線の主 URL は:

```text
https://github.com/settings/billing
```

これは **GitHub 全体の Billing & licensing Overview**。§1b で実ページ確認済み。

公式（legacy 経路）でも Overview → Metered usage → **Copilot フィルタ**。開いた瞬間の「Overview」「Current metered usage」は teach 対象として不適切。

### 2.2 課金モデルが 2026-06 に変わった

| 時期 | モデル | ユーザーが見るもの |
|------|--------|-------------------|
| 〜2026-05 頃 | Premium requests | PR 使用量 / 上限 |
| **2026-06-01 以降** | **AI Credits（usage-based）** | credit 枠・spend・追加 budget |

- 個人 Pro / Pro+ / Max: base + flex AI credits（docs 表）
- **Free（dogfood）:** サブスク $0。Overview は **ドル spend 要約**中心。completions 上限（docs: 2000/月）や credit 枠の **% バーはこの Overview に見当たらない**
- Org 席: 個人残枠 % が Web に出ないことが多い
- legacy 年次 PR 分岐あり

→ 同じ URL でもプランで DOM が違う。Claude 型の安定バーではない。

### 2.3 DOM teach 向きの UI ではない

- 見出し・グラフ・ドル表示・表が中心になりやすく、Claude / Cursor / OpenCode のような **「88%」葉ノード**が薄い or チャート内部
- ラベル文字列が長く、nearbyLabel が `Current metered usageGross m...` のように **見出し結合**になりやすい
- 競合 OSS **openusage** はブラウザ DOM ではなく  
  `GET https://api.github.com/copilot_internal/user`（エディタ/gh トークン）で Credits % を取る  
  → **DOM だけで安定運用するのは筋が悪い**という外部実装からの傍証  
  （many-ai-usage は API キー / トークン方式はスコープ外。参考のみ）

### 2.4 many-ai-usage の制約との衝突

| many-ai-usage 方針 | Copilot の現実 |
|--------------------|----------------|
| ログイン済み usage ページを DOM teach | billing は多製品・グラフ中心 |
| セレクタ + fingerprint をユーザーが教える | 数字葉が選びにくいと chrome を teach する |
| API / Cookie をサーバーに送らない・トークン保存しない | openusage 型の internal API は採用しない |
| starter に verified taught のみ | Copilot は **まだ taught 検証不能** → URL タイル維持が正しい |

## 3. dogfood での取り直し手順

### 3a. Copilot Free（2026-07-19 実機）— 正直な判定

Overview 実ページでは **% 残枠も completions 残数も見えない**。

| やること | 推奨 |
|----------|------|
| Overview の `Current metered usage` ドルを teach | **非推奨**（全製品合算。Copilot 残枠の意味にならない） |
| Copilot フィルタ下の `Copilot usage` / `Additional usage` ドル | **弱い surrogate**。spend 監視にはなるが Claude 型の「残枠 %」ではない。$0 固定だと変化も見えない |
| 誤 teach（Overview 見出し）の削除 | **推奨**（popup のゴミ表示を消す） |
| provider 自体 | タイル残して「要 Re-teach」or 外す。**Free では v0.1 dogfood 完了を狙わない**のが妥当 |

次に試すなら（未確認）:

1. サイドバー **Usage**（Billing and licensing 配下）を開き、AI credits / completions の % や used/total があるか見る  
2. `https://github.com/settings/copilot` や IDE 内 usage は拡張対象外だが、Web に同等表示があるかの手がかり  
3. **Pro 等の有料プラン**では Overview / Usage に credit % が出る可能性（docs は % of budget 表示に言及）。Free とは別検証

### 3b. 有料個人プラン想定（まだ dogfood 未確認）

1. 誤 teach を消す: options → GitHub Copilot → Tracked elements を削除、または Re-teach で上書き。
2. `https://github.com/settings/billing` を開き、**Overview 見出し・Current metered usage（全製品）は教えない**。
3. Metered usage で **Copilot フィルタ**、または Usage サブページで **AI credits の % / used-total** を探す。
4. teach するのは **数字を自分で持つ葉**のみ（picker tooltip で確認）。
5. popup で `—` が消え、Re-parse 後も残ることを確認。

**Org 席のみ**の場合: 個人 billing に残枠 % が無いことがある。Web teach では無理で、タイルを残すか外すのが正直。

**IDE status bar** の % は拡張から読めない（Web DOM のみ）。

## 4. starter 方針（この調査時点）

| 項目 | 方針 |
|------|------|
| `sample:copilot` | **現状維持**: URL タイルのみ。taught metrics を載せない |
| note 更新候補 | billing は多製品合算 Overview。2026-06 以降 AI credits。Free では % バー無し。taught は有料で数字葉が取れてから |
| verified taught 追加条件 | **有料個人**で再 visit + Re-parse が安定した実績 1 件以上。実金額・実 % は JSON に書かない。Free だけでは verified にしない |

## 5. 他プロバイダとの難易度比較（dogfood 感触）

| サービス | teach しやすさ | メモ |
|----------|----------------|------|
| Claude / Codex / Cursor / Ollama | 中〜高 | % 葉が比較的明確 |
| OpenCode Go | 中 | 3 バーあるが workspace URL は個人依存（別 reference） |
| Grok | 要確認 | 同スクショでは Grok Build 91% 取得済み |
| **GitHub Copilot** | **低（Free は実質対象外に近い）** | 全製品 Overview・ドル中心・% 無し |

## 6. 関連 URL（個人情報なし）

| 用途 | URL |
|------|-----|
| Billing overview（starter と同じ） | `https://github.com/settings/billing` |
| Docs: usage-based individuals | `https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals` |
| Docs: monitor usage (legacy PR 分岐あり) | `https://docs.github.com/en/copilot/managing-copilot/monitoring-usage-and-entitlements/monitoring-your-copilot-usage-and-entitlements` |
| openusage 実装メモ（API 経路・参考のみ） | study リポ `docs/providers/copilot.md` |

## 7. 未確認 / 確認済み

| 項目 | 状態 |
|------|------|
| Overview の chrome を誤 teach した | **確認済み**（popup ラベル = 実ページ見出し） |
| Overview 上段ドルが全製品合算 | **確認済み**（Copilot 行の spend と不一致） |
| dogfood が Copilot Free | **確認済み**（Subscriptions 表示） |
| Free Overview に % / completions カウンタ | **見当たらない**（この dogfood 範囲） |
| サイドバー Usage の中身 | **未 open** |
| 有料 Pro の credit % 表示 | **未 dogfood** |
| Org 席 | **未 dogfood** |

成功例が出たら §1 に interpretation / window 数のみ追記（selector 全文・実金額は書かない）。
