# Implementation plan — Solar UI redesign (Electron desktop)

**Status: PLAN ONLY. Not authorized, nothing executed.** No source, test, dependency, schema, packaging or contract file has been or will be changed by this document. Implementation starts only when the owner says "implement" for a named slice (section 9).
**Date:** 2026-11-08. **Revised after two rounds of independent read-only review** (reviewer-claude: four first-round reviews of foundations and startup, screens, Settings and verification, and the decision documents; two second-round re-checks); every confirmed finding is incorporated.
**Governing documents:** `docs/design/redesign/BRIEF.md` (Part A, with the 2026-11-08 owner-decision amendments), `OWNER-DECISIONS.md` (decisions D01–D23, findings F1–F6, mockup divergences), `COPY-APPROVALS.md` (wording), `SOLAR_UI_REDESIGN_PLAN.md` (Part B gap audit, B5 test contracts, Approach step 8, Verification "Later implementation acceptance"). Where an approved mockup and a recorded decision differ, the decision governs.
**Built from:** the 2026-11-08 read-only survey of the current source and the decision analyses, then corrected against source by the reviews. Line numbers are approximate (about ±10); **re-read and resolve references with the language server before editing any exported symbol.**

## 1. Scope

**In scope:** the desktop renderer, including the five approved Settings and startup behaviours: foundations, shell and startup, Overview, History, Usage & Cost, Data Quality, Settings, and the approved mark in the chrome brand slot.
**Out of scope and gated (no work scheduled):** web and native clients (R-client, D20); the cloud stopgap (A12.13 contract); `requestRecalculation` (D06); R-brand-package (D19); the main-process window-creation ordering (finding F1); forget-outcome reporting (D08, F2); an in-app flow-animation pause control (F4); any new GraphQL operation, field selection or backend change.
**Non-negotiable invariants (P1):** accounting, pricing, raw values and GraphQL operations unchanged; LiveStatus 10 s and CollectorStatus 30 s, no new timers; freshness thresholds; role gating; connection epochs; pagination semantics; Electron security boundaries (CSP, sandbox, pinning, safeStorage, main-process policy). Preload, `ipc.ts`, `policy.ts`, `security.ts`, `main/index.ts` and the contracts package are not modified by any work package below.

## 2. Ground truth from the survey and the reviews

- **Stack:** Electron 44.7.2, electron-vite 6, Vite 8.3.4, React 19.3.1, Tailwind 4.3.3, Base UI 1.9.0, TanStack Query 5.104.3, ECharts 6.1.0, vitest 5.0.4 with jsdom 30; Node `>=24.11` (global `WebSocket` available). Gate commands: `npm run typecheck -w apps/desktop` (tsc node + web) and `npm test -w apps/desktop` (`vitest run`). Desktop has no lint, format or CI script and no vitest config (jsdom is chosen per file by pragma). Last recorded gate result (2026-10-30): typecheck exit 0, 16 files and 102 tests; **recount at baseline, do not copy.**
- **Already done (Part C):** S1 (stale grayscale without opacity), S2 (global `:focus-visible` outline, `--focus` #e5e5e5), S3 (`--control-edge` border token), S4 (billing-period date hint). Rendered verification of S1–S4 was partial (2026-10-30).
- **Harness:** `captures/local/ui-audit/harness` (Vite on port 5199, fake bridge, scenarios admin, no-data, reconnecting, first-run, auth-failed, tls-mismatch) exists **only locally: `captures/local/` is gitignored.** It rejects every mutation (`fixtures.ts`: `/^(Create|Set|Upsert|Add|Delete)/` returns "harness: read-only") and records no calls, so success, reset-after-success and false-delete states cannot be drawn yet (WP0.3). Verification scripts added there are local tooling, not repository content.
- **Verification gaps:** no real-browser or CDP driver in the lockfile; `FakeBridge` has no call timestamps; no spec asserts request cadence, closed-category silence, the A16 invalidation set, draft behaviour at connection boundaries, real chart instance counts, media-query styles, startup font failure or security-boundary modules; the packaged build is never inspected.
- **Contracts:** 27 operations (17 queries, 10 mutations) in `packages/contracts/src/index.ts`; that `OPERATIONS` map is also the main-process allow-list (`ipc.ts:9-11`). A renderer need for a field an operation does not select is a contract change and needs separate approval (WP0.2). Already selected today (no change needed): the `CreateAccountingPolicy` effects, exclusion `createdAt` and `createdBy`, and the policy `validated`, `createdAt` and `supersededByVersion` fields.

## 3. Slice map, file ownership and dependencies

```
S0 Preflight ──► S1 Foundations ──┬─► S2 Shell and startup (owns App.tsx) ──► S7 Settings (owns Settings.tsx) ──► WP7.9 (adds the "Open Billing settings" button)
                                  ├─► S4 History (owns Chart.tsx) ──► WP2.3 font gate
                                  ├─► S3 Overview, S5 Usage & Cost, S6 Data Quality
                                  └─► S8 Brand mark (after WP1.5)
                                                all slices ──► S9 Acceptance
```

- **S1 is serial and first.** It owns the shared files: `models.ts`, `components/Display.tsx`, `components/ui/*` (including `data-table.tsx` and `status-tone.ts`), `components/toolbar-group.tsx`, `styles/globals.css`, `api.ts`, `test-support.tsx`, `panel-shell.tsx`, `window-chrome.tsx`. S1 also makes the minimal edits it needs in `App.tsx` (nav classes; passing `siteTimezone` and its failure state and Retry to the views, WP1.2) and `Settings.tsx` (formatter callers, `DataTable` import, focus classes) before S2 and S7 start.
- **After S1,** `App.tsx` is owned by S2 and then handed to S7 (WP7.1 mount point, WP7.9), in that order; `Chart.tsx` and `History.tsx` by S4; `Settings.tsx` by S7; `UsageCost.tsx` by S5, except the "Open Billing settings" button, which is added once, by WP7.9, after S5 and WP7.3. S3, S5, S6 and S8 otherwise edit disjoint view files.
- **Routed exceptions:** an edit to a file owned by another slice goes through one integration owner, one change at a time. They are WP2.4 (`Display.tsx`, `panel-shell.tsx`, `models.ts`), WP3.1 (`models.ts`, `globals.css`), WP4.3 (`data-table.tsx`), WP7.9 (`UsageCost.tsx`) and S8 (`window-chrome.tsx`, after WP1.5).
- **Ordering constraints:** S2 before S7; WP4.1 before WP2.3 (charts must refresh typography on font load before the startup font gate is removed); WP7.3 and S5 before WP7.9; WP1.10 (`useMeterReadings` `enabled` and `refresh`) before WP6.4 and WP7.2.

## 4. Per-work-package loop

1. List references to every exported symbol being changed with the language server (`lsp references`); migrate every caller in the same change (clean cutover, no aliases or deprecated paths).
2. Change production code and its tests **atomically** (`SOLAR_UI_REDESIGN_PLAN.md` B5): keep behaviour contracts (signed directions, thresholds, freshness, cursor semantics, role gating, epoch isolation); delete a class-string, source-text or mock-echo assertion rather than repin it; add a semantic data attribute where an observable DOM hook is needed (as `data-stale` is); never add a wording-only test.
3. `npm run typecheck -w apps/desktop` then `npm test -w apps/desktop`; record the counts.
4. Rendered check on the harness for the states the package touches (section 7), at 1280×800, 914×672, 1600×1000 and 200% zoom; keep screenshot, viewport, DPR, font-loaded state and DOM measurements from the same build. Launch the harness and Electron only through the supervised process tool and only after authorization; never contact a real backend, NAS, cloud account or hardware.
5. Read-only independent review of the diff against the brief (reviewer-claude; reviewer-openai when available). A review is evidence, not acceptance: inspect each cited issue.
6. Report: what changed, gate counts, what was viewed, what was not verified. **Commit only when the owner says so.**

## 5. Work packages

Sizes are relative (S under half a day, M one to two days, L more than two) for one engineer including atomic tests, excluding rendered verification and review.

### S0 — Preflight (no product behaviour change)

| WP | Work | Files | Done when | Size |
|---|---|---|---|---|
| 0.1 | Baseline: run both gate commands on a clean tree; record versions, packaged renderer asset sizes, font bytes, cold and warm startup, and chart update timing (A16 requires a local before measurement) | none | numbers recorded in the slice log | S |
| 0.2 | **Contract-fit audit:** classify every A11 and A12 data need field by field as (i) renderer-only, (ii) a field added to an existing operation (`dashboard.graphql`, generated contract, main review) or (iii) a new operation or backend change. No (ii) or (iii) candidate is known yet: the billing header's tariff data is settled renderer-only by D23; the `CreateAccountingPolicy` effects, exclusion creator and creation time and the policy fields are already selected. The audit confirms this | read `dashboard.graphql`, `schema.gql`, views | table recorded; any (ii) or (iii) item awaits explicit approval before the work package that needs it starts | M |
| 0.3 | **Verification toolbox (local):** extend the harness with a request counter with timestamps; scenarios for role switch, single-region failure, zero versus null coverage, 50% current-day coverage, **successful mutations, a false delete result**, delayed and failing mutations, startup settings-read failure and delay, slow and failing font load; a CDP driver for viewport, DPR, **page zoom (200% from the 1280×800 and 914×672 windows, reported as browser zoom; CDP has no text-only zoom, and px-sized text is covered only by zoom)**, emulated media (reduced motion, forced colors, contrast, transparency), key events, vision-deficiency emulation and computed styles. **Default: no new dependency**, a throwaway Electron main script outside `apps/desktop/src` that opens only the loopback harness URL (as in the 2026-10-30 verification), driven over CDP by a small client on Node's global `WebSocket`. Alternative, needing approval: `playwright-core` as a devDependency. The remote-debugging switch never reaches `apps/desktop/src` or the packaged app | `captures/local/ui-audit/harness/*`, scratch scripts | each scenario reproducible; the driver records a screenshot and DOM measurement per state | L |
| 0.4 | Test-support extensions: `installBridge` accepts a `settings.get` implementation, rejection or call sequence (needed by 2.1); `FakeBridge.calls` carries a timestamp; fake `ResizeObserver`, `matchMedia` and a canvas stub only where a spec needs them | `test-support.tsx` | existing tests unchanged and green | S |

### S1 — Foundations and shared primitives

| WP | Work | Files and symbols | Brief, decisions | Tests changed or added | Size |
|---|---|---|---|---|---|
| 1.1 | **Formatters:** `watts()` gains the W/kW rule (below 1000 W integer W; at or above, kW with two decimals; Unicode minus; nonzero sub-watt `<1 W` and `>−1 W`; exact zero `0 W`) and shares `decimal()` grouping instead of host `toLocaleString`; the raw watts stay available in tooltips and tables (A17); coverage text without a space before `%`; kWh fixed three decimals where A17 says so; one money formatter with the tariff currency and two decimals, never through `Number` | `models.ts` (`watts`, `decimal`, `coveragePercent`, `energyValue`, `powerValue`), `models.spec.ts` | A17, B12, B13 | `models.spec.ts` display assertions change; add boundary cases (999/1000 W, negative zero, sub-watt both signs) | M |
| 1.2 | **Site-timezone time display:** one formatter keyed to `siteTimezone` replacing `localInstant`/`localTime` and the stale-banner times; migrate every caller (Overview, Usage & Cost, Data Quality, Settings) in one change. `App.tsx` (where the zone is already derived from the existing `CollectorStatus` poll) passes every view that needs it the zone, the collector failure and its Retry; no view adds its own `CollectorStatus` observer (that would be a new request). While the zone is unknown, instants carry the approved “ · UTC” suffix (B6 G12 copy), never a resolved zone | `models.ts`, `App.tsx` (props), callers found by `lsp references` | A17, A15, B12 | `models.spec.ts` timestamp cases; view specs asserting times | M |
| 1.3 | **Semantic energy encodings:** one module mapping the six quantities to label, marker shape, dash pattern and existing token (A4 table), replacing positional chart colours; neutral SOC tokens (D04) | new module beside `models.ts`; `globals.css` tokens only as aliases of existing `--chart-*` | A4, A11, D04 | new pure-function specs (mapping, no hue dependence) | M |
| 1.4 | **Request-state primitives:** `Button` pending state (`aria-busy`, label supplied by the caller); shared `Message` with the neutral stripe (D10) and a kind that sets the announcement role (errors announced once); `EmptyView` heading and hint tokens; one region wrapper for loading, refreshing, retained, partial and error-with-scoped-Retry (`useSolarQuery` already returns the full `useQuery` result, so `refetch` needs no API change); `Metric` state prop | `ui/button.tsx`, `Display.tsx` (`Message`, `Metric`), `ui/empty.tsx` | A11, A15, D10 | specs asserting `role=status` on every message change; new specs for pending and Retry | M |
| 1.5 | **Controls, focus, motion:** make the global outline (S2) the only focus model (remove ring classes from primitives, tabs, switch, badge, sidebar items, caption buttons and the Settings textarea and category tiles); control targets per A6; remove `transition-all`; `DialogTitle` and dialog geometry per A3 and A6 with a scrolling body; forced-colors rules for control borders and status chips; **A5 solid toolbar background under reduced transparency and increased contrast** (`ToolbarGroup` uses `bg-background/70`). Reduced-motion for dialog and tooltip is already covered by the global block (`globals.css` reduced-motion rules); verify, do not rebuild | `ui/*.tsx`, `toolbar-group.tsx`, `App.tsx` nav classes, `window-chrome.tsx`, `Settings.tsx` (classes only), `globals.css` | A3, A5, A6, A8, A15 | none class-based; keyboard behaviour only | M |
| 1.6 | **Tables:** `DataTable` caption prop, one end-aligned numeric cell variant, header casing per A3; delete per-cell `tabular-nums` repeats | `ui/data-table.tsx`, callers (`Settings.tsx` import only) | A11, A3 | table view specs | M |
| 1.7 | **Tile label and wrapper:** one shared label class and one tile wrapper replace five copies; type scale per A3; neutral `data-slot` for the segmented control | `Display.tsx`, `Overview.tsx`, `History.tsx`, `UsageCost.tsx`, `DataQuality.tsx`, `segmented-control.tsx` | A3, A6 | any spec selecting the old `data-slot` | S |
| 1.8 | **`Reason`:** keep focus and hover tooltip with Escape; tooltip stacks above its owning dialog (explicit layer, A7); keep `aria-description` wording. Touch disclosure is web and native only (R-client), not built here | `ui/reason.tsx`, `ui/tooltip.tsx` | A11, A15, A7 | Reason callers' specs unchanged unless markup changes | S |
| 1.9 | **Status chips:** keep the A4 `statusTone` palette (A4 retains green-100/800, amber-100/800, red-100/700, slate-100/600); verify the unknown-string neutral fallback and chip contrast on the dark card. No new tones (A4 fixes the set) | `ui/status-tone.ts`, `ui/badge.tsx` | A4 | none | S |
| 1.10 | **`MeterReadingsPager` and `useMeterReadings`:** A11 strings ("Showing [N] readings · more available", "All [N] readings loaded", "Loading more…", "Refresh readings"; singular for N=1) replace the current strings in the shared pager used by Settings and Data Quality; add `refresh` and an `enabled` input to `useMeterReadings` (needed by WP6.4 and WP7.2); keep page size 50, cursor, epoch key and refresh-versus-load-more ownership | `Display.tsx`, `api.ts` | A11, A16, D22 | `api.spec.tsx` (≈:121), `connection.spec.tsx` (≈:96, waits for "Loading readings…"), `SettingsReadings.spec.tsx` (≈:243); `DataQuality.spec.tsx` asserts "Load more readings", which does not change | M |

### S2 — Shell and startup

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 2.1 | **Startup Retry and query gate (D15):** extract the settings read into one function that only returns the settings or throws, so the mount effect and the Retry handler (not the function) update the setup and startup-error state and WP2.5 can reuse it without touching them; render the Retry button and "Retrying…" (disabled while pending) in the startup-error surface, no Forget; `canQuery` also tests the startup error; on success set the setup state from the re-read, then clear the error; on failure set the new message; never `setReady(false)`; add `.catch` to the TLS_MISMATCH forget call (F3) | `App.tsx` | A12.12 item 1a, A13, D15 | `connection.spec.tsx`: startup rejection shows the heading; no LiveStatus or CollectorStatus call after advancing past 10 s and 30 s; Retry success starts polling at the existing intervals; failure keeps the surface | M |
| 2.2 | **Onboarding surface scrolls:** one scroll region below the 40 px drag strip, content centred when it fits, caption controls and keyboard reach to submit buttons preserved | `components/onboarding-surface.tsx` | A12.12, A15, A6 | behaviour test (focusable submit), no class assertions | S |
| 2.3 | **Non-blocking font gate:** mount immediately; the first paint is not gated on `document.fonts` (no bounded wait, no new timer); chart typography refresh on font resolution is WP4.1, so this lands after WP4.1; same family and weights | `main.tsx` | A13, A16 | harness scenario (slow and failing font): the first surface and its controls appear without waiting; charts re-measure when the font resolves | S |
| 2.4 | **Shell reflow and reconnect notice:** header, sidebar, notices and the shell at 914×672, 1280×800, 1600×1000 and 200% zoom without shrinking text or raising the 914×672 minimum; the reconnect notice shows the next retry as an absolute time from the existing RECONNECTING state (`nextRetryAt`), no countdown, with the NAS-autonomy sentence kept | `App.tsx`, `panel-shell.tsx`, `Display.tsx` (`ConnectionNotice`), `models.ts` (`staleBanner`), `sidebar.css` | A6, A10, A12.12 item 11, A15 | stable selectors (`nav[aria-label="Dashboard tabs"]`, caption names) preserved; `models.spec.ts` banner text (≈:226-227 pins the reconnect sentence) | M |
| 2.5 | **First-run and security surfaces, approved presentation backlog:** "Probing…" (disabled, label change), inline URL validation text, probe-failure Retry, ambiguous-failure next-step sentences (IPC rejection only), the TLS_MISMATCH endpoint line (obtained with a fresh `settings.get()` through WP2.1's read function when TLS_MISMATCH is entered; if that read fails the endpoint line is omitted and the TLS_MISMATCH surface is unaffected: the failure never sets the startup error); full fingerprint stays readable and copyable; the token input stays cleared on submit | `App.tsx` (`FirstRun`, `TokenEntry`, AUTH_FAILED, TLS_MISMATCH) | A12.12, A15; copy in `COPY-APPROVALS.md` | `connection.spec.tsx` additions, including a rejected read during TLS_MISMATCH that keeps the mismatch surface and its fingerprint | M |

### S3 — Overview

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 3.1 | **Energy flow:** six identities (shape, pattern, label, token); zero and unknown connectors draw no arrowhead, **a measured zero reads `0 W`** and an unknown value reads "—" with its reason; **tier and identity combine as width-only tiers with the identity dash kept, muted colour reserved for unknown or zero** (today `.flow-idle` forces a muted `4 5` dash and `.flow-live` forces `8 3` on every normal and strong line); accessible summary text (values, directions, SOC, source, age, missing reasons) associated with the diagram; solid Solar and Grid import never animate (D01); each animated pattern gets its own keyframe offset equal to a whole number of its period; animation gate unchanged (`!stale && LIVE && age ≤ 30`); reduced-motion selectors rewritten to match; each connector carries a semantic motion attribute | `EnergyFlow.tsx`, `models.ts` (`flows`, `flowTier`), `globals.css` | A4, A8, A11, D01 | `EnergyFlow.spec.tsx`: replace the class-string animation guards by a per-connector assertion on the semantic attribute, keep no-animation-when-stale; `models.spec.ts` (≈:66-85, the pinned `flows` edges); the driver confirms computed `animation-name` follows the attribute in the same change | L |
| 3.2 | **Region states and scoped Retry:** live, collector and daily totals fail, load and refresh independently; retained values stay visible; Retry re-requests only that operation (`refetch`); a failed site-timezone prerequisite shows the collector failure with the collector's Retry (supplied by `App.tsx`, WP1.2) in the Overview totals, never "Loading site timezone…" forever (WP4.4, WP5.1 and WP6.1 apply the same rule to History, Usage & Cost and Data Quality); "Consumption" becomes "Home (derived)"; "Today so far · through {time}. Coverage {coverage} of the requested local day." | `Overview.tsx`, WP1.4 primitives | A11, A12.1, A17 | `Overview.spec.tsx` | M |
| 3.3 | **Collector region:** collector fields, `Source`, `meterLink`, operating mode and accounting status from the existing selections; "Configured accounting policy" as `CollectorStatus.policyVersion` (0 reads "No accounting policy in force") sharing the collector region's state; null `lastError` reads "None", null `nextRetryAt` "None scheduled", other nulls "—"; no partial presentation; no new request | `Overview.tsx` | A12.1, D02, D03 | `Overview.spec.tsx`: version 7 beside MAPPING_PROVISIONAL; version 0 wording; with a fake bridge, `callsFor("AccountingPolicies")` is empty | M |
| 3.4 | **Layout:** four columns at the three desktop sizes, 160 px minimum cells, reflow at 200% zoom | `Overview.tsx` | A6, A15 | none class-based | M |

### S4 — History

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 4.1 | **Chart lifecycle and motion:** create the ECharts instance on mount; update with `setOption(option, { notMerge: true })` (replace, not merge, so a removed series such as the SOC average on a coarse range or a removed gap area cannot linger); dispose and disconnect the observer on unmount; `animation:false` on all History options; re-measure typography when fonts resolve | `components/Chart.tsx`, `History.tsx` | A13, A16 (Charts, Resource-growth) | real-chart check in the driver: series replaced across range changes; instance, observer and listener counts stable across resize and range changes; `History.spec.tsx` unchanged (mocks Chart) | S |
| 4.2 | **Series semantics, titles, time axis:** colour by metric key not index; legend shown; SOC average solid `--foreground`, maximum dashed, minimum dotted `--muted-foreground`, labelled directly (D04; `endLabel`, which `LineChart` already supports); titles name units, range and site zone; **time-axis ticks at site-local boundaries** (a label formatter alone is not enough: ECharts places ticks in host-local or UTC time, so convert instants to site wall-clock values with `useUTC`, format labels from the original instants, and verify a DST edge) | `History.tsx`, `Chart.tsx`, WP1.3 module | A4, A11, A17, D04 | `History.spec.tsx` (SOC series matched by `/min/` and `/max/` stay matchable; legend present); `models.spec.ts` | L |
| 4.3 | **Accessible inspection:** keyboard point inspection through the existing ECharts tooltip and `dispatchAction`; "View data table" equivalents for power, SOC and energy with captions and 50-row pages as drawn; table size bounded by `maxPoints:1000` | `Chart.tsx`, `History.tsx`, `ui/data-table.tsx` | A11, A15 | `History.spec.tsx`; keyboard sweep in the driver | L |
| 4.4 | **Region states:** `PowerSeries` is one request for the power and SOC charts (shared loading, refreshing, error and one Retry); `EnergyTotals` feeds energy bars, coverage and the tariff-window table; `Tariffs` feeds only the selector; plain tariff error; successful-empty states distinct; no zero for null; a failed site-timezone prerequisite shows the collector failure and its Retry instead of "Loading site timezone…" | `History.tsx` | A11, A12.2 | `History.spec.tsx`, `DateEndpoints.spec.tsx` (unchanged) | M |
| 4.5 | **Layout:** chart height and controls at 914×672, 1600×1000 and 200% zoom | `History.tsx`, `Chart.tsx` | A6 | none class-based | S |
| 4.6 | **Chart semantics completion (A11):** six grouped energy bars (today four) never stacked; sign conventions written beside the chart (grid positive = import, battery positive = discharge); negative samples in the export or charge colour with neutral labels (split series, or register ECharts' `VisualMapComponent`, a tree-shaken addition to the existing library); hatched and labelled lower-bound bars; unknown as an empty slot with its reason; hidden or selected series announced; one W/kW axis unit chosen once per chart (A17); visible zero baseline | `History.tsx`, `Chart.tsx`, WP1.3 module | A4, A11, A17 | `History.spec.tsx`; driver checks of units, sign and null gaps | L |

### S5 — Usage & Cost

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 5.1 | Region states and scoped Retry for `EnergyTotals`, `BillingPeriods`, `BillingPeriod`; split empty states (no totals in range versus no billing periods) with viewer guidance and the ADMIN sentence "A billing period must be added by an administrator in Billing settings."; a failed site-timezone prerequisite shows the collector failure and its Retry; the "Open Billing settings" button is added by WP7.9 only | `UsageCost.tsx` | A11, A12.3, A12.4 | `UsageCost.spec.tsx` | M |
| 5.2 | Billing-period detail: selection prompt; header with start and end dates, stale flag and "Recalculation pending" badge, plus tariff name, currency and timezone **read from the existing `Tariffs` operation by `tariffId` (D23; a mount-driven consumer, no interval, no contract change)**; `billVerified` is not derived here; the retained result is never recomputed; line items and NEM lots with origin days, unknown versus zero amounts; lower-bound and "At least" only where the backend says so; if `Tariffs` is loading or failed the header reads "Loading tariffs…" or "Tariffs unavailable" with the existing "Retry tariffs", amounts print without a currency code and the approved notice says the currency is not shown; D16 (UNAVAILABLE chip plus reason) when a cloud-only result ever exists | `UsageCost.tsx` | A12.4, A17, D16, D23 | `UsageCost.spec.tsx` keeps null, NEM and lower-bound tests | M |
| 5.3 | Terminology and precision: "Home (derived)", readable NEM lot types, kWh three decimals, money via WP1.1, the estimate explanation text (`text-chart-4` today, the Solar hue) moves to neutral text (A4), Metric reflow before shrink | `UsageCost.tsx` | A17, A4, A6 | spec text updates in the same step | S |

### S6 — Data Quality

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 6.1 | Region states and scoped Retry for collector, devices, policies, quality events, daily comparison, meter readings, reconciliation and calculation runs; the collector block applies D02 (null `lastError` "None", null `nextRetryAt` "None scheduled", other nulls "—") so Overview and Data Quality agree; policies empty copy "No accounting policies recorded"; policy validated shown as returned; a failed site-timezone prerequisite shows the collector failure and its Retry instead of "Loading site timezone…" | `DataQuality.tsx` | A11, A12.5, D02 | `DataQuality.spec.tsx` | L |
| 6.2 | **Events:** point-record display for counter events (start only); empty copy that does not claim completeness; device fallback; scoped Retry; `aria-invalid` plus described error on invalid dates while still sending no request; **replace-not-accumulate cursor semantics and reset cases preserved** | `DataQuality.tsx` | A12.5, A15 | `DataQuality.spec.tsx:235-333` stay green only if the event row text keeps the shape `listedEvents` matches (`/^SYNTH_EVT_\d+ ·/`); add the untested cleared-date and invalid-range cursor-reset cases | M |
| 6.3 | **Daily comparison:** caption, sentence-case right-aligned numeric headers, readable quantity names, labelled not-supplied vendor cells; "successful no rows" is not applicable (D07) and is not implemented | `DataQuality.tsx`, WP1.6 table | A12.5, D07 | `DataQuality.spec.tsx`; `DateEndpoints.spec.tsx` (≈:165-169 pins the two inverter headers and `>1.000<`) | M |
| 6.4 | **Reconciliation:** keep "From reading" and "To reading"; separate empty copies (no readings, one reading, no pair); keep selected IDs while options refresh; stale never PASS; verdict as neutral text with the A4 status set only (no new tone); provisional-mapping note; pager copy comes from WP1.10 | `DataQuality.tsx` | A12.6 | `DataQuality.spec.tsx` pagination tests and retry-after-failed-page test | M |
| 6.5 | **Calculation runs:** finished time, RUNNING without a percentage, failed run as a returned record, DONE, RUNNING and FAILED as neutral text (A4 fixes the tone set), cursor replace semantics kept | `DataQuality.tsx` | A12.5 | `DataQuality.spec.tsx` | S |

### S7 — Settings (largest slice; one owner for `Settings.tsx`)

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 7.1 | **Draft store and mutation lifecycle:** in-memory drafts above the Settings view with **their own synchronous generation, reset on every connection boundary (NOT_CONFIGURED, forget, re-pin, AUTH_FAILED, TLS_MISMATCH) and at restart; RECONNECTING keeps them; a late success, error or reset callback from a previous generation is ignored** (the connection epoch advances only on NOT_CONFIGURED, so it is not sufficient); tokens never drafted; per-editor pristine snapshot and reset to pristine **only after a confirmed success**; the shared message split per category and editor; per-editor pending ownership and duplicate-submit guard ("Saving…", "Deleting…"); one lifecycle (pristine, dirty, validation, pending, success, failure, ambiguous) for every form; one dirty predicate for editors, typed delete IDs and the "Unsaved draft" tile marker; read-only variants for VIEWER and UNKNOWN with "Drafts are kept. The forms return when ADMIN access is confirmed."; a delete-specific helper (D13: a resolved false shows "… #{id} was not found; nothing was deleted.", keeps the ID, does not reset, refreshes only that list) used by exclusions and readings | `Settings.tsx` (`MutationEditor`, typed forms, tiles), `App.tsx` mount point | A11, A12.7–A12.11; behaviours (a), (b); D13 | `Settings.spec.tsx`: draft kept across destination change; discarded on NOT_CONFIGURED, on AUTH_FAILED followed by token replacement and on TLS_MISMATCH, and at restart; late callback ignored; reset only after confirmed success; false delete keeps the ID | L |
| 7.2 | **Invalidation map and category-open timing:** replace both `client.invalidateQueries()` calls by the A16 per-operation map (verify against the backend files named in A16; broaden where a derived value could stay stale; keep the epoch in every key); `useMeterReadings` and each category query take an `enabled` input so a closed category issues no request; keep the dialog render-on-open pattern | `Settings.tsx` (`enabled` flags only; the `useMeterReadings` input comes from WP1.10) | A16 (rows "Hidden settings and Settings query timing", "Mutation invalidation"); behaviours (d), (e) | **cache-state specs** (request counts cannot prove the set, because only active observers refetch): seed every operation key at the current epoch, run each of the ten mutations, assert `isInvalidated` for exactly the A16 set (Devices false); `callsFor` only for active refetches and for zero calls before a category opens | M |
| 7.3 | **Dialog, landing and Connection:** dialog opens with focus on the popup (`initialFocus` ref, D09), title and description linked, body scrolls with footer reachable at zoom; tile states (focus, pressed, "Unsaved draft"); Connection shows "Reading local settings…" until the read resolves, "Retry settings read" on failure, token state "unknown until the local read succeeds"; **forget keeps today's behaviour and gains no pending or failure surface (D08)** | `Settings.tsx` (`SettingsDialog`, `connectionBody`) | A12.7, A12.8, D08, D09 | `Settings.spec.tsx`: the active element is the dialog, not the Forget button; the Escape and draft test is unchanged | M |
| 7.4 | **Tariffs:** list, inspect, holidays and monthly-rate region states; "Unverified" badge replaces the inline lowercase text; typed forms with per-field validation and `aria-describedby`; saving labels; the "no versions" empty state; the Partial state naming the missing calculation prerequisite (version, rate or holiday); the explicit holiday-replacement statement; "TNB RP4 ToU + NEM template" unchanged (D12) | `Settings.tsx` (`tariffsBody`), WP1.4, WP1.6 | A12.9, D12 | `Settings.spec.tsx` | L |
| 7.5 | **Billing, Accounting, Exclusions:** region states with "Loading …" (Current) and the unavailable variant; billing periods read "Recalculation pending" for a stale period (today " · stale"); the accounting category shows the policy `validated` map and supersession; exclusions show creator and creation time; the returned effects of `CreateAccountingPolicy` (billing periods needing recalculation, outside-retention date, calculation run) as drawn; first-24-periods note; exclusion delete uses the WP7.1 helper; no `requestRecalculation` control (D06) | `Settings.tsx` (`billingBody`, `accountingBody`, `exclusionsBody`) | A12.10, D06, D13 | `Settings.spec.tsx` | M |
| 7.6 | **Meter readings:** pager (WP1.10); Add and Delete lifecycle with the scalar-layer, resolver-layer and duplicate-reading failures shown verbatim; the empty and partial states of A12.11; "—" export value keeps the `Reason` tooltip; reading delete uses the WP7.1 helper; native `window.confirm` stays as today | `Settings.tsx` (`meterReadingsBody`) | A12.11, D13 | `SettingsReadings.spec.tsx:301-327`, `api.spec.tsx` pagination sequences | M |
| 7.7 | **Ambiguous failure and recovery:** classify the outcome as unknown only when the response may not have been received (rule fixed in the slice from `QueryError.class` in `bridge.ts`, verified against `api-client.ts`; GraphQL, AUTH, RATE_LIMITED and NOT_CONFIGURED are definite); lead "Could not confirm the change." plus the operation-specific consequence from `COPY-APPROVALS.md` (the four tariff operations use the consequences and the "Refresh tariffs", "Refresh holidays" and "Refresh monthly rates" labels approved there); keep the draft; the recovery step is the scoped "Refresh <list>" control (D11: a user-triggered refetch of the existing list query, not a page-level Refresh); Save or Delete stays disabled with its reason until that refresh **succeeds**; no automatic replay of any create | `Settings.tsx` | A11, A12.9–A12.11, A17, D11 | `Settings.spec.tsx`, `SettingsReadings.spec.tsx` | M |
| 7.8 | **Narrow and 200% reflow:** replace fixed `w-56` rows and side-by-side delete rows by wrapping layouts with `min-width:0`; last control reachable at 200% zoom | `Settings.tsx` | A6, A15 | none class-based | M |
| 7.9 | **"Open Billing settings":** an App-level request to open the Settings dialog at a category plus an initial-category input on `Settings`; then add the button (approved label) to the Usage & Cost empty guidance | `App.tsx`, `Settings.tsx`, `UsageCost.tsx` (routed exception, section 3) | A12.3, COPY-APPROVALS (B5 G17) | `Settings.spec.tsx`, `UsageCost.spec.tsx` | S |

### S8 — Brand mark in the chrome (D17, D21)

| WP | Work | Files | Brief, decisions | Tests | Size |
|---|---|---|---|---|---|
| 8.1 | Add the approved mark as a local inline SVG component (candidate B, 16 px reduced-detail geometry `M2 9A6 6 0 0 1 14 9Z` plus rectangles `x0 y11 w16 h2` and `x3 y14 w10 h2` from B12-27/B12-30; `fill="currentColor"`, `aria-hidden`, `focusable="false"`, size-4); replace the `Sun` in the brand slot, keep the "Solar" text, drop the unused import; no accent colour in chrome; no mark in the startup card; no animation | new `components/brand-mark.tsx`, `window-chrome.tsx` | A13, A14, D17, D21 | one small behaviour spec: the brand slot shows "Solar" and the mark is `aria-hidden` (no spec covers the chrome today) | S |
| 8.2 | Rendered checks at 100%, 125% and 150% display scaling (the bar gap softens at fractional DPI), grayscale, forced colors (`currentColor` maps to CanvasText), contrast against the sidebar gradient stops (A14 sizes) | harness driver | A14, A15 | n/a | S |
| 8.3 | *Optional, on request:* editable vector source and authorship record under `apps/desktop/src/renderer/assets/brand/` (plan D1 path) and an outlined "Solar" wordmark export from the bundled font (D18: paths only; record package, version, axis values; keep `THIRD_PARTY_NOTICES.md`). Not needed by the app | assets | D18 | n/a | S |

### S9 — Acceptance

| WP | Work | Done when |
|---|---|---|
| 9.1 | Run the full verification matrix (section 7) on one build; record screenshot identity and matching DOM measurements | every row has evidence or a stated limitation |
| 9.2 | Packaged-app pass on `npm run package` output: minimize, maximize, restore, close, drag, resize; no OS menu or title band; usable custom captions; a real OS-level capture for DWM corners and borders (the 2026-10-30 CDP capture is not sufficient); `npx @electron/fuses read --app <exe>` matches `electron-builder.yml`; no remote-debugging hook in the output | results recorded; a missing capability is reported, never substituted |
| 9.3 | Independent review of the complete diff against the brief, then update the status notes in `SOLAR_UI_REDESIGN_PLAN.md` (Part C and Approach). **Do not retro-edit Part A or regenerate the extracts for implementation status** | owner informed of what is done, what is verified and what is not |

## 6. Decision traceability

| Decision | Carried by | Decision | Carried by |
|---|---|---|---|
| D01 static solid connectors | 3.1 | D13 false delete honest | 7.1, 7.5, 7.6 |
| D02 no collector partial | 3.3, 6.1 | D14 synthetic fixtures | 0.3, tests in S3, S5, S6, S7 |
| D03 policyVersion row | 3.3 | D15 startup gate and Retry | 2.1 |
| D04 neutral SOC | 1.3, 4.2 | D16 UNAVAILABLE plus reason | 5.2 (no code now) |
| D05 no fixtures | S4 tests (synthetic) | D17, D21 mark and placement | 8.1, 8.2 |
| D06 recalculation deferred | none (guard: no `OPERATIONS` entry) | D18 outlined wordmark | 8.3 (optional) |
| D07 no-rows not applicable | 6.3 | D19, D20 | gated, not scheduled |
| D08 forget unchanged | 7.3 (no surface) | D22 copy | every WP, `COPY-APPROVALS.md` |
| D09 initial focus | 7.3 | D23 billing header source | 5.2 |
| D10 neutral Message | 1.4 | Findings F1, F2, F4 | gated; F3 in 2.1; F5, F6 none |
| D11 refresh scope | 1.10, 7.7 | D12 TNB label kept | 7.4 (no change) |

## 7. Verification matrix (from "Later implementation acceptance")

| Check | Mechanism | Limit |
|---|---|---|
| Typecheck and tests each step | the two gate commands | jsdom does not render layout, canvas or media queries |
| A11 and A12 request, mutation, role and epoch states | vitest with `installBridge` plus harness scenarios (WP0.3, WP0.4), including successful mutations and false deletes | fixtures are synthetic; none is a real backend |
| Cadence: LiveStatus 10 s, CollectorStatus 30 s, nothing else polls | fake timers over timestamped `callsFor`; harness counter | |
| Closed Settings category issues no request | `callsFor` count before open (WP7.2) | |
| Each mutation invalidates exactly its A16 set | cache-state specs (`isInvalidated` over seeded keys), not request counts (WP7.2) | |
| Confirmed success resets only its own form; drafts gone after every connection boundary (NOT_CONFIGURED, forget, re-pin, AUTH_FAILED, TLS_MISMATCH) and restart; RECONNECTING keeps them | vitest on the draft store with connection-state emissions (WP7.1) | |
| 1280×800, 1600×1000, 914×672; 200% zoom; 320 px reflow only for web delivery (R-client) | driver viewport, DPR and page zoom (reported as browser zoom); screenshots with DOM measurements from the same build | CDP has no text-only zoom; at 914×672 a 200% zoom leaves a 457×336 CSS-pixel layout, so reflow is checked, not the 914 px layout |
| Keyboard: nav, captions, native selects, dialogs, `Reason`, chart inspection and table, paging, validation; focus restoration; no clipping or obscuring | driver key events in Electron's Chromium plus testing-library role queries | |
| Speech labels and live-region restraint | accessible names via testing-library; count of status and alert announcements across a 10 s poll in the driver (errors announced once, not every poll) | an actual screen reader is not run |
| Reduced motion, reduced transparency, increased contrast, forced colors | driver emulated media and computed styles | a real Windows High Contrast run needs the OS; report it as not performed |
| Colour-blind and grayscale reads of the six energy encodings | driver vision-deficiency emulation and grayscale screenshots | |
| Charts: units, ranges, site zone, negative sign, null gaps, extrema-only SOC, no canvas motion; series replaced on range change; instance, observer and listener counts stable across resize and range changes | driver on the real `Chart` (jsdom needs a canvas stub only for `resolve()`) | |
| Startup: slow or failed font, immediate connection, first run, AUTH_FAILED, TLS_MISMATCH, reduced motion; no added wait, fake progress, hidden error or extra request | harness scenarios and vitest | warm start and native resume do not exist on desktop (not applicable); the window-creation wait (F1) is main-process and out of scope |
| Packaged Windows behaviour | WP9.2 | needs a packaged build and the OS |

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `Settings.tsx` is about 1100 lines and several slices touch it | S1 makes only caller, import and class edits first; then S7 is the only owner; WP7.1 and 7.2 land before the category packages |
| Draft leakage across identities | the draft store has its own synchronous generation reset on every named connection boundary and ignores stale callbacks; tokens never drafted; specs at each boundary |
| Over-narrowed invalidation leaves stale data | start from the A16 map, verify each mutation's backend effects, broaden where a derived value can stay stale; cache-state specs for the exact set |
| Six-way energy encodings are a large visual change | WP1.3 first; keep stale grayscale; tier and identity combination fixed in WP3.1; harness frames at all sizes before 3.1 and 4.2 land |
| Keyboard inspection inside a canvas chart; site-zone tick placement | use the existing ECharts tooltip and `dispatchAction` with the data table as the guaranteed equivalent; `useUTC` wall-clock shift verified at a DST edge |
| Merged ECharts options leave stale series | `notMerge` replacement plus a real-chart check across range changes |
| Specs pin class strings or source text | delete such assertions in the same step; assert observable behaviour or a semantic attribute (B5) |
| Verification driver or an a11y library is a policy choice | default is no new dependency; any devDependency needs approval |
| Fractional-DPI softness of the mark | check 100%, 125% and 150%; ship the snapped geometry |
| Contract-fit audit finds a missing field | classify, request approval, park the dependent package; never widen `OPERATIONS` or the selections silently |
| Usage & Cost needs the tariff currency | D23: the existing `Tariffs` operation, mount-driven; if it fails, amounts print without a currency code and the approved notice says so (a recorded P1 exception: one extra `Tariffs` request per Usage & Cost mount) |
| A live backend is never contacted | harness and fake bridge only; no NAS, cloud or hardware in any slice |

## 9. Start conditions

1. **Authorization:** the owner says "implement" for a named slice (S0 may start alone). Nothing is committed or pushed until the owner says so; harness and Electron launches only through the supervised process tool after authorization.
2. **Verification driver:** confirm the default (no new dependency) or approve `playwright-core` (WP0.3).
3. **Contract-fit audit:** every (ii) or (iii) item from WP0.2 is approved or its dependent work package is dropped.
4. **D23 (added during plan review, a recorded P1 exception):** the owner may veto reading tariff currency through one extra `Tariffs` request per Usage & Cost mount; the alternatives are a field addition (a contract change needing its own approval) or showing amounts without a currency code.
5. **Reviewer availability:** reviewer-openai was unavailable on 2026-11-08 (model not supported); use reviewer-claude, or restore reviewer-openai, for the read-only review step.

## 10. Indicative sizing

Counting the tables in section 5: **49 sized work packages: 15 S, 26 M, 8 L** (S0 2S 1M 1L; S1 3S 7M; S2 2S 3M; S3 3M 1L; S4 2S 1M 3L; S5 1S 2M; S6 1S 3M 1L; S7 1S 6M 2L; S8 3S), plus the three S9 verification work packages. With S ≈ 0.5, M ≈ 1.5 and L ≈ 3 engineer-days as lower bounds the total is about **70 engineer-days** before per-slice rendered verification, review and the S9 pass. Slices S3–S6 and S8 (about 32 days) run in parallel after S1, so elapsed time is governed by the serial chain S0 → S1 → S2 → S7 plus S9 (about 38.5 engineer-days if one engineer owns it), with WP4.1 landing before WP2.3. These are survey-grade estimates to be corrected by WP0.2 and the first completed slice, not commitments.

## Appendix A — Brief coverage matrix

| Brief section | Work packages |
|---|---|
| A3 typography, A5 materials, A6 geometry, A7 layers, A8 motion | 1.5, 1.7, 1.8, 3.1, 3.4, 4.1, 4.5, 7.8 |
| A4 colour and the six energy encodings | 1.3, 1.9, 3.1, 4.2, 4.6, 5.3 |
| A9 iconography | 1.5, 8.1 |
| A10 shell and navigation | 2.4 |
| A11 components and state contracts (request states, mutation states, chart and flow interaction, pager, Reason, modal, notices) | 1.4, 1.6, 1.8, 1.10, 3.1, 4.3, 4.6, 7.1, 7.3, 7.7 |
| A12.1 Overview | 3.1–3.4 |
| A12.2 History | 4.1–4.6 |
| A12.3 Usage & Cost, A12.4 billing detail | 5.1–5.3, 7.9 |
| A12.5 Data Quality, A12.6 Reconciliation | 6.1–6.5 |
| A12.7–A12.11 Settings | 7.1–7.9 |
| A12.12 first run, startup and security | 2.1, 2.2, 2.4, 2.5 |
| A12.13 cloud, A12.14 web and native | gated, not scheduled |
| A13 startup | 2.1, 2.2, 2.3, 8.1 |
| A14 logo and icon | 8.1–8.3; R-brand-package gated |
| A15 accessibility | every package; S9 |
| A16 budgets and constraints (cadence, chart lifecycle, query timing, invalidation, assets) | 0.1, 4.1, 7.2, 7.1 |
| A17 content, units and copy | 1.1, 1.2, 3.2, 5.3, `COPY-APPROVALS.md` |
| A18 fictional data | design fixtures only; implementation tests use synthetic data (D14) |
