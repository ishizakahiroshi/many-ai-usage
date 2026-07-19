# Chrome Web Store submission notes (v0.1.0)

## Reviewer notes

v0.1.0 is the first release. It uses a browser-local teach flow: the user chooses a visible usage value and the extension reads that value locally on later visits.

- Track this element opens the registered provider URL in a new tab and injects the picker only into that new tab
- Add multiple visible values from the floating panel and commit them together with Done and return
- Cancel or Escape discards every change from the current teach session
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

## Support URL intent

Support points to `https://ishizakahiroshi.com/articles/many-ai-usage/support.html`. That page explains browser-local reporting (Settings → Report) and GitHub Issues. It is not a cloud ticket system and does not collect usage data. Store reviews remain public ratings only; structured bugs go to Issues.

## Test focus

- Load the extension and verify Track this element opens the provider page in a new tab
- With multiple existing tabs on the same URL, verify only the new tab receives the picker and multiple metrics can be saved continuously
- Change the page structure and verify fingerprint fallback and Re-teach
- Deny host access and verify the needs_permission card
- On an empty installation, open Try samples, cancel once, then confirm and verify six untaught provider tiles are added without duplicates
- Open Settings → Report a problem, copy a synthetic report, and confirm no cookies/usage numbers/URLs are auto-filled
