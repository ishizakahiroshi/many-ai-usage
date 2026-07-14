# Chrome Web Store submission notes (v0.1.0)

## Reviewer notes

v0.1.0 is the first release. It uses a browser-local teach flow: the user chooses a visible usage value and the extension reads that value locally on later visits.

- Register a visible value with Track this element
- Re-find it with a fingerprint if the selector changes
- Show Re-teach after three consecutive read failures
- Keep un-taught pages as link tiles instead of guessing values

## Permission changes

No new permissions are added. The extension uses `storage`, `tabs`, `scripting`, and optional host access that the user grants for registered pages.

## Data handling

- No personal information, cookies, tokens, or account identifiers are collected
- Page HTML and browsing history are not sent externally
- There is no external server communication or cloud sync
- Settings and captured values stay in browser extension storage

## Test focus

- Load the extension and use Track this element on a registered page
- Change the page structure and verify fingerprint fallback and Re-teach
- Deny host access and verify the needs_permission card
