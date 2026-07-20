---
type: reference
status: watching
tags: [opencode, opencode-go, starter-pack, teach-mode, dogfood, personal-url]
owner: ishizakahiroshi
related:
  - plan_starter-pack-import.md
  - resources/starter.json
  - src/shared/schema.ts
  - src/shared/url.ts
last_reviewed: 2026-07-19
docsweep_policy: archive_with_release
---

# [参考] OpenCode Go — 個人 workspace URL と starter 方針

作成日: 2026-07-19

このファイルは **事実メモ + 方針決定** の正本。実装タスクではない。  
dogfood teach の手順は §5。teach 結果（selector / fingerprint）は **実 ID を除去したうえで** ここに追記するか、追記せずブラウザ storage のみに残す。

## 1. 観察（2026-07-19 スクショ）

| 項目 | 内容 |
|------|------|
| ホスト | `opencode.ai` |
| path 形 | `/workspace/<wrk_…>/go` |
| 個人部分 | path 中段の `wrk_…`（workspace ID と推定。アカウントまたは workspace ごとに異なる） |
| 画面 | OpenCode Go 購読状態 + 利用量 3 本 |
| 指標ラベル（UI 日本語） | ローリング利用量 / 週間利用量 / 月間利用量 |
| 各指標 | 使用 % 表示 + 「リセットまで …」 |

**例（構造のみ・実 ID はコミットしない）:**

```text
https://opencode.ai/workspace/<wrk_PERSONAL>/go
```

著者環境では path に `wrk_` 接頭の ID が入っていた。**他ユーザーで同じ文字列になる保証はない**（個人毎・workspace 毎が濃厚）。

## 2. なぜ固定 URL を starter に載せられないか

1. **共有 URL が存在しない（または未確認）**  
   Claude の `claude.ai/new#settings/usage` や Codex の analytics path と違い、Go の usage は path に個人 ID が埋まる。
2. **他人の `wrk_…` を sample に書くのは不可**  
   識別子に近く、開けない・誤誘導・プライバシーの三重で NG。
3. **現行 schema は `url` 必須**（`src/shared/schema.ts` の `ProviderConfig.url` は `v.url()`）  
   「urlMatch だけ・URL タイル無し」の provider を starter に載せるには **スキーマ変更が先**。現状のままでは空 URL / ダミー URL を入れるしかなく、Track でタブを開くと失敗する。
4. **metrics だけ共有しても再読取先 URL が要る**  
   teach の selector は他ユーザーの同じ UI で動く可能性はあるが、**最初に開く URL が個人依存**なので starter 一発 UX に乗らない。

## 3. 決定済み方針（2026-07-19 → 2026-07-20 更新）

**2026-07-20 追記: 案C を実機確認済み。** `https://opencode.ai/go` にログイン済みブラウザでアクセスすると、自分の `workspace/wrk_…/go` へ自動 redirect され、利用量ページがそのまま表示される（スクショで確認）。これにより `url: "https://opencode.ai/go"` は **個人 ID を含まない・全ユーザー共通の安全な entry URL** として starter.json に登録可能と判断する。D-OC1 はこの観測により見直す。

| # | 決定 | 理由 |
|---|------|------|
| D-OC1 | ~~`resources/starter.json` に OpenCode / OpenCode Go を載せない~~ **→ 撤回（2026-07-20）**。`url: https://opencode.ai/go` + `urlMatch: ["https://opencode.ai/*"]` で URL タイルとして登録可 | 案C 実機確認により固定 entry URL が存在すると判明。redirect 後の実ページ(wrk 付き)は urlMatch で吸収される |
| D-OC2 | **「urlMatch のみ・URL タイル無し」は今やらない** | 引き続き有効（schema 未対応）。ただし OpenCode は `url` に `/go` を書けるので本制約自体が不要になった |
| D-OC3 | **dogfood はローカル（ブラウザ storage）のみ** | 著者の `wrk_…` 付き provider（手動追加した実 entry）は引き続き commit しない。track JSON を docs に残す場合も ID・メール・実 % を除去 |
| D-OC4 | **starter への taught metrics 追加は別途 teach-mode 実施後** | URL タイルとしての登録(mode: auto, metrics: [])のみ 2026-07-20 に実施。selector/fingerprint は未実施のため追加しない |

### 将来候補（未決・着手条件付き）

| 案 | 内容 | 着手条件 |
|----|------|----------|
| A | ユーザーが「OpenCode を追加」→ 自分の `/go` URL を 1 回貼る → teach or 共有 metrics テンプレ適用 | 不要になった（D-OC1 撤回により `/go` を共通 entry として直接 starter 登録済み） |
| B | `url` optional + `urlMatch` only の template provider | 不要（同上） |
| C | `https://opencode.ai/go` がログイン後に自分の workspace へ redirect するか検証 | **確認済み（2026-07-20）**。redirect 先は `/workspace/wrk_…/go`、ページはローリング/週間/月間の3利用量を表示 |

**今後やる（任意）:** starter.json の OpenCode entry に対して実際に teach-mode を実施し、taught metrics（ローリング/週間/月間利用量）を追加する。selector は個人 workspace で teach しても DOM 構造自体は共通ページテンプレのはずだが、追加前に実 teach で fingerprint を採取すること。

## 4. many-ai-usage での正しい使い方（ユーザー / dogfood）

1. ブラウザで **自分の** OpenCode Go 利用量ページを開く（URL が `/workspace/wrk_…/go` 形であることを確認）。
2. 拡張 options で provider を手動追加:
   - displayName: `OpenCode Go`（任意）
   - url: **今開いている URL をそのまま**（自分の wrk 付き）
   - urlMatch 推奨: `https://opencode.ai/workspace/*` または `https://opencode.ai/*`
   - mode: `taught`
3. Track / teach で 3 metric を教える（§5）。
4. Re-parse / popup で数値が並ぶことを確認。
5. **git に provider 丸ごとを載せない**（url に個人 ID が残る）。

`matchesProviderUrl`（`src/shared/url.ts`）は exact path 一致のほか `urlMatch` と path prefix も見る。  
**登録 `url` は自分のフル path**、**マッチは広め**がこのサービスの基本形。

## 5. Dogfood teach 手順（3 metric）

前提: 拡張 unpacked が最新 dist、OpenCode にログイン済み、Go を購読して usage ページが表示できること。

### 教える対象（画面ラベル → 保存時の目安）

| 順 | UI ラベル | metricId 案 | windowLabel 案 | interpretation |
|----|-----------|-------------|---------------|----------------|
| 1 | ローリング利用量 | `opencode-go-rolling` | `Rolling` / `5h` 相当 | `used_percent`（% が使用率なら） |
| 2 | 週間利用量 | `opencode-go-weekly` | `Weekly` | 同上 |
| 3 | 月間利用量 | `opencode-go-monthly` | `Monthly` | 同上 |

各 metric で **値（% を持つ葉）** を teach。可能なら **リセット文**も reset anchor として teach。

注意:

- 0% でも teach 可（構造取得が目的）。**実 % を docs / fixture に書かない**。
- flex 行全体ではなく数字を持つ要素を選ぶ（Claude dogfood と同様。`refineValueElement` が効く想定）。
- 言語が英語 UI の場合は nearbyLabel が英字になる。starter 化しない限り問題にしない。

### 操作手順

1. options → Add / Track で §4 の provider を保存。
2. Track this element（または Re-teach）で Go ページを開き picker を起動。
3. ローリングの % をクリック → Track → ラベル確認。
4. 続けて週間・月間も同様（multi-metric continuous が有効なら同一セッションで 3 本）。
5. 可能なら各「リセットまで …」も teach。
6. Done → popup で 3 本表示を確認。
7. options → Tracked elements の **Copy JSON** で各 metric を取得（デバッグ用・ローカルのみ）。

### teach 結果の扱い

| 置き場 | 可否 |
|--------|------|
| ブラウザ `chrome.storage` | OK（本線） |
| `resources/starter.json` | **不可**（D-OC1。url に wrk が要る / 載せない方針） |
| 本ファイルへの追記 | **構造のみ可**: selectors / tagName / textFingerprint の型。`wrk_…`・メール・実 %・実 nearbyLabel 内の個人文は除去 or 一般化 |
| 公開 issue / スクショ | wrk とメールを塗りつぶす |

### 完了条件（dogfood）

- [x] 自分の `/workspace/wrk_…/go` で provider 登録済み（storage のみ）— 2026-07-19 popup で OpenCode 行を確認
- [ ] 3 metric が taught で popup に並ぶ（同日時点: **ローリング + 月間** の 0% 表示まで。週次は未確認 / 未教示の可能性）
- [ ] 再 visit / Re-parse で少なくとも % が再読取できる（reset は任意・同日は reset unknown）
- [x] リポに `wrk_…` や実メールがコミットされていない

**AI セッションだけでは完了できない部分:** picker のクリック操作。ユーザー（または別途ブラウザ操作）が §5 を実行したあと、必要なら sanitize 済み track JSON を本節に追記する。

### dogfood メモ（2026-07-19）

popup スクショ: OpenCode に「ローリング利用量 0%」「月間利用量 0%」。バー表示まで到達。2026-07-20: `opencode.ai/go` の redirect 確認により starter 登録（URL タイルのみ）に方針転換。

**2026-07-20 追記:** `opencode.ai/go` へログイン済みでアクセス → 自分の `workspace/wrk_…/go` へ redirect → ローリング/週間/月間利用量ページが表示されることを実機確認。`/go` 自体には個人 ID が含まれないため、starter.json の `url` に安全に使える。

## 6. 他プロバイダとの対比（starter 載せやすさ）

| サービス | URL の個人依存 | starter 向き |
|----------|----------------|--------------|
| Claude | hash SPA だが path/hash は共有可 | 向き（taught 済みテンプレ可） |
| Codex | 共有 path 可 | 向き |
| Cursor / Ollama 等 | 共有 path 可 | 向き or URL タイル |
| **OpenCode Go** | entry (`/go`) は共通、redirect 先のみ wrk 付き | **向き（URL タイル。2026-07-20 確認）** |

## 7. 関連コード・ファイル

| 対象 | 役割 |
|------|------|
| `src/shared/schema.ts` | `url` 必須・TaughtMetric 形 |
| `src/shared/url.ts` | `urlMatch` / path prefix マッチ |
| `resources/starter.json` | コミュニティ starter 正本（OpenCode: URL タイルのみ登録済み・2026-07-20） |
| `resources/provider-sample-icons/opencode.svg` | OpenCode サンプルアイコン（2026-07-20 追加） |
| `docs/local/plan_starter-pack-import.md` | スターター全体計画。判断ログに D-OC* を要約転記 |

## 8. 変更時のチェック（taught metrics を追加する場合）

現状は URL タイルのみ（`mode: "auto"`, `metrics: []`）。taught metrics を載せたくなったら、先に次を埋める:

1. 実際に teach-mode を実施し、ローリング/週間/月間の selector・textFingerprint を採取する
2. 採取結果から `wrk_…` 等の個人文字列を除去し、構造のみ本ファイルまたは starter.json に反映する
3. 複数アカウントで DOM 構造が共通か（多言語 UI 差分含め）確認する

上記なしに taught metrics を `starter.json` へ追加しない。
