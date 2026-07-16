# many-ai-usage Privacy Policy

Last updated: 2026-07-16

many-ai-usage reads visible usage information from usage pages that the user registers and opens in their own browser. Parsing is performed locally by the extension.

## Data collection

The extension does not collect, sell, or share personal information. It does not send page HTML, cookies, authentication tokens, account identifiers, browsing history, or normalized usage data to an external server.

The extension stores only provider settings, taught selectors/fingerprints, normalized snapshots, and diagnostic summaries in the browser's extension storage. Users can remove provider entries from the settings page.

## External communication

The extension has no cloud service and does not upload captured data. It performs read-only capture and does not submit forms, send chats, or change provider settings.

On first run, the extension does not contact provider pages or the sample registry. Only when the user confirms **Try samples** does it fetch this public JSON file:

`https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json`

That request retrieves display names and URL patterns only. It does not include cookies, authentication tokens, browsing history, page HTML, captured usage values, or other user data. The response is treated as data and is schema-validated; it is never executed as code.

## Permissions

- `storage`: store the local configuration and captured snapshots.
- `tabs` and `scripting`: find a registered usage page and run the local content script.
- Fixed GitHub raw host access: fetch the public URL-only sample registry after explicit confirmation.
- Optional host access: read the registered usage-page origin only after the user grants access.

## Changes

Changes to this policy will be recorded in this document.

日本語版は [docs/store/privacy-policy.ja.md](docs/store/privacy-policy.ja.md) を参照してください。
