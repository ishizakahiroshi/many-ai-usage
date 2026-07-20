---
type: bugfix
status: in-progress
tags: [teach-mode, opencode, picker, data-loss]
owner: ishizakahiroshi
review_status: draft
related:
  - docs/local/reference_opencode-go-personal-workspace-url.md
  - docs/local/plan_opencode-go-taught-metrics.md
  - src/background/index.ts
  - src/content/teach/picker.ts
last_reviewed: 2026-07-20
---

# [実装済み・実機検証待ち] teach-mode: ラベル衝突による上書き消失 + クリック位置を無視した絞り込み誤爆

## 症状

OpenCode Go の usage ページ(`opencode.ai/go` → 個人 workspace へ redirect)で、ローリング/週間/月間の3利用量を teach-mode で順に teach し「Done and return」した後、options 画面の「追跡中の要素」に **2件しか残らない**(3件 teach したのに1件消える)。

再現手順:
1. OpenCode Go の usage ページで Track/Re-teach を起動
2. 「ローリング利用量」の0%表示をteach → picker パネルに1件目として保存される
3. 「週間利用量」の0%表示をteach → picker パネルのラベルが誤って**「ローリング利用量」と重複表示**される(パネル上は「Saved: 3」で3行表示、うち2行が同名)
4. 「月間利用量」の0%表示をteach
5. 「Done and return」→ options 画面の「追跡中の要素」を見ると **「ローリング利用量」「月間利用量」の2件のみ**。しかも「ローリング利用量」エントリの中身が別物に変わっている

実際に Copy JSON で取得した内容(個人ID・実URLは含まない):

teach直後(1回目・正常時)の「ローリング利用量」:
```json
{
  "metricId": "taught-297c36b4",
  "label": "ローリング利用量",
  "valueAnchor": {
    "selectors": ["div:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(2)"],
    "tagName": "span",
    "nearbyLabel": "ローリング利用量0%"
  }
}
```

Done後、options画面から再取得した同じ metricId の「ローリング利用量」:
```json
{
  "metricId": "taught-297c36b4",
  "label": "ローリング利用量",
  "valueAnchor": {
    "selectors": ["section._root_9awwr_1 > div:nth-of-type(3) > div:nth-of-type(2)"],
    "tagName": "div",
    "nearbyLabel": "ローリング利用量0%リセットまで 5 時間 0 分週間利用量0%リセットまで 6"
  }
}
```

`metricId` は同一だが、`selectors`/`tagName`/`nearbyLabel` が全く別物(ローリング列の末尾〜週間列全体にまたがる巨大な `div` コンテナ)に変わっている。「月間利用量」(`taught-dff0c0b7`)は改変されず正常。

影響: teach-mode全般(全プロバイダ共通)。特に「複数のmetricを連続teachした際、自動生成ラベルが偶然重複する」「ユーザーが手動で2つのmetricを同じ名前にリネームする」ケースで、後から teach/rename した方が先勝ちで前のmetricのデータを黙って上書きし消失させる。

## 根本原因

2つの独立したバグが連鎖して発生している。

### バグ1(データ消失の直接原因): ラベル一致によるマージ上書き

`src/background/index.ts:686-694` の `saveCompletedTeach()` が、teachセッション中に一時保存された metrics を永続化済み `provider.metrics` へマージする際:

```ts
async function saveCompletedTeach(tabId: number, session: TeachSession): Promise<boolean> {
  const provider = await getProvider(session.providerId);
  if (!provider || session.metrics.length === 0) return false;
  const metrics = [...provider.metrics];
  for (const staged of session.metrics) {
    const index = metrics.findIndex((metric) => metric.metricId === staged.metricId || metric.label === staged.label);
    if (index >= 0) metrics[index] = { ...staged, metricId: metrics[index].metricId };
    else metrics.push(staged);
  }
  ...
```

`metric.metricId === staged.metricId || metric.label === staged.label` の **`|| label` 部分** が原因。`metricId` が異なっていても、表示名(`label`)が偶然/意図的に一致するだけで「同じmetricの再teach」とみなし、`metrics[index] = { ...staged, metricId: metrics[index].metricId }` で **古い metricId を保持したまま中身を丸ごと新しいstagedデータで上書き**する。これが「ローリング利用量」の metricId が `taught-297c36b4` のまま selectors/tagName/nearbyLabel だけ別物に変わっていた直接の理由。

セッション内の一時保存(`src/background/index.ts:834`、`picker.ts:1071`)は `metricId` のみでの一致判定であり、この `|| label` フォールバックが存在するのは **teach完了時の最終マージ処理のみ**。そのため picker パネル上では3件正しくステージされていた(Saved: 3)のに、Done実行時にサイレントに2件へ減った。

### バグ2(なぜラベルが衝突したか・根本原因): クリック位置を無視した絞り込み誤爆

週間利用量をクリックした際、`src/content/teach/picker.ts` の `refineValueElement()`(613-643行)が、本来クリックした値だけを持つ小さな `span` 要素ではなく、ローリング列の「リセットまで」〜週間列全体を含む巨大な `div` コンテナを選んでしまった(上記の壊れた `valueAnchor` が証拠)。

原因は `scoreUsageCandidate()`(567-604行、`refineValueElement` 内部で候補ノードのスコアリングに使用)に **クリック座標(x, y)の考慮が一切ない**こと。ホバー時のプレビュー用スコアリング関数 `scoreHoverCandidate()`(337-388行)には `rectContainsPoint(rect, x, y, 6)` によるポインタ位置ボーナス(`containsPointer`)があるのに、クリック確定後の絞り込みで使われる `scoreUsageCandidate()` にはこの仕組みが無い。`refineValueElement(element)` は `element`(クリックで解決された起点要素)のサブツリー内でテキスト特徴だけを頼りに最良候補を探すため、起点要素がやや広め(列をまたぐコンテナ)に解決された場合、クリック位置と無関係な要素が「もっともらしいテキストを持つ」という理由だけで選ばれてしまう。

この誤選択によって `metricLabel()`(405-413行)も同じ壊れた要素からラベルを導出し、たまたま(もしくは`candidates`探索順の結果)「ローリング利用量」という文字列を拾ってしまい、バグ1のラベル一致マージと組み合わさってデータ消失に至った。

## 修正内容

対応済み:

1. `saveCompletedTeach()` は `metricId` のみで既存 metric を照合する。表示ラベルが同じでも別の metric として保持し、re-teach は従来どおり同じ `metricId` を更新する。
2. picker のクリック座標を `refineValueElement()`、`makeMetric()`、live reset 推測へ渡す。クリック位置を含む候補を優先し、コンパクトな値候補がある場合は広い親コンテナを候補から外す。

## 変更ファイル

- `src/background/index.ts`
- `src/content/teach/picker.ts`
- `tests/background.test.ts`
- `tests/teach.test.ts`

## 検証

- [x] 同一 label・異なる `metricId` の2 metricを Done しても両方保持される回帰テストを追加
- [x] `metricId` が同じ re-teach は既存 metric を更新する回帰テストを追加
- [x] 3列の合成 DOM で、クリック座標に対応する小さい値 `span` を選ぶ回帰テストを追加
- [ ] OpenCode Go の実機でローリング/週間/月間を再teachし、3件が正しい selector で保存されることを確認
- [ ] 既存の他プロバイダ(Claude/Codex/Cursor/Ollama等)の実機 taught metricsが本修正で壊れないことを確認

## 備忘

- `refineValueElement`/`scoreUsageCandidate` は teach-mode の中核共通ロジックであり、変更の影響範囲が広い。修正時は `docs/local/plan_teach-multi-metric-continuous.md` 等、関連する teach-mode の既存 plan/bugfix を横断確認してから着手すること。
- 今回の実機確認で使ったOpenCode Goの実workspace ID・実URLはこのファイルにも含めていない(`docs/local/reference_opencode-go-personal-workspace-url.md` の方針に準拠)。
