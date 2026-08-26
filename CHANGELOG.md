# Changelog

All notable changes to dsh-shipcheck.

## [0.4.0] - 2026-08-26

### Added

- `shipcheck_flow` for bounded real-browser journeys with navigate, click, fill, press, wait, wait-for, and assert steps.
- Per-step screenshots, redacted input evidence, stop-on-failure behavior, and final-page acceptance checks.
- Web panel flow mode with editable JSON steps and a local `/dsh-shipcheck/flow` endpoint.

## [0.3.0] - 2026-08-26

### Added

- Multi-route acceptance matrices for checking 1-20 URLs in one release gate.
- Independent route screenshots, JSON reports, and namespaced baselines with an aggregate matrix report.
- A local `/dsh-shipcheck/matrix` endpoint for the Web panel and other local clients.

## [0.2.0] - 2026-08-25

### Added

- Browser runtime telemetry for console errors, uncaught exceptions, console warnings, and failed/HTTP 4xx-5xx network requests.
- Runtime failures are saved as structured report evidence and fail `shipcheck_run` with concrete URLs, messages, and source locations.

## [0.1.0] - 2026-08-25

### Added

- Real-browser page inspection through dsh-pilot.
- Deterministic content, accessibility, layout, contract, and baseline checks.
- Named baselines, screenshots, JSON reports, recent-history tool, and a Web UI panel.
