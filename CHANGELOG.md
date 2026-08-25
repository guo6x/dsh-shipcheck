# Changelog

All notable changes to dsh-shipcheck.

## [0.2.0] - 2026-08-25

### Added

- Browser runtime telemetry for console errors, uncaught exceptions, console warnings, and failed/HTTP 4xx-5xx network requests.
- Runtime failures are saved as structured report evidence and fail `shipcheck_run` with concrete URLs, messages, and source locations.

## [0.1.0] - 2026-08-25

### Added

- Real-browser page inspection through dsh-pilot.
- Deterministic content, accessibility, layout, contract, and baseline checks.
- Named baselines, screenshots, JSON reports, recent-history tool, and a Web UI panel.
