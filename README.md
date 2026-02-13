# RBN Spots Analysis Tool

Web app for historical, live, and skimmer-focused analysis of Reverse Beacon Network spots.

Live app: https://s53m.com/RBN/

## Architecture Overview

This project is a static frontend app (no local backend process required):

- `index.html`: page structure and chapter layouts (Historical, Live, Skimmer).
- `styles.css`: visual styling and responsive behavior.
- `app.mjs`: main UI/controller layer:
  - reads form inputs,
  - runs analyses,
  - renders charts,
  - handles retries, status semaphores, and permalinks.
- `src/rbn-orchestrator.mjs`: chapter-specific orchestration and slot execution flow.
- `src/rbn-api.mjs`: RBN fetch client with timeout and HTTP 429 handling.
- `src/cty-lookup.mjs`: `cty.dat` loading/parsing and callsign geo metadata lookup.
- `src/rbn-canvas.mjs`: chart drawing primitives and styling logic.
- `tests/`: test suite for core data/transformation logic.

High-level flow:

1. User sets callsigns/time/scope in one chapter.
2. `app.mjs` builds a normalized input model.
3. Orchestrator fetches spot data per slot via `src/rbn-api.mjs`.
4. `cty.dat` metadata enriches scope/geo filtering.
5. Aggregated results are rendered in chart + summary UI.
6. Current UI+chart state can be captured as a permalink.

## Permalinks And Upgrade Safety

Permalinks are generated as:

- Base URL: `https://s53m.com/RBN/`
- Query params:
  - `pl`: permalink format version (`v2` currently)
  - `cfg`: Base64URL-encoded JSON payload

Implementation details:

- `PERMALINK_VERSION = "v2"` in `app.mjs`.
- `buildPermalinkPayload()` builds a canonical full UI state (`schema: "v1"` internal shape).
- `compactCanonicalPermalinkPayload()` shrinks canonical state into short-key format for URLs.
- `parsePermalinkPayloadFromUrl()` supports both `v1` and `v2` and expands `v2` back to canonical state.

What is replayed:

- Active chapter.
- Inputs for all 3 chapters (not only current chapter).
- Chart UI state per chapter:
  - selected bands,
  - selected station/continent mapping,
  - zoom range(s).

Why this is future-upgrade safe:

- Versioned query format (`pl`) allows adding `v3+` without breaking old links.
- `v2` parser expands to canonical `schema: "v1"` model before applying to UI.
- Unknown/missing keys degrade gracefully to defaults.

## External Dependencies And Proxies

The app relies on external data feeds and CORS-safe proxy routes:

- RBN spots API:
  - frontend target: `https://azure.s53m.com/cors/rbn`
  - configured in `src/rbn-api.mjs` (`RBN_PROXY_URL`)
- `cty.dat` prefix database:
  - primary: `https://azure.s53m.com/cors/cty.dat`
  - fallback: `https://www.country-files.com/cty/cty.dat`
  - additional local file fallbacks remain in loader order
- SM7IUN skimmer statistics CSV (for callsign catalog):
  - frontend target: `https://azure.s53m.com/cors/sm7iun-statistics.csv`
  - this avoids browser CORS blocking from static origins

Operational note:

- Proxy routing/CORS headers are provided by nginx on `azure.s53m.com` (containerized nginx service).
- If upstreams are reachable but browser still fails, check proxy response headers first.

## Troubleshooting

### CORS errors for external datasets

Symptoms:

- Browser console errors like blocked `Fetch API` due to `Access-Control-Allow-Origin`.

Fix:

1. Confirm frontend uses `https://azure.s53m.com/cors/...` endpoints (not direct upstream URL).
2. Verify proxy endpoint manually (status + CORS headers).
3. If needed, update nginx proxy config and restart nginx service.

### Rate limit messages (`HTTP 429`)

Symptoms:

- UI shows messages like: `Rate limited, will auto retry in ~15s`.

Behavior:

- Historical, Live, and Skimmer chapters each implement automatic retry countdown logic.
- Retries are attempted up to configured max attempts per chapter.
- If retries are exhausted, UI reports auto-retry limit reached.

### Scope/filter results look unexpected

Checks:

1. Validate scope mode (`GLOBAL`, `DXCC`, `CQ`, `ITU`, `CALLSIGN`) and value format.
2. Confirm `cty.dat` semaphore is green; scope matching depends on it.
3. For `DXCC`, verify prefix/country exists in `cty.dat` parser output.

### Permalink does not replay expected state

Checks:

1. Confirm URL includes both `pl` and `cfg`.
2. Ensure `pl` is supported (`v1` or `v2`).
3. If link was edited manually, malformed Base64URL/JSON will be ignored and defaults will load.
