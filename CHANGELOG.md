# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

No unreleased changes.

## [0.1.0] - 2026-07-14

### Added

- One-click teach mode for selecting an exact visible usage value.
- Selector and fingerprint fallback with local value extraction.
- Re-teach detection after three consecutive taught-read failures.
- Chrome and Firefox build artifacts with tag-driven GitHub Release packaging.

### Changed

- The legacy heuristic detector is retained as a regression reference but is not used by the v0.1 runtime.
- Provider settings and popup now expose Track/Re-teach actions and taught metric state.

### Fixed

- Prevented uncertain heuristic values from being written into the dashboard.
- Preserved `needs_teaching` state when snapshots become stale.
