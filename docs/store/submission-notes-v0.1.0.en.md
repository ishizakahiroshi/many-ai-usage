# Chrome Web Store submission notes (v0.1.0)

## Reviewer notes

v0.1.0 is the first release. It uses a browser-local teach flow: the user chooses a visible usage value and the extension reads that value locally on later visits.

- Register a visible value with Track this element
- Re-find it with a fingerprint if the selector changes
- Show Re-teach after three consecutive read failures
- Keep un-taught pages as link tiles instead of guessing values
- Start with zero providers; Try samples is an explicit opt-in action

## Permission changes

The extension uses `storage`, `tabs`, `scripting`, optional host access that the user grants for registered pages, and fixed host access to `https://raw.githubusercontent.com/ishizakahiroshi/*`.

The fixed GitHub raw permission is used only after the user confirms Try samples. It fetches the documented `providers.json` file containing display names and URL patterns. The response is schema-validated data, contains no executable code or selectors, and is never evaluated.

## Data handling

- No personal information, cookies, tokens, or account identifiers are collected
- Page HTML and browsing history are not sent externally
- There is no captured-data upload, external application server, or cloud sync
- Try samples sends a GET request with no credentials or user data to the documented public GitHub raw registry
- Settings and captured values stay in browser extension storage

## Test focus

- Load the extension and use Track this element on a registered page
- Change the page structure and verify fingerprint fallback and Re-teach
- Deny host access and verify the needs_permission card
- On an empty installation, open Try samples, cancel once, then confirm and verify six untaught provider tiles are added without duplicates
