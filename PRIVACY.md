# many-ai-usage Privacy Policy

Last updated: 2026-08-23

many-ai-usage reads visible usage information from usage pages that the user registers and opens in their own browser. Parsing is performed locally by the extension.

## Data collection

The extension does not collect, sell, or share personal information. It does not send page HTML, cookies, authentication tokens, account identifiers, browsing history, or normalized usage data to an external server.

The extension stores only provider settings, taught selectors/fingerprints, normalized snapshots, and diagnostic summaries in the browser's extension storage. Users can remove provider entries from the settings page.

For optional multi-account matching, it stores a text-free numeric DOM path to the identity element and a per-install salted hash of its text. The email address or display name itself is used transiently for hashing and is never stored or logged.

## External communication

The extension has no cloud service and does not upload captured data. It performs read-only capture and does not submit forms, send chats, or change provider settings.

On first run, the extension does not contact provider pages or the starter source. Only when the user confirms **Try samples** does it fetch this public JSON file:

`https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/starter.json`

That request retrieves public configuration: display names, URL patterns, optional reviewed taught selectors/fingerprints, and sample letter-badge icon URLs. Icons are fetched once from the same fixed GitHub raw host. Neither request includes cookies, authentication tokens, browsing history, page HTML, account identity text, captured usage values, or other user data. Responses are bounded and schema-validated data; they are never executed as code.

## Permissions

- `storage`: store the local configuration and captured snapshots.
- `tabs` and `scripting`: find a registered usage page and run the local content script.
- Fixed GitHub raw host access: fetch the public starter configuration and its sample letter-badge icons after explicit confirmation.
- Optional host access: read the registered usage-page origin only after the user grants access.

## Changes

Changes to this policy will be recorded in this document.

日本語版は [docs/store/privacy-policy.ja.md](docs/store/privacy-policy.ja.md) を参照してください。
