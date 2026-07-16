# many-ai-usage v0.1.0

v0.1.0 makes teach-mode the safe default for exact usage values: the user selects a visible value once, and later reads stay browser-local. The heuristic detector remains only as a regression reference and never writes an uncertain value.

## Added

- Track this element picker with selector and fingerprint fallback
- Taught value extraction and local snapshots
- Re-teach prompt after three consecutive failures
- Chrome ZIP and Firefox XPI packaging in the tag-driven release workflow
- Opt-in Try samples onboarding for six URL-only examples from the documented GitHub raw registry

## Changed

- Popup and options now expose taught metrics and page-tile fallback
- New installations start with zero providers and make no provider-page request until the user adds or imports one
- Privacy documentation and store submission notes are available in Japanese and English

## Fixed

- Avoided persisting heuristic false positives as usage values
- Preserved `needs_teaching` while a taught snapshot is stale

## Package

- Chrome Web Store package: `many-ai-usage-v0.1.0-chrome.zip`
- Firefox AMO package: `many-ai-usage-v0.1.0-firefox.xpi`
- SHA-256: generated as `SHA256SUMS.txt` by `.github/workflows/release.yml`

## Integrity check

```powershell
Get-FileHash .\many-ai-usage-v0.1.0-chrome.zip -Algorithm SHA256
Get-FileHash .\many-ai-usage-v0.1.0-firefox.xpi -Algorithm SHA256
```
