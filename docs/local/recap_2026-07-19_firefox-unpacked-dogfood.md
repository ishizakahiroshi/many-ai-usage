---
type: recap
status: watching
tags: [many-ai-usage, firefox, unpacked, starter, handoff]
owner: ishizakahiroshi
related:
  - design_unpacked-testing-guide_2026-07-16.html
  - recap_2026-07-19_many-ai-usage-teach-debug.md
  - plan_starter-pack-import.md
  - manual_release-v0.1.0_2026-07-14.md
last_reviewed: 2026-07-19
docsweep_policy: archive_with_release
---

# [振り返り] Firefox unpacked 実機 dogfood — Claude/Codex/Grok まで通した

> 日時: 2026-07-19 19:50 起点
> セッション主題: Firefox での動作確認手順、スターター 404、Claude URL ずれ、未ログイン UI の切り分け、Grok マーカー異常の観察。starter.json の Claude URL 修正まで。
> モード: full

## 今回の成果

- Firefox（通常版 + Dev Edition）で many-ai-usage の一時アドオン読み込み〜 teach 〜 popup 表示まで dogfood
- **Claude / Codex CLI / Grok** が popup に載るところまで確認（Claude は URL 手修正後）
- スターター取込の **GitHub raw 404** を特定（`resources/` 未コミット・未 push）。貼り付け import で回避
- `resources/starter.json` の Claude URL を実機導線に修正:  
  `https://claude.ai/settings/usage` → **`https://claude.ai/new#settings/usage`**
- Firefox 対象外にする議論 → **対象外にしない**（Dev Edition / 未ログイン / 誤 URL が主因で拡張コアは動く）と方針整理
- Grok teach 中のマーカー異常は **スーパーリロード後に解消**（SPA + content script 状態の切り分け）

## 学んだこと

- **Firefox 一時アドオン**: `about:debugging#/runtime/this-firefox` → `dist/firefox/manifest.json` **ファイル**を選ぶ（Chrome はフォルダ）。ブラウザ終了で消える
- **Claude usage 導線**: `/settings/usage` は upgrade 等に寄りやすい。実機で通るのは **`/new#settings/usage`（hash SPA）**
- **未ログイン vs 拡張バグ**: Grok 未ログインの薄いアカウント UI・Claude の黒画面/リダイレクトはサイト仕様。拡張は URL を 1 回開くだけ
- **スターター remote**: コードは `raw.githubusercontent.com/.../many-ai-usage/main/resources/starter.json` を見る。ローカルにファイルがあっても **git push 前は 404**。手元は JSON 貼り付け import
- **Grok picker**: 横長マーカー / `4.5` 誤候補は起きうる。**Ctrl+Shift+R 後に再 teach** が有効な切り分け
- **Dev Edition 切り分け**: プライベート通常版 → ログイン成功後、Dev Edition でも usage 表示できた。恒常の「Firefox 非対応」ではない

## 改善できたこと

- **「Firefox 対象外？」を早く切り分けた**: 症状を拡張非対応と断定せず、ログイン・URL・エディションを分離（次回も先に「サイトがそのブラウザで使えるか」）
- **ユーザー先行発見**: Claude の upgrade リダイレクト・Grok スーパーリロードはユーザー観察が先。AI は手順案内に寄せ、断定を抑える
- **starter 404 と Claude URL を同一「サンプル品質」問題として扱えた**: remote 未公開 + 誤 URL は dogfood でしか出ない → v0.1 前に starter を push 対象に含める必要
- **skill / docs 修正漏れ候補**（下記 skill 化検討へ）: unpacked 手順は HTML ガイドにあるが、セッション中は口頭で繰り返し説明した。スターター URL 検証のチェックリストが skill に無い

## 次にやること

- `resources/`（starter.json + sample icons）を **commit + origin/main push** して remote 取込 404 を解消（明示指示時）
- 作業ツリーの他変更（options/popup/samples 等の未コミット差分）とまとめるか分離するかを決めて commit
- Chrome でも同 starter URL で T シナリオを軽く通す（回帰）
- Grok マーカー異常が再発するか観察。再現安定なら bugfix / picker 改善 plan
- AMO / ストア提出は T1〜T5 と dist 鮮度を見てから（急がない）

## 引き継ぎ（次セッション用）

### 到達点

- Firefox unpacked で **Claude + Codex + Grok が popup 表示**まで dogfood 済み
- starter の Claude URL はローカル `resources/starter.json` で修正済み（**未 push**）
- ブランチ `main` は `origin/main` より **ahead 4**。加えて大きな working tree 差分と **`?? resources/`**

### 未完了

- [ ] `resources/` を git に載せて push（raw starter / icons の 404 解消）
- [ ] 未コミットの src/tests 差分の整理と commit（ユーザー指示待ち）
- [ ] Chrome 側の同シナリオ軽い回帰
- [ ] T1〜T5 全緑チェック（`design_unpacked-testing-guide_2026-07-16.html`）
- [ ] v0.1.0 タグ / Release / ストア提出
- [ ] Grok picker マーカー異常の再現・修正要否判断

### 再発防止 gotcha

- スターター 404 → `resources/` が remote に無い → 貼り付け import、または commit+push 後に再試行
- Claude が upgrade に飛ぶ → 登録 URL を `https://claude.ai/new#settings/usage` に直す（starter も同値）
- 未ログインで「無限リダイレクト？」 → 拡張は 1 回 open。サイトのログイン壁を疑う
- Grok マーカーがサイドバーまで伸びる / 変な数値 → usage タブをスーパーリロードしてから再 teach
- Firefox 一時アドオンが消えた → 終了で消える仕様。`manifest.json` を再読込

### 次の 1 手

1. `git status` / `git diff --stat` で `resources/` と src 差分の境界を確認
2. 方針: (A) resources だけ先に commit+push して starter 404 を消す / (B) 全差分まとめて / (C) まだ触らない
3. 手元確認は `pnpm run build:firefox` → about:debugging 再読み込み → 貼り付け or remote 取込

### 触らない / やらない

- 明示なしの commit / tag / push / ストア提出
- 「Firefox 対象外」へのプロダクト方針変更（今回の根拠では不要）
- 実アカウントの usage 数値・メールを docs/fixture に貼らない

## skill 化の検討メモ（本セッション）

| 候補 | 判定 |
|------|------|
| 新規 skill | 不採用（薄い・乱立回避） |
| **`design_unpacked-testing-guide_2026-07-16.html` 更新** | **採用・実施済み（2026-07-19）** — Claude URL・starter 404/貼り付け・Firefox 手順・Grok スーパーリロード・T2 経路を反映 |
| session-recap | 本ファイルが handoff 正本 |
