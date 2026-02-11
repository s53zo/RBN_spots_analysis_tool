# Plan: RBN Signal Analysis Spin-Off Webpage

**Generated**: 2026-02-11
**Estimated Complexity**: High

## Overview
Build a standalone static webpage focused only on RBN signal analysis, using the same core behavior as SH6 `rbn_compare_signal`:
- User picks 1-2 UTC dates.
- User enters one primary callsign.
- User optionally enters up to 3 comparison callsigns.
- User clicks `Start analysis`.
- App fetches RBN data for each call and renders SH6-style signal graphs (spotter-selected, continent cards, per-band points, trendlines, canvas rendering).
- Input dates are global across all callsigns.
- Graph presentation is SH6-style overlaid comparison traces.
- Analysis proceeds even if one or more comparison calls fail or return empty data.

The implementation will reuse and isolate proven logic from `../SH6/main.js` for:
- RBN fetch + normalization
- compare-signal index build
- canvas graph rendering
- redraw lifecycle (RAF + resize/intersection observers)

## Locked Product Decisions
- Date model: one shared date range (1-2 UTC dates) for every callsign in the run.
- Compare model: one combined comparative graph system (not per-callsign isolated dashboards).
- Failure model: partial success allowed; failed slots are reported while successful slots still render.

## UI/UX Contract (Applied From Start)
- Dashboard direction: `Comparative Analysis Dashboard` visual pattern (from `ui-ux-pro-max-skill`) with analysis-first layout.
- Responsive strategy: mobile-first with tested targets at 375, 768, 1024, 1440 widths.
- Layout rules:
  - no horizontal scroll on mobile
  - fluid containers and consistent max-width
  - cards stack on mobile and become multi-column on tablet/desktop
- Interaction rules:
  - minimum touch target 44x44px
  - all clickable elements have visible hover/focus/active states
  - `Start analysis` button disabled during async runs
- Accessibility rules:
  - visible focus rings
  - labels for all inputs
  - color contrast >= 4.5:1 for body text
  - `prefers-reduced-motion` respected
- Motion rules: micro-transitions in 150-300ms range; avoid heavy decorative animation.
- Delivery checks:
  - no emoji-based UI icons
  - consistent icon set
  - clear loading/error/empty states
  - table/text alternative available for chart data summary

## Prerequisites
- GitHub Pages static hosting (already enabled for this repo)
- Browser support for `fetch`, `ResizeObserver`, `IntersectionObserver`, `requestAnimationFrame`
- Access to RBN proxy endpoint used in SH6: `https://azure.s53m.com/cors/rbn`

## Sprint 1: Standalone App Skeleton
**Goal**: Create a clean standalone UI with the target workflow and deterministic app state.
**Demo/Validation**:
- Open `index.html`
- Fill date(s)/callsigns
- See validation status and disabled/enabled Analyze button transitions

### Task 1.0: Define Design Tokens and Responsive Foundation
- **Location**: `styles.css`, `index.html`
- **Description**: Establish baseline visual system before component work:
  - color tokens, spacing scale, type scale, radii, shadow levels
  - mobile-first grid/container and breakpoint rules
  - focus, disabled, and error state primitives
- **Dependencies**: None
- **Acceptance Criteria**:
  - Tokenized styles used instead of scattered one-off values
  - Viewport meta present and base typography readable on mobile
  - Keyboard focus ring and reduced-motion baseline in place
- **Validation**:
  - Manual checks at 375/768/1024/1440

### Task 1.1: Build Input Workflow UI
- **Location**: `index.html`, `styles.css`
- **Description**: Create sections for:
  - Date picker for up to 2 dates
  - Primary callsign input
  - Up to 3 optional comparison callsign inputs
  - `Start analysis` button
  - Status row for loading/error/qrx
  - Graph container region
- **Dependencies**: None
- **Acceptance Criteria**:
  - Max 2 dates enforceable in UI
  - Date selection applies globally to all callsigns in run
  - Callsign fields clearly labeled (Primary, Compare 1-3)
  - Mobile and desktop layout are usable without horizontal scroll
  - All interactive controls meet 44x44 touch target minimum
- **Validation**:
  - Manual UI test in browser

### Task 1.2: Introduce App State + Input Validation
- **Location**: `app.js`
- **Description**: Add centralized state model:
  - selected dates
  - callsign slots A/B/C/D
  - per-slot load status
  - overall analysis state
- **Dependencies**: Task 1.1
- **Acceptance Criteria**:
  - Invalid inputs prevent analysis
  - Callsigns normalized consistently (uppercase/trim)
  - State resets cleanly between runs
  - Partial-slot errors represented in state without aborting successful slots
- **Validation**:
  - Manual checks with empty/invalid/valid combinations

## Sprint 2: Data Layer Extraction (SH6-Compatible)
**Goal**: Port and isolate SH6 RBN data fetching and normalization.
**Demo/Validation**:
- Trigger analysis for one callsign and two dates
- Confirm fetched spot totals and normalized shapes in debug output

### Task 2.1: Implement RBN Fetch Client
- **Location**: `src/rbn-api.js` (or `rbn-api.js` if no `src/`)
- **Description**: Port `fetchRbnSpots()` behavior from SH6:
  - `call` + `days` params
  - `cache: no-store`
  - 404 empty handling
  - 429 retry metadata
  - structured error messages
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - Request URL format matches SH6 behavior
  - Error/status handling mirrors SH6 outcomes
- **Validation**:
  - Manual network inspection and simulated error cases

### Task 2.2: Port Spot Normalization + Dataset Shaping
- **Location**: `src/rbn-normalize.js`
- **Description**: Port/adapt `normalizeRbnSpot()` and related shaping for:
  - `ofUsSpots`
  - `byUsSpots` (store but graphing can focus on `ofUsSpots`)
- **Dependencies**: Task 2.1
- **Acceptance Criteria**:
  - Normalized records include timestamp, band, SNR, spotter metadata
  - Invalid records are discarded safely
- **Validation**:
  - Console sanity checks on sampled records

### Task 2.3: Multi-Call Fetch Orchestrator
- **Location**: `app.js`, `src/rbn-orchestrator.js`
- **Description**: Add run-level orchestration:
  - Primary call => slot A
  - Optional compares => slots B/C/D
  - Parallel fetches with per-slot status
  - Aggregate completion and error reporting
- **Dependencies**: Task 2.2
- **Acceptance Criteria**:
  - One-click analysis runs all active calls
  - Partial failures surface clearly without crashing the run
  - Successful slots continue to graph even when other slots fail
- **Validation**:
  - Manual run with 1, 2, and 4 total calls

## Sprint 3: Graph Engine Port (SH6-Style)
**Goal**: Recreate SH6 compare-signal charts in standalone context.
**Demo/Validation**:
- Graphs render for loaded data with visually equivalent style and behavior
- Spotter selection updates chart without full page reload

### Task 3.1: Port Compare-Signal Index Build
- **Location**: `src/rbn-compare-index.js`
- **Description**: Port/adapt:
  - index cache structures
  - spotter ranking
  - `bySpotter` + `byBand` arrays
  - async build scheduling (`requestIdleCallback` fallback)
- **Dependencies**: Task 2.3
- **Acceptance Criteria**:
  - Indexes generated per slot and reusable between redraws
  - Rebuild triggered only when input data changes
- **Validation**:
  - Debug counters for build invocations and cache hits

### Task 3.2: Port Canvas Renderer
- **Location**: `src/rbn-canvas.js`
- **Description**: Port/adapt `drawRbnSignalCanvas()`:
  - axes/grid/ticks
  - scatter points by band + slot
  - trendlines (p75 buckets)
  - downsampling and alpha/jitter behavior
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - Canvas output follows SH6 visual semantics
  - Handles dense datasets without freezing
  - Comparative traces remain visually distinguishable on small screens
- **Validation**:
  - Compare same query side-by-side with SH6 output

### Task 3.3: Wire Spotter Select + Observers
- **Location**: `app.js`
- **Description**: Implement interactions like SH6:
  - per-continent spotter dropdown
  - RAF redraw scheduling
  - resize + intersection observers
- **Dependencies**: Task 3.2
- **Acceptance Criteria**:
  - Graph updates on selection/resize/visibility changes
  - Off-screen canvases are deferred
  - Spotter controls remain touch-friendly and keyboard-accessible
- **Validation**:
  - Manual viewport/resize tests

## Sprint 4: UX Hardening and Output Clarity
**Goal**: Make the page robust and user-complete for real analysis use.
**Demo/Validation**:
- Full run with realistic callsigns/dates and stable status messaging

### Task 4.1: Add Robust Status and Retry UX
- **Location**: `app.js`, `index.html`
- **Description**: Surface states clearly:
  - loading
  - built
  - qrx/rate-limited with retry countdown
  - empty/no data
  - hard error
- **Dependencies**: Task 3.3
- **Acceptance Criteria**:
  - User always sees current run status and next action
  - Per-slot status indicates loaded/empty/error so user understands partial results
- **Validation**:
  - Force rate-limit/error simulation paths

### Task 4.2: Add Run Summary and Export-Ready Metadata
- **Location**: `index.html`, `app.js`
- **Description**: Show concise summary:
  - date window
  - calls analyzed
  - per-slot spot counts
  - selected spotter per continent
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - Summary matches current rendered graph data
- **Validation**:
  - Manual cross-check against fetched totals

## Sprint 5: Release and Regression Safety
**Goal**: Ship on Pages with repeatable checks.
**Demo/Validation**:
- Public URL works with full flow end-to-end

### Task 5.1: Add Lightweight Regression Fixtures
- **Location**: `test/` (or script-based checks)
- **Description**: Add deterministic checks for:
  - date/callsign validation
  - normalization invariants
  - index build outputs for fixture sample
- **Dependencies**: Task 4.2
- **Acceptance Criteria**:
  - Test script runs locally and catches common regressions
- **Validation**:
  - Run test command and verify pass/fail behavior

### Task 5.2: Deploy Confirmation on GitHub Pages
- **Location**: repository root
- **Description**: Push finalized static files and verify Pages live output.
- **Dependencies**: Task 5.1
- **Acceptance Criteria**:
  - Public page loads and executes analysis workflow
- **Validation**:
  - Manual check of live URL and console/network health

## Testing Strategy
- Manual scenario tests:
  - 1 date + 1 callsign
  - 2 dates + 1 callsign
  - 2 dates + 4 callsigns
  - invalid callsign/date combinations
  - empty/no-data callsign
  - rate-limited response
- Responsive and accessibility checks:
  - 375/768/1024/1440 viewport verification
  - no horizontal overflow
  - keyboard-only navigation through all controls
  - focus visibility and contrast checks
  - touch target spot-check >= 44x44
- Deterministic utility checks for normalization/indexing/output shape.
- Visual parity checks against SH6 for identical query input.

## Potential Risks & Gotchas
- Proxy/API limits can throttle multi-call runs; need clear retry/backoff UX.
- SH6 logic is currently monolithic; extraction must avoid hidden dependencies.
- Visual parity can drift if sampling or trendline math changes subtly.
- Different calls can have sparse/non-overlapping spotters; selector defaults must be resilient.
- Browser performance may degrade on large point clouds without strict caps.

## Rollback Plan
- Keep graph engine behind a feature flag while integrating.
- If regression appears, fall back to:
  - single-call mode only
  - reduced point density
  - minimal chart rendering path
- Revert to previous stable commit and redeploy Pages.
