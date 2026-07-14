# Chrome Web Store 提出文書（v0.1.0）

## 審査担当者向けメモ

v0.1.0 は初回リリースです。ユーザーが利用状況ページ上の値を選択して教える teach-mode を中心に、ブラウザ内だけで読み取りを行います。

- Track this element で表示中の値を登録
- selector が壊れた場合は fingerprint で再探索
- 3 回連続で読めない場合は Re-teach を表示
- 教えていないページは値を推測せずリンクタイルにする

## 権限に関する変更

新しい権限の追加はありません。`storage`、`tabs`、`scripting` とユーザーが許可する optional host access のみを利用します。

## データ取り扱い

- 個人情報、Cookie、トークン、アカウント識別子を収集しません
- ページ本文や閲覧履歴を外部へ送信しません
- 外部サーバー通信とクラウド同期はありません
- 設定と読み取り結果はブラウザの拡張機能ストレージに保存します

## テスト観点

- 拡張機能を読み込み、登録ページで Track this element を実行
- ページ更新後の fingerprint fallback と Re-teach 導線を確認
- 権限を拒否した場合に needs_permission が表示されることを確認
