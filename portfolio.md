---
schemaVersion: 1
color: "#4a8fc9"
initials: "mu"
cat:
  ja: "ブラウザ拡張 / Chrome + Firefox"
  en: "Browser Extension / Chrome + Firefox"
tagline:
  ja: "複数の AI サブスクの残枠を、1 画面で。ログインしたまま、ブラウザ内だけで完結。"
  en: "See every AI subscription's remaining quota in one view — all inside your browser, no accounts."
short:
  ja: "複数の AI サブスクの使用量（残枠・レート）を 1 画面で一覧するブラウザ拡張。"
  en: "A browser extension that shows every AI subscription's remaining quota on a single dashboard."
tech: ["TypeScript", "WebExtension", "Manifest V3", "Chrome", "Firefox"]
store: null
live: null
guide: "https://ishizakahiroshi.com/articles/many-ai-usage/usage.html"
featured: true
features:
  - icon: "▦"
    title: { ja: "1 画面で一覧", en: "One-view dashboard" }
    desc:  { ja: "Claude / ChatGPT / Grok / Gemini / Copilot / Cursor などの残枠を 1 タブに集約。", en: "Aggregate remaining quota for Claude/ChatGPT/Grok/Gemini/Copilot/Cursor into one tab." }
  - icon: "✓"
    title: { ja: "クリックで教える teach-mode", en: "Teach by one click" }
    desc:  { ja: "usage ページの数値を 1 回クリックするだけで登録。プロバイダ知識は同梱せずユーザー側に開く。", en: "Click a number on the usage page once to register it — no bundled provider knowledge." }
  - icon: "⚑"
    title: { ja: "ブラウザ内で完結", en: "Fully in-browser" }
    desc:  { ja: "ページ HTML を外部 AI に送らず、サーバー・アカウント・クラウド同期は無し。", en: "Page HTML never leaves your browser. No server, no account, no cloud sync." }
---
## ja

Claude / ChatGPT / Grok / Gemini / GitHub Copilot / Cursor など複数の AI サービスの残枠・レート上限を、1 画面のダッシュボードで一覧できるブラウザ拡張（Manifest V3・Chrome / Firefox ハイブリッド）です。プロバイダ定義は同梱せず、ユーザーが usage ページで数値を 1 回クリックして教える teach-mode（CSS selector + DOM fingerprint を保存）を主経路にしています。解析はブラウザ内のみで、ページ HTML を外部 AI に送らず、サーバー・アカウント・クラウド同期もありません。

## en

A Manifest V3 browser extension (Chrome/Firefox hybrid) that shows the remaining rate limits of multiple AI subscriptions — Claude, ChatGPT, Grok, Gemini, GitHub Copilot, Cursor, and more — on a single dashboard. Providers are not bundled: users teach the extension by clicking a number on the usage page once (a CSS selector and DOM fingerprint are stored). Everything runs in the browser — no server, no account, no cloud sync.
