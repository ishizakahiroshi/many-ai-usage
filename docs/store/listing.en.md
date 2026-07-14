# Chrome Web Store listing draft

## Extension name

many-ai-usage

## Short description

See AI service usage in one browser-local dashboard without uploading your data.

## Detailed description

many-ai-usage reads the visible value that you choose on a registered usage page and brings several services into one small dashboard. Teach a value once with “Track this element”; later visits read that same value locally.

Key features:

- Teach a visible usage value with one click
- Re-find the value after page changes using a selector and fingerprint
- Show a Re-teach prompt after three consecutive read failures
- Keep un-taught pages as link tiles instead of guessing values

Privacy:

- No data is sent to an external server
- No cookies, tokens, page HTML, or account identifiers are collected
- Usage capture is read-only

Permissions:

- `storage`: store settings, taught selectors, and local snapshots
- `tabs` / `scripting`: find registered pages and run the local reader
- Optional host access: read only registered usage pages after the user grants access

Suggested category: Productivity

## Screenshot ideas

- Popup showing two taught service values
- Track this element highlight with the value preview tooltip
- Re-teach needed card and the options page taught metric list

Privacy policy: `docs/privacy-policy.html`
