# many-ai-usage v0.1.0

v0.1.0 makes teach-mode the safe default for exact usage values: the extension opens a dedicated provider tab, the user selects one or more visible values, and later reads stay browser-local. The heuristic detector remains only as a regression reference and never writes an uncertain value.

## Added

- Continuous Track this element picker for teaching multiple metrics in one session
- Dedicated new provider tab with automatic return to the originating options tab
- Metric rename/remove controls and automatic nearby reset-label anchoring
- Taught value extraction and local snapshots
- Re-teach prompt after three consecutive failures
- Chrome ZIP and Firefox XPI packaging in the tag-driven release workflow
- Opt-in Try samples onboarding for six URL-only examples from the documented GitHub raw registry

## Changed

- Popup and options now expose taught metrics and page-tile fallback
- New installations start with zero providers and make no provider-page request until the user adds or imports one
- Picker previews prioritize percentages and unit-bearing values while excluding four-digit years and reset dates
- Privacy documentation and store submission notes are available in Japanese and English

## Fixed

- Avoided persisting heuristic false positives as usage values
- Preserved `needs_teaching` while a taught snapshot is stale
- Prevented reset years such as `2026` from appearing as percentage candidates

## Package

- Chrome Web Store package: `many-ai-usage-v0.1.0-chrome.zip`
- Firefox AMO package: `many-ai-usage-v0.1.0-firefox.xpi`
- SHA-256: generated as `SHA256SUMS.txt` by `.github/workflows/release.yml`

## Integrity check

```powershell
Get-FileHash .\many-ai-usage-v0.1.0-chrome.zip -Algorithm SHA256
Get-FileHash .\many-ai-usage-v0.1.0-firefox.xpi -Algorithm SHA256
```
