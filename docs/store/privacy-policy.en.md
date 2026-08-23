# Privacy Policy

Last updated: 2026-08-23

many-ai-usage does not collect, store, sell, or share personal information.

## Information we do not collect

We do not collect cookies, credentials, tokens, account identifiers, browsing history, page HTML, form input, or usage data for external processing.

## External communication

The extension has no cloud service and does not upload captured data. Reading and parsing registered usage pages happens entirely in the user's browser.

On first run, no provider page or starter source is contacted. Only after the user confirms **Try samples** does the extension fetch `https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/starter.json`. It contains public configuration: display names, URL patterns, optional reviewed taught selectors/fingerprints, and sample letter-badge icon URLs. Icons are fetched once from the same fixed host. Requests send no cookies, tokens, browsing history, page HTML, identity text, captured values, or other user data. Responses are bounded and schema-validated and are not executed as code.

## Information stored locally

The extension stores provider settings, taught selectors/fingerprints, normalized snapshots, and diagnostic summaries in the browser's extension storage. This information is not sent outside the browser.

When one service is registered with several accounts, the extension also stores where the account identity sits on the page as a text-free numeric DOM path and a hash of that text, so a refresh can tell the entries apart. **The identity text itself — an email address, for example — is used transiently for hashing, never stored, and never written to logs.** The hash is salted with a value generated randomly per install, so hashes cannot be correlated across browsers or installs.

## Permissions

- `storage`: store local settings and snapshots
- `tabs` / `scripting`: find registered pages and run the local reader
- Fixed GitHub raw host access: fetch public starter configuration and sample letter-badge icons after explicit confirmation
- Optional host access: read registered usage pages after the user grants access
- Optional `contextualIdentities` / `cookies` (Firefox only, opt-in): open a registered usage page inside a chosen container so each account can be read on its own. Used only to list container names and to open tabs in them; cookie values are never read or written

## Changes

Changes to this policy will be recorded in this document.
