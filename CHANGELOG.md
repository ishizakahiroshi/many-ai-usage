# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Opt-in **Try samples** onboarding for six URL-only provider examples fetched from the documented GitHub raw registry.
- Empty-state links to the Japanese usage guide in the popup and options page.

### Changed

- New installations now start with zero providers; no provider definitions are bundled or seeded automatically.

## [0.1.0] - 2026-07-14

### Added

- One-click teach mode for selecting an exact visible usage value.
- Continuous teach mode for adding, renaming, and removing multiple metrics in one picker session.
- Automatic nearby reset-label anchoring for taught metrics.
- Selector and fingerprint fallback with local value extraction.
- Re-teach detection after three consecutive taught-read failures.
- Chrome and Firefox build artifacts with tag-driven GitHub Release packaging.

### Changed

- The legacy heuristic detector is retained as a regression reference but is not used by the v0.1 runtime.
- Provider settings and popup now expose Track/Re-teach actions and taught metric state.
- Track/Re-teach always opens a dedicated provider tab and returns to the originating tab when teaching finishes.

### Fixed

- Prevented uncertain heuristic values from being written into the dashboard.
- Preserved `needs_teaching` state when snapshots become stale.
- Excluded four-digit years and reset-date numbers from picker candidates, with percentage and unit-bearing values prioritized.
