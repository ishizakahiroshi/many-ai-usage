# Chrome Web Store listing draft

## Extension name

many-ai-usage

## Short description

See AI service usage in one browser-local dashboard without uploading your data.

## Detailed description

many-ai-usage reads the visible values that you choose on a registered usage page and brings several services into one small dashboard. Teach the values you need with “Track this element”; later visits read those same values locally.

Key features:

- Start empty, or explicitly fetch six URL-only examples with Try samples
- Open a dedicated picker tab and teach multiple visible usage values in one continuous session
- Rename or remove individual metrics and automatically associate nearby reset labels
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
- Fixed GitHub raw host access: fetch the documented URL-only sample registry only after the user confirms Try samples
- Optional host access: read only registered usage pages after the user grants access

Suggested category: Productivity

## Screenshot ideas

- `screenshot-dashboard.png`: dashboard with two taught provider values
- `screenshot-picker.png`: Track this element highlight with the value preview tooltip
- `screenshot-settings.png`: Re-teach needed card and the options page taught metric list

These images are synthetic-data screenshots generated from `docs/local/design_teach-mode-store-screens_2026-07-14.html`. They contain no real service UI, logos, or account information.

Privacy policy: `docs/privacy-policy.html`
