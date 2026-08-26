# 🚢 dsh-shipcheck — evidence before ship

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![ci](https://github.com/guo6x/dsh-shipcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/guo6x/dsh-shipcheck/actions/workflows/ci.yml) · [中文说明](README.zh.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin

> A frontend is not ready because an agent says “looks good”. It is ready when a real browser produces evidence.

`dsh-shipcheck` is an evidence-first frontend release checker for DeepSeek Harness. It uses `dsh-pilot` to open the real page, then produces deterministic checks, screenshots, named baselines, and reproducible JSON reports. It does not edit the project or auto-dismiss failures. Its evidence format is designed to accept higher-level design judgments from `dsh-palate` in the next integration phase.

## Why this is different

Style libraries give an agent advice. Browser drivers give it hands. Shipcheck closes the delivery loop with facts first; a later palate integration can add design judgment without replacing the evidence:

```text
project URL → real browser → page evidence → deterministic checks → baseline diff → report with screenshot
```

The first version checks:

- page availability, title, visible body, and primary heading
- missing image alternative text and unnamed controls/links
- horizontal overflow at the captured viewport
- required/forbidden text and required CSS selectors
- structural regressions against an explicit named baseline
- browser runtime failures: console errors, uncaught exceptions, and failed/HTTP 4xx-5xx requests

Every failure includes concrete evidence. A baseline is only written by the explicit `shipcheck_baseline` tool; a normal run never changes the saved baseline.

## Tools

| Tool | Purpose |
|---|---|
| `shipcheck_run` | Inspect a URL in a real browser, run checks, compare a baseline, save a screenshot and JSON report |
| `shipcheck_matrix` | Inspect 1-20 URLs as one release gate; keep route-level screenshots, reports, failures, and baselines |
| `shipcheck_baseline` | Explicitly capture a reviewed URL as a named structural baseline |
| `shipcheck_history` | List recent reports and their pass/fail summaries |

The Web panel adds the same local-first flow: paste a development URL, click **验收**, then inspect the status, failed checks, screenshot path, and recent history.

## Install and run in 90 seconds

```sh
dsh plugin --profile web add github:guo6x/dsh-pilot
dsh plugin --profile web add github:guo6x/dsh-shipcheck
```

Restart `dsh web`, open the `🚢` button in the sidebar, and paste a local URL such as `http://127.0.0.1:3000`.

For an agent-driven run, ask:

> Run `shipcheck_run` on `http://127.0.0.1:3000` as project `checkout`, require the visible text `Checkout`, forbid `Something went wrong`, and tell me whether it is safe to continue manual review. Do not modify files.

After a human reviews a healthy page:

> Capture the current checkout page as the `checkout` shipcheck baseline with `shipcheck_baseline`. Then run `shipcheck_run` again and explain any structural regression with the evidence paths.

For a release with several important routes, ask:

> Run `shipcheck_matrix` for `http://127.0.0.1:3000/`, `http://127.0.0.1:3000/login`, and `http://127.0.0.1:3000/checkout` as matrix `checkout-release`. Require `Checkout` on every route, forbid `Something went wrong`, and report which route failed with its screenshot and JSON report path.

The matrix runs routes sequentially in one real browser session. Each route is saved as its own report and uses a generated baseline name under `<matrix-name>/<route-key>`, so the login page cannot overwrite the checkout page's baseline. The matrix report then aggregates all checks and includes a route-by-route summary.

The plugin stores local evidence under `$DSH_HOME/shipcheck/`:

```text
shipcheck/
├── artifacts/       # screenshots
├── baselines/       # explicit named baselines
└── reports/         # recent JSON reports, capped at 100
```

A matrix therefore uses up to 21 report entries for 20 routes: one aggregate report plus one report per route.

No API key, cloud dashboard, embedding service, or automatic project write is required. `dsh-pilot` is a separate profile-level companion because DSH blocks GitHub repositories nested inside plugin dependencies; Shipcheck gives a clear error if it is missing.

## Honest limits

- This is a release gate, not a full visual regression lab; the first baseline compares stable structure and text drift, not pixel-perfect screenshots across operating systems.
- The first release does not yet score the page with dsh-palate principles; it stores the evidence shape needed for that integration.
- Runtime telemetry uses the browser's CDP events. If the companion browser does not expose that capability, Shipcheck reports an explicit warning instead of pretending the runtime is clean.
- A passing automated run still needs human review for product semantics, content quality, and intentional exceptions.

## Develop

```sh
pnpm install
pnpm test
```

The core tests use fake evidence and do not require a browser. The real browser path is exercised when `shipcheck_run` or `shipcheck_matrix` is used in a DSH Web profile.

MIT licensed.
