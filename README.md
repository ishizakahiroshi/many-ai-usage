# many-ai-usage

many-ai-usage is a Manifest V3 Chrome/Firefox extension that shows visible AI subscription usage in one browser-local dashboard.

## Privacy model

- Usage pages are read in the user's existing browser session.
- DOM parsing happens locally in the content script.
- Cookies, tokens, account identifiers, raw HTML, and usage data are not sent to a server or stored as raw data.
- The extension performs read-only page capture. It does not submit forms, send chats, or change provider settings.
- Host access is requested per registered usage-page origin.
- The extension starts with zero providers and makes no provider-page requests on first run.
- Only when the user confirms **Try samples** does the extension fetch URL-only sample data from the documented GitHub raw registry. Captured usage data is never included in that request.

## Getting started

1. Open the options page.
2. Choose **Try samples ▸** to fetch six URL-only examples, or add your own usage page.
3. Open a registered page and use **Track this element** to teach the exact visible value.

The sample registry is data, not executable code:

`https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json`

See the [Japanese usage guide](https://ishizakahiroshi.github.io/articles/many-ai-usage/usage.html) for the practice page and service-by-service navigation recipes.

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
