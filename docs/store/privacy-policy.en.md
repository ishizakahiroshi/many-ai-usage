# Privacy Policy

Last updated: 2026-07-16

many-ai-usage does not collect, store, sell, or share personal information.

## Information we do not collect

We do not collect cookies, credentials, tokens, account identifiers, browsing history, page HTML, form input, or usage data for external processing.

## External communication

The extension has no cloud service and does not upload captured data. Reading and parsing registered usage pages happens entirely in the user's browser.

On first run, no provider page or sample registry is contacted. Only after the user confirms **Try samples** does the extension fetch the public URL-only registry at `raw.githubusercontent.com/ishizakahiroshi/many-ai-cli`. The request sends no cookies, tokens, browsing history, page HTML, captured values, or other user data. The JSON response is schema-validated and is not executed as code.

## Information stored locally

The extension stores provider settings, taught selectors/fingerprints, normalized snapshots, and diagnostic summaries in the browser's extension storage. This information is not sent outside the browser.

## Permissions

- `storage`: store local settings and snapshots
- `tabs` / `scripting`: find registered pages and run the local reader
- Fixed GitHub raw host access: fetch URL-only samples after explicit confirmation
- Optional host access: read registered usage pages after the user grants access

## Changes

Changes to this policy will be recorded in this document.
