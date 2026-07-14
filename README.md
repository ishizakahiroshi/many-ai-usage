# many-ai-usage

many-ai-usage is a Manifest V3 Chrome/Firefox extension that shows visible AI subscription usage in one browser-local dashboard.

## Privacy model

- Usage pages are read in the user's existing browser session.
- DOM parsing happens locally in the content script.
- Cookies, tokens, account identifiers, raw HTML, and usage data are not sent to a server or stored as raw data.
- The extension performs read-only page capture. It does not submit forms, send chats, or change provider settings.
- Host access is requested per registered usage-page origin.

## Development

```text
pnpm install
pnpm test
pnpm run typecheck
pnpm run build:chrome
pnpm run build:firefox
```

Load `dist/chrome` or `dist/firefox` as an unpacked extension after building.

The v0.1 MVP uses a one-click teach flow: choose the exact visible usage value on a provider page, then the extension stores a local selector and fingerprint and reads that value on later visits. Providers that have not been taught remain page tiles. The legacy heuristic detector remains as a regression-tested reference module but is not invoked by the v0.1 runtime, so it can never write an uncertain value.

## Privacy and license

See the [privacy policy](PRIVACY.md) for the local-only data handling details. This project is released under the [MIT License](LICENSE).
