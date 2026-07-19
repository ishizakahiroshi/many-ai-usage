# Chrome Web Store 掲載文案

## 拡張機能名

many-ai-usage

## 短い説明

AI サービスの利用状況を、ブラウザ内だけで確認できるローカルダッシュボード。

## 詳細説明

many-ai-usage は、登録した利用状況ページからユーザーが選んだ表示値を読み取り、複数サービスを一つの小さなダッシュボードにまとめます。最初に「Track this element」で追跡したい値をまとめて教えると、次回から同じページでその値を読み取ります。

主な機能:

- 初期状態は空。必要な場合だけ Try samples で URL のみのサンプル6件を取得
- 専用の新規タブで picker を開き、複数の利用値を 1 セッションで連続登録
- metric 名の変更・個別削除と、近くのリセット表示の自動関連付け
- selector と fingerprint によるページ改訂時の再探索
- 3 回連続で読めない場合の Re-teach 通知
- 教えていないページはリンクタイルとして表示

プライバシー:

- 外部サーバーへデータを送信しません
- Cookie、トークン、ページ本文、アカウント識別子を収集しません
- 利用状況の取得は読み取り専用です

使用権限:

- `storage`: 設定、教えた selector、ローカルスナップショットを保存
- `tabs` / `scripting`: 登録ページを見つけ、ページ内のローカル読み取り処理を実行
- GitHub raw への固定 host access: Try samples の確認後だけ、公開された URL のみのサンプル台帳を取得
- optional host access: ユーザーが許可した登録済み利用状況ページだけを読み取り

カテゴリ候補: Productivity

## スクリーンショット案

- `screenshot-dashboard.png`: 2 件の登録済みプロバイダーの利用値が並ぶ dashboard
- `screenshot-picker.png`: Track this element のハイライトと候補値ツールチップ
- `screenshot-settings.png`: Re-teach needed カードと options の taught metric 一覧

画像は `docs/local/design_teach-mode-store-screens_2026-07-14.html` から生成した合成データのスクリーンショットです。実サービスの画面、ロゴ、アカウント情報は含みません。

## ストア掲載 URL（デベロッパーコンソールに記入）

- Homepage: `https://github.com/ishizakahiroshi/many-ai-usage`（または `https://ishizakahiroshi.com/work.html?id=many-ai-usage`）
- Support: `https://ishizakahiroshi.com/articles/many-ai-usage/support.html`
- Privacy policy: `docs/privacy-policy.html` を公開した URL（submission notes 参照）
- Usage guide: `https://ishizakahiroshi.com/articles/many-ai-usage/usage.html`

## サポート運用（短く）

- Chrome ウェブストアのレビュー欄は公開評価であり、バグトラッカーではない。短く返信し、Support URL / 拡張の「不具合を報告」/ GitHub Issues へ誘導する
- Cookie・トークン・アカウントメール・ページ HTML・実利用量の貼付をユーザーに求めない
