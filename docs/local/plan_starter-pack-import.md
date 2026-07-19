---
type: plan
status: draft
tags: [starter-pack, import, onboarding, ux, try-samples, usage-guide]
owner: ishizakahiroshi
review_status: draft
related:
  - plan_try-samples-onboarding.md
  - plan_usage-guide-easy-issue.md
  - recap_2026-07-19_many-ai-usage-teach-debug.md
  - pending_user-locale-json-import.md
  - reference_store-submit-split-vs-bulk.md
last_reviewed: 2026-07-19
due: 2026-08-02
docsweep_policy: archive_with_release
---

# [計画] スターターパック取込（UX 優先・固定 URL 一発 + 貼り付け副経路）

作成日: 2026-07-19(日)

このファイルを開いた AI は、下記の方針・スコープ・手順に従って実装または詳細化すること。  
判断待ちで止まらず、未決は `## 判断ログ` に記録して先の C の設計まで進めてよい。実装に入る C はユーザーが「これやって」等で明示したときのみ。

## context配分

| C | 種別 | 内容 | 並列 |
|---|---|---|---|
| C1 | plan | 方針確定・スキーマ `starter.v1`・Try samples との役割分担 | — |
| C2 | plan | ストア経由動線・popup 本線 CTA・離脱対策 UI | — |
| C3 | plan | 拡張実装（fetch / paste / merge / i18n / テスト） | C1 依存 |
| C4 | plan | スターター JSON 正本の置き場・中身（verified のみ）・usage.html | C1 依存 |
| C5 | plan | プライバシー・ストア文面・README・審査 note | C3/C4 と [並列OK] 可 |
| C6 | plan | 検証チェックリスト・リリース判断（承認待ちと UX の切り分け） | C3–C5 依存 |

実行順: `C1 → C2 → (C3, C4) → C5 → C6`  
（C3 と C4 は成果物の schema が C1 で固まっていれば並列可。C5 は文面だけ先に下書き可）

---

## 1. 背景・目的

### 背景

- v0.1 は **provider ゼロ同梱** + **Try samples = URL パターンのみ**（selector / taught metrics なし）。
- 建前は「自分で teach」。実機 dogfood（Claude / Codex）では teach が通るが、**初回到達コストが高い**。
- 2026-07-19 会話で次を合意方向:
  - usage サイト or GitHub raw に **サンプル JSON（metrics 付き）** を置く
  - ユーザーは **貼り付け** または **ボタン一発 fetch** で取込 → 基本は数字まで行ける
  - **UX / 離脱を優先**。Chrome / Firefox のストア承認が遅れても、unpacked / 自サイト導線で先に体験を良くする
- 直前実装: options の Tracked elements に **トラック生 JSON**（折りたたみ + コピー）あり → export 土台になる

### 目的

1. ストア経由ユーザーが **popup 空状態から 1〜2 操作でスターターまで到達**できる
2. 取込後は **ログイン + ホスト権限 + refresh** だけで主要ベンダーの usage が並ぶ（teach は壊れたときだけ）
3. 建前（ユーザーが明示取込した設定）と本音（作者メンテのスターター）を両立
4. 拡張リリースなしで JSON 差し替え可能な運用にする

### 非目的（この plan の外）

- 任意 URL をユーザーが自由入力して fetch（上級者機能は将来。v この plan ではやらない）
- ログイン代行・Cookie 保存・クラウド同期
- 言語パック JSON import（別件: `pending_user-locale-json-import.md`。混同しない）
- API キー従量残高
- 拡張バイナリへの taught metrics 同梱（ゼロ同梱・審査見え方を壊す）

---

## 2. 決定済み方針（2026-07-19）

| # | 決定 | 理由 |
|---|------|------|
| D1 | **本線 = 固定 URL のボタン一発 fetch** | ストア動線・離脱最小化。Try samples と同型で説明しやすい |
| D2 | **副経路 = JSON 貼り付け import** | オフライン・自作・共有・デバッグ。外部通信なし |
| D3 | **任意カスタム URL 設定は今はやらない** | 任意 host / 改ざん / 審査説明コスト |
| D4 | **popup 空状態の主 CTA がスターター** | ストア経由はアイコン→popup が本命。usage.html だけだと読まれない |
| D5 | **Try samples（URL のみ）とスターターは統合 or 主従を明確化** | 2 ボタン並立は迷う。ユーザー向けは **ボタン 1 つ**推奨 |
| D6 | **既存 provider / ユーザー teach は既定で上書きしない** | Re-teach 結果を守る。上書きは明示オプトインのみ |
| D7 | **スターターは非保証・腐る前提** | SPA class 変更で壊れる。`verifiedAt` + Re-teach 導線 |
| D8 | **UX をストア承認より優先** | 承認待ち中も unpacked / サイト / GitHub Releases で体験改善してよい |
| D9 | **正本は GitHub、案内は usage.html** | 版管理は git。サイトは物語と Copy 導線 |

### D5 の推奨形（実装時の既定）

ユーザー向けボタンは **1 つ**:

- ラベル案: 「スターターを取り込む ▸」 / `Import starter pack ▸`
- fetch する JSON は **`many-ai-usage.starter.v1`**（URL + metrics）
- 旧 Try samples（`providers.v1` URL のみ）は:
  - **A（推奨）**: スターターに吸収し、UI から Try samples 文言を置換
  - **B**: 高度な設定に「URL のみサンプル」を残す  
  実装着手時に A を既定とし、レビューで B が必要なら残す。

---

## 3. スコープ

### やる（拡張）

- `starter.v1` の parse / validate（valibot）
- 固定 URL からの `fetch`（credentials omit, cache no-store）+ 同意ダイアログ（URL 全文表示）
- paste import（textarea）
- merge: 新規 id のみ追加、既存 id は skip（上書きは別確認）
- popup 空状態 CTA + options onboarding 差し替え
- provider 全体 export（任意・できれば C3 内）— トラック単体 JSON は既存
- テスト・i18n（en/ja）
- privacy / store listing / README の文言更新案

### やる（データ・サイト）

- `starter.json` 正本を GitHub に置く（候補パスは §5）
- 検証済み vendor だけ `working` で載せる（未検証は載せない or 別節）
- usage.html にスターター節（説明・最終確認日・Copy・非保証）

### やらない

- ユーザー任意 starter URL
- metrics を拡張 dist に同梱
- 取込と同時の全ホスト silent permission 強要（Chrome はユーザー操作が必要）
- 実 usage 数値・実アカウントを JSON / docs に入れる（合成 or 構造のみ）

---

## 4. ストア経由の目標動線（離脱ポイント付き）

```text
Chrome/Firefox ストア or ZIP
  → インストール
  → ツールバーアイコン          ← ピン留め促進はスクショ / ストア文で軽く
  → popup 空状態
       [スターターを取り込む ▸]  ← ★本線（1 クリック目）
       [使い方を見る]
  → 確認ダイアログ（取得 URL・何が入るか・非保証・ログイン必要）
  → 取込成功 → タイルが並ぶ
  → ホスト権限（サービスごと or まとめて案内）
  → ログイン済みなら Refresh / 自動 capture
  → 数字表示
  → 壊れたタイルだけ Re-teach / Fix tracking
```

| 離脱ポイント | 対策 |
|--------------|------|
| popup を開かない | ストア説明先頭・スクショ 1 枚目に空 popup + ボタン |
| 主 CTA が弱い / 2 択で迷う | オレンジ主ボタン 1 つ。副はテキストリンク |
| ダイアログが長い | 3 行 + URL 1 行 + 注意 1 行。詳細は usage.html |
| 取込後すぐ数字が出ない | 成功メッセージで「次: ログインとアクセス許可」。Needs attention を開く |
| 権限ダイアログ拒否 | タイルごとに Allow を再提示（既存 needs_permission） |
| selector 腐敗 | broken track 文言 + Re-teach。starter の `verifiedAt` 表示 |

**usage.html の Copy は副経路。** ストアユーザーの本線にしない。

---

## 5. スキーマ案（C1 で確定）

### 既存

- `many-ai-usage.providers.v1` … URL のみ registry（現行 Try samples）
- `many-ai-usage.provider.v1` … storage 上の 1 provider（metrics 可）

### 新規

```json
{
  "schema": "many-ai-usage.starter.v1",
  "updated": "2026-07-19",
  "note": "Community starter. Not official partner configs. May break when sites redesign. Re-teach if reads fail.",
  "source": "https://raw.githubusercontent.com/ishizakahiroshi/…/starter.json",
  "providers": [
    {
      "id": "sample:claude",
      "displayName": "Claude",
      "url": "https://claude.ai/…",
      "urlMatch": ["https://claude.ai/*"],
      "mode": "taught",
      "refreshIntervalMinutes": 15,
      "verifiedAt": "2026-07-19",
      "metrics": [
        {
          "metricId": "…",
          "label": "…",
          "kind": "percent",
          "unit": "percent",
          "windowLabel": "…",
          "valueAnchor": { "selectors": ["…"], "tagName": "…", "textFingerprint": "…", "nearbyLabel": "…" },
          "resetAnchor": { "selectors": ["…"] },
          "interpretation": "used_percent",
          "enabled": true
        }
      ]
    }
  ]
}
```

ルール:

- parse 後に storage 用 `ProviderConfig` へ写像（`createdAt` / `updatedAt` / `order` / `displayEnabled` は取込時生成）
- `metrics` 空の provider も許容（URL タイルのみ = 旧 Try samples 相当を 1 ファイルに含められる）
- 不正 schema / 未知 schema は拒否（コード実行しない・JSON data only）
- サイズ上限案: 応答 512KB 程度（C1 で数値確定）
- **秘密情報・実 usage 数値・Cookie をスキーマに持たない**

### 既定 fetch URL（候補・C4 で 1 本に決める）

| 候補 | 長所 | 短所 |
|------|------|------|
| many-ai-cli `resources/usage-links/starter.json` | 既存 `providers.json` と同居・raw 運用済み | 拡張と別リポ |
| many-ai-usage `resources/starter.json` または `docs/…` | 拡張と同じリポ | raw 用に public 必須 |
| ishizakahiroshi.com `…/starter.json` | サイト物語と一体 | デプロイ忘れ・版管理弱い |

**推奨:** GitHub raw を正本（many-ai-cli または many-ai-usage のどちらか 1 つ）。usage.html は説明 + 同内容の Copy またはリンク。

manifest:

- 既に GitHub raw の host permission があるなら **同じ origin に starter を置くと permission 追加不要**（最優先で検討）
- サイト origin を足すなら privacy と listing を必ず更新

---

## 6. マージ方針

`applyStarterProviders(remote, { replaceExisting?: boolean })` 案:

| 状況 | 既定動作 |
|------|----------|
| 未知 id | 追加。runtime `needs_permission` |
| 既存 id・`replaceExisting=false` | skip（件数を UI に表示） |
| 既存 id・ユーザーが「公式で上書き」確認後 | metrics / url を starter で置換、`updatedAt` 更新 |
| ローカルだけの provider | 触らない |

冪等: 2 回押しても duplicate しない（既存 `applyRegistryProviders` と同思想）。

---

## 7. UI 要件（要約）

### popup（providers.length === 0）

- 主: **スターターを取り込む** → options `?importStarter=1` または popup 内ダイアログ
- 副: 使い方（USAGE_GUIDE_URL）
- 空メッセージは「ひな型を入れるか、自分で usage を追加」

### options

- 空 / サンプル未導入時: onboarding カードをスターター向け文言に更新
- 常設（設定下部など）: **JSON を貼り付けてインポート**（details 折りたたみでよい）
- 取込ダイアログ: URL 全文・取得内容（設定ひな型・metrics 含む・Cookie 送らない）・非保証
- 成功: `追加 N / スキップ M` + 次アクション
- 既存: Tracked elements の生 JSON（debug / 部分共有）

### 取込後

- 可能なら「未許可ホストを許可」導線
- 数字は保証しない旨を 1 行

---

## 8. 実装ステップ（C3 詳細の骨子）

作業ディレクトリ: `C:\dev\github\public\many-ai-usage`

1. **schema** (`src/shared/schema.ts`)
   - `starterPackSchema` / `parseStarterPackResponse`
   - ProviderConfig への normalize
2. **samples / storage** (`src/shared/samples.ts`, `storage.ts`)
   - `STARTER_PACK_URL` 定数
   - `fetchStarterPack()`
   - `applyStarterProviders()`（または既存 apply を拡張）
3. **options / popup UI** + locales en/ja
4. **tests**: 正常系・schema 拒否・冪等・既存上書きしない・サイズ
5. **docs**: README, `docs/store/*`, PRIVACY, usage.html 側はサイトリポ or 別作業

### 家の不文律（この plan 実行時）

- `git commit` / `git push` / `git tag` はユーザー指示があるまでやらない
- `pnpm run build:*` は明示指示があるまで AI から自動実行しない（typecheck / test は可）
- 実アカウントの usage 実値・Cookie・トークンを fixture / docs / starter.json に書かない
- 各 AI サービスへは読み取りのみ（書き込み API 禁止）
- secrets-scan 対象の公開ファイルを書くときは一般化・合成データ

---

## 9. スターター中身の運用（C4）

| 優先 | vendor | 2026-07-19 時点の目安 |
|------|--------|----------------------|
| P0 | Claude | dogfood 成功 → starter 候補 |
| P0 | Codex | dogfood 成功 → starter 候補 |
| P1 | Grok | teach 改善済みなら verified 後 |
| P2 | Copilot / Cursor / Ollama | 実機後。未検証は metrics 空でも可 |

各 provider:

- `verifiedAt` 必須（working 扱いの条件）
- Tailwind べた付け selector は避け、**fingerprint / nearbyLabel 重視**の teach 結果を採用
- 失敗したら JSON だけ差し替え（拡張バージョン上げ不要）

usage.html:

- 「公式サポート一覧ではない」維持
- スターター節を追加（任意・非保証・最終確認日）
- レシピ表の「selector は載せない」と矛盾しないよう **「任意のスターターパック」** とラベル分離

---

## 10. プライバシー・審査（C5 骨子）

現行: Try samples は **URL のみ**・確認後のみ GitHub raw。

更新が必要な文言:

- 取得物が **URL + taught selector/fingerprint（設定ひな型）** に変わる場合、listing / privacy に明記
- 送るもの: なし（GET のみ、credentials omit）
- 実行しない: 取得 JSON を code として eval しない（data only）
- 初回自動 fetch はしない（ボタン確認後のみ）— **これは維持必須**

ストア承認が遅くても:

- UX 改善は main / Releases / usage.html に出せる
- 審査中ビルドと starter URL の整合だけ意識（古い審査 note と矛盾しない説明）

---

## 11. 検証（C6）

### 自動

- `pnpm run typecheck`
- `pnpm test`（starter parse / apply 冪等 / 上書きしない）

### 手動（unpacked）

1. 新規プロファイル相当（providers 空）
2. popup → スターター取込 → 確認 → 追加 N 件
3. 2 回目 → 追加 0 / スキップ N
4. Claude / Codex ログイン済みで refresh → 数字 or broken の正しい表示
5. paste で 1 provider だけ追加できる
6. オフライン fetch → エラー + 再試行
7. 既存 teach 済み id を starter が上書きしない

### 完了条件

- [ ] popup 空状態からスターターまで 2 操作以内
- [ ] 固定 URL 1 本 + paste 副経路
- [ ] schema 検証・冪等・非上書き
- [ ] privacy / store 文案が fetch 内容と一致
- [ ] starter.json に P0 が verified 付きで載る
- [ ] usage.html に非保証のスターター節

---

## 12. リスク

| リスク | 緩和 |
|--------|------|
| selector 腐敗で「動かない拡張」評価 | 非保証明示・verifiedAt・Re-teach・JSON ホットフィックス |
| ストアがスクレイピング定義配布と見る | ユーザー確認後・data only・teach も可能と明記 |
| Try samples と二重導線で混乱 | ボタン 1 つに統合（D5-A） |
| サイト正本忘れ | GitHub raw 正本 |
| 言語パック import と用語混同 | UI は「スターター」「設定のひな型」。locale は別 pending |
| 承認前に privacy と実装がズレる | C5 を C3 と同コミット単位で更新 |

---

## 13. 成果物チェックリスト

- [ ] `src/shared/schema.ts` — starter.v1
- [ ] `src/shared/samples.ts` / `storage.ts` — fetch + apply
- [ ] `src/options/main.tsx` / `styles.css` — ダイアログ + paste
- [ ] `src/popup/main.tsx` — 空状態 CTA
- [ ] `src/locales/en.json` / `ja.json`
- [ ] `tests/*.ts` — starter 系
- [ ] manifest host が URL と一致
- [ ] README / PRIVACY / `docs/store/*`
- [ ] GitHub 上 `starter.json`（別リポならその plan / PR）
- [ ] usage.html 更新（サイト側作業）

---

## 14. 判断ログ

| 日付 | 判断 | 内容 |
|------|------|------|
| 2026-07-19 | UX 優先 | ストア承認遅延より、動線と離脱を優先してスターター取込を設計する |
| 2026-07-19 | 本線 | 固定 URL ボタン一発。貼り付けは副。任意 URL は見送り |
| 2026-07-19 | 入口 | popup 空状態が本命。usage.html は副 |
| 2026-07-19 | 確定 | starter.json 正本 = many-ai-usage `resources/starter.json`（GitHub raw） |
| 2026-07-19 | 確定 | Try samples をスターターに吸収（D5-A）。UI 文言は「スターターを取り込む」 |
| 2026-07-19 | 確定 | サンプルアイコンは `resources/provider-sample-icons/`（many-ai-cli 同型の文字バッジ）。拡張 dist に同梱せず、取込時に iconUrl を一度 fetch → `iconDataUrl` 保存。ユーザー上書き可 |
| 2026-07-19 | 確定 | ストア申請はスターター本線込みの **一括**（分割の審査短縮より離脱リスクを優先）。詳細: `reference_store-submit-split-vs-bulk.md` |

---

## 15. 関連参照

- 現行 Try samples 実装: `src/shared/samples.ts`, `src/options/main.tsx`, `src/popup/main.tsx`
- URL のみ registry: `https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json`
- 使い方: `https://ishizakahiroshi.com/articles/many-ai-usage/usage.html`（`USAGE_GUIDE_URL`）
- トラック生 JSON UI: `src/options/main.tsx`（TaughtMetric pretty-print + copy）
- 既存 plan: `plan_try-samples-onboarding.md`（URL のみオプトインの経緯）
- 混同注意: `pending_user-locale-json-import.md` は **UI 言語パック** の話。本 plan とは別

参照: `plan_try-samples-onboarding.md`（理由: 既存オプトイン fetch の詳細手順が長く、本 plan は差分方針に集中するため）
参照: `src/shared/schema.ts`（理由: ProviderConfig / TaughtMetric の正本はコード側で動的）
参照: `reference_store-submit-split-vs-bulk.md`（理由: 分割申請 vs 一括の審査日数・離脱リスク判断の正本）
