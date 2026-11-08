# Owner decisions — Solar UI redesign (design batches 3–12)

**Date:** 2026-11-08.
**Decided by:** Main (the coordinating agent) on the owner's explicit delegation ("you can decide the owner decisions for me using the reviewer-claude subagent").
**Method:** every open decision logged in the batch 3–12 conflict sheets (D01–D22) was analysed by an independent read-only reviewer-claude agent against the principles below. Main re-verified the load-bearing evidence in source (and viewed the mark frames) before deciding. Reviewer output is analysis, not authority. Nothing here is legal advice.
**Status of the code:** nothing is implemented. These decisions amend Part A of `SOLAR_UI_REDESIGN_PLAN.md` (and therefore `BRIEF.md`) where noted in the last column of the summary; the approved mockups are not redrawn, and each place where a mockup differs from a decision is listed under "Mockup divergences".
**Related:** `IMPLEMENTATION-PLAN.md` (how these decisions are carried out, not authorized), `COPY-APPROVALS.md` (decision D22, the wording approvals). **D23 was added during the independent review of the implementation plan** (a billing-header data source the brief requires and no document settled); the owner may veto it.

## Principles used

- **P1 Preserve** accounting, pricing, raw values, GraphQL operations, polling intervals (LiveStatus 10 s, CollectorStatus 30 s, no new timers), freshness decisions, role gating, connection epochs, pagination semantics and Electron security boundaries. Anything that adds or changes an operation, a backend field, a request, a timer or a boundary is out unless the brief already approves it.
- **P2 Approved exceptions only:** W/kW and locale-consistent formatting; Retry, dirty, pending and failure states; keyboard and chart accessibility; grayscale-without-dimming for stale; and the five 2026-10-30 Settings/startup behaviours (reset after confirmed success; drafts retained across destination changes; startup settings-read Retry; narrowed invalidation; category-open query timing).
- **P3 Current versus requested:** only what the code does today is Current. Never claim rollback, saved, verified, live or complete where the code cannot settle it.
- **P4 Conservative:** prefer the standard option; prefer deferral with an explicit prerequisite when nothing in the desktop implementation needs the decision now. No invented endpoints, operations, tokens, fixtures, pairing flows or secret stores.
- **P5 WCAG 2.2 AA**, no new tokens beyond A4. **P6** prefer options needing no new mockups. **P7** every decision is implementable and testable.

## Summary

| ID | Origin | Decision | Brief amendment |
|---|---|---|---|
| D01 | B3 O1 | Solar and Grid import connectors stay static (option a); only dashed or dotted identities animate | A8 |
| D02 | B3 O2 | No collector "partial" presentation; nullable fields are shown as meaningful absences | A12.1 Partial |
| D03 | B3 O3 | Overview shows the `CollectorStatus.policyVersion` number inside the collector region; no `AccountingPolicies` request on Overview | A12.1 |
| D04 | B4 O1 | SOC Max neutral dashed and Min neutral dotted, labelled directly | A11 SOC bullet |
| D05 | B4 O2 | No more fixtures; week, month and year render whatever the API returns | none |
| D06 | B5 | `requestRecalculation` is not exposed; stays prerequisite-blocked (deferred) | A12.4 note |
| D07 | B6 | A12.5 "successful no rows" is not applicable; edit the brief | A12.5 |
| D08 | B7 C11 | Keep the main-process forget order; a forget failure is not reported; document the limitation | A12.8 |
| D09 | B7 C12 | Settings dialogs open with focus on the popup, never on Forget | A11 modal row |
| D10 | B7 G5 | The shared Message keeps a neutral start border (as drawn), replacing source amber-500 | A11 data-notice row |
| D11 | B7 | No page-level Refresh on Settings; the scoped list refresh controls the brief prescribes stay | A10 Native |
| D12 | B8 C6 | Keep the "TNB RP4 ToU + NEM template" label unchanged | none |
| D13 | B9 C7, B10 C7 | A delete that resolves false is reported honestly; the ID is kept; only that list refreshes | A12.10, A12.11 |
| D14 | B9 C8, C11 | Accept the A18 placeholders; implementation tests use their own synthetic fixtures | A18 preamble |
| D15 | B11 C3 | Gate queries on the startup error, together with the approved Retry | A12.12 item 1a |
| D16 | B11 C21 | Cloud-only billing shows the returned status UNAVAILABLE with reason VENDOR_DATA_ONLY | A12.13 |
| D17 | B12 C4 | Mark: candidate B, "Half-disc over horizon bars" | A14 |
| D18 | B12 C5 | An outlined "Solar" wordmark export is permitted as artwork under the bundled font's OFL 1.1; trademark clearance stays an open question | A14 |
| D19 | B12 C6 | R-brand-package stays untouched now; separate work item with entry criteria | A14 |
| D20 | B12 C7 | Native icon and launch-asset export deferred until R-client native items are approved | A14 |
| D21 | B12 C14 | Mark in the root chrome brand slot only; no mark in the startup card; no animation | A13, A14 |
| D22 | B3–B12 | Proposed copy approved except 73 edits or rejections of 288 strings | see `COPY-APPROVALS.md` |
| D23 | plan review | Usage & Cost reads tariff name, currency and timezone through the existing `Tariffs` operation; `billVerified` is not derived there | A12.4 |

## Decisions

### D01 — Solid connector animation (B3 O1): static

**Decision:** option (a). Solar and Grid import keep their solid identity (A4); their arrowhead and marker carry direction. The existing 2 s dash animation moves only the dashed or dotted identities (Battery charge, Battery discharge, Grid export, Home), only on a fresh, connected, known, non-idle connector, and never under reduced motion or when stale.
**Why:** the dash is the only motion the renderer has (`globals.css:231-246`, `EnergyFlow.tsx:12-17`), A8 says it denotes direction only, A11 says a static diagram is enough under reduced motion, and the arrowhead already encodes direction. Option (b) puts a data marker in motion and option (c) makes a solid line look dashed, weakening the A4 identity rule; both need new mockups and contrast proofs.
**Implementation:** every dash pattern needs its own keyframe offset equal to a whole number of that pattern's period (today's single 8+3 pattern uses offset −22, two periods); otherwise the dash jumps at each loop.
**Risk and mitigation:** a static Solar line could be misread as stalled. Freshness is stated in text, and stale data is grayscale, so a fresh static solid line still differs visibly from a stale one.

### D02 — Collector "partial" (B3 O2): not presented

**Decision:** do not draw a collector partial state. `CollectorStatus` defines no partial status and its non-null fields are always returned. Two nullable fields carry a meaning: a null `lastError` means no error recorded and a null `nextRetryAt` means no retry scheduled. Every other nullable field (for example `lastBackupAt`, where null means unknown because the backup marker was missing or unreadable, `api.resolver.ts:301-319`, as well as `lastSuccessAt`, `monitoringSince` and `device`) keeps showing "—" with its reason. Degradation is shown only by `state` (verbatim) and `consecutiveFailures`.
**Copy:** null `lastError` reads "None" (existing, `DataQuality.tsx:170`); null `nextRetryAt` reads "None scheduled" (approved here).

### D03 — Policy on Overview (B3 O3): the policy version from CollectorStatus

**Decision:** Overview shows "Configured accounting policy" as the `CollectorStatus.policyVersion` number inside the collector region. It shares that region's loading, refreshing, error and Retry states. `0` means no policy in force and reads "No accounting policy in force". Policy sources, validation, history and notes stay on Data Quality and Settings, which already use `AccountingPolicies`. Overview adds no request and no operation.
**Why:** `LiveStatus` returns no policy (the resolver computes `activePolicy` only to pick the grid source, `api.resolver.ts:112-127`). `CollectorStatus` already selects `policyVersion` (`dashboard.graphql:218-231`), computed by `effectivePolicyVersion` through `selectSegment` (`policy.ts:33-65`): not superseded, effectiveFrom not after server time, newest effectiveFrom, higher version on a tie, independent of mapping provisionality. That is exactly the rule the design tool proposed and it shows version 7 beside MAPPING_PROVISIONAL, as A18 requires. Copying the live-status rule would show nothing in the baseline, and a new `AccountingPolicies` request would add a request (P1).
**Mockup divergence:** the B3 row with policy sources and "Validated families" and its own refresh and error frames is reduced to the version number inside the collector region. The strings "Retry accounting policy" and "Refreshing accounting policy…" are not used.

### D04 — SOC extrema (B4 O1): neutral dashed and dotted

**Decision:** as drawn. Average solid `--foreground`, maximum dashed `--foreground`, minimum dotted `--muted-foreground` (#a1a1a1, 6.94:1 on card), each labelled directly and in the legend. The source's chart-3 and chart-4 colours are not restored.
**Why:** chart-3 is Battery discharge and chart-4 is Solar (A4 gives each energy hue one meaning everywhere); the source colours SOC maximum as Solar and minimum as discharge. Batch 1 already moved the average to neutral; the extrema finish the correction.
**Implementation notes:** `History.tsx:33-37,150-158` (`socToken`); `endLabel` needs no new ECharts component, whereas `markPoint` needs `MarkPointComponent` added to `echarts.use` (`Chart.tsx:14-23`); series names stay matchable by tests (`/min/`, `/max/`); the legend stays shown.

### D05 — Week, month and year data (B4 O2): no fixture work

**Decision:** keep "Not supplied" in the approved mockups. The implementation renders whatever `PowerSeries` and `EnergyTotals` return, using the layouts already drawn for the A18.2 day and A18.3 month. Tests use per-spec synthetic responses (the existing `History.spec.tsx` already does for week). "Not supplied" in those frames is fixture absence, not product copy; a real empty response uses "No readings in this range".

### D06 — requestRecalculation (B5): deferred, not exposed

**Decision:** the desktop does not expose it. No operation, generated document, `OPERATIONS` entry or control is added; the B5 and B9 specimens stay prerequisite-blocked.
**Why:** P1. The mutation is ADMIN-only and high impact: both kinds create a RUNNING `CalculationRun` and a dirty range; `RENORMALIZE` rewrites `Sample` rows from raw polls with the current mapping, and overlapping billing results are marked stale. Nothing in the desktop needs it: the dirty-range worker and stale-billing recompute handle every desktop-initiated change. Adding an entry to `OPERATIONS` also widens the main-process allow-list (`ipc.ts:9-11`), which is itself a security-boundary change.
**Entry criteria for a future request (not scheduled):** product approval of which kind is offered, range limits and confirmation copy; a `dashboard.graphql` document, generated contract and `OPERATIONS` entry; an A16 invalidation entry.

### D07 — A12.5 "successful no rows" (B6): not applicable

**Decision:** edit the brief. For every valid range the backend returns at least one DAY row (`totals.service.ts:556-566` builds at least one boundary because `from <= to`, and `:694` maps them to rows), and an invalid range is an error. If an empty list ever arrived, the existing table would show its headers and no cells, never zeros. No new copy and no code. Frame B6-35 is relabelled not applicable; "No daily rows in this range." is not used.

### D08 — Forget outcome (B7 C11): keep the fail-closed order; not reported

**Decision:** keep `api-client.ts:123-132` as it is (`store.clear()` inside `try`, `reset()` in `finally`, so the in-memory connection is always dropped) and add no outcome reporting. `reset()` publishes NOT_CONFIGURED before the IPC rejection returns, and `App.tsx:319-320` then swaps Settings for first run, so a failure message set in `Settings.tsx:436-450` is never visible. Reporting it would need a main-process ordering change (P1) or a sixth, unapproved behaviour with no mockup.
**Consequence:** the B7 "Forgetting the connection and token…" and "Forget failed…" specimens are not implemented. The brief's wording that a failure message exists today is corrected in A12.8.
**Known limitation (see Finding F2):** `settings-store.ts:93-106` unlinks the token file first and stops at the first non-ENOENT error. If that unlink fails, both files remain, the session still resets to first run, and the next launch reconnects with the "forgotten" token (`api-client.ts:98-108`). This is pre-existing and outside the redesign.

### D09 — Initial dialog focus (B7 C12): the popup

**Decision:** every Settings dialog opens with focus on the dialog popup itself, using Base UI's documented `initialFocus` prop with a ref (installed 1.9.0: `DialogPopup.d.ts:24`). The title and description are announced, the first Tab reaches the first control, and a destructive control is never the initial focus. No confirmation is added.
**Why:** Base UI's default focuses the first tabbable element, which in Connection is "Forget connection and token", so one Enter or Space after opening removes the credentials.
**Implementation:** one prop in `SettingsDialog` (`Settings.tsx:217-260`); `dialog.tsx` already spreads props to the popup. The popup has `outline-none` (`dialog.tsx:57-60`); that is acceptable for a non-interactive container and must be noted in the keyboard sweep.

### D10 — Shared Message border (B7 G5): neutral

**Decision:** the shared `Message` (`Display.tsx`, class `border-s-amber-500`) takes a 2 px start border in `--muted-foreground`, as all twelve batches draw it. The stripe is decorative; status stays in text and the `statusTone` pairs.
**Why:** `Message` carries loading, success, validation and error text at more than 30 call sites, so an amber stripe carries no state and suggests a warning on "Tariff saved." or "Loading…". Amber means something elsewhere (the RECONNECTING dot, the ESTIMATED family), and #fe9a00 sits beside the Solar hue. `ConnectionNotice` already uses a neutral border. The change is one class, uses an existing token and matches every approved frame.

### D11 — Settings Refresh (B7): no page-level Refresh

**Decision:** no page-level or dialog-level Refresh control on any client. The scoped list refresh controls the brief already prescribes stay: the meter-reading pager's "Refresh readings" (A11) and the "Refresh <list>" step after an ambiguous mutation outcome (A17 "Failed mutation" row and the closing sentence of A11 "Shared mutation states"; B9 and B10 recovery sentences). Each is a user-triggered refetch of one existing query, so it adds no operation, timer or automatic request. Category data otherwise refreshes when a category reopens (approved behaviour e), and a failed category query uses its scoped Retry.

### D12 — "TNB RP4 ToU + NEM template" (B8 C6): keep

**Decision:** keep the label unchanged. It is a real product control that inserts a rate-blank structure (it fails validation until real rates are entered); the helper text already says no TNB rates are assumed. The fictional A18 tariff covers mockup data, not product controls. If the button is restyled its accessible name must stay identical (`Settings.spec.tsx` locates it by name).

### D13 — Delete result false (B9 C7, B10 C7): report honestly

**Decision:** read the returned Boolean in the renderer (no backend change, no operation change). On false: show "Data exclusion #{id} was not found; nothing was deleted." or "Meter reading #{id} was not found; nothing was deleted.", keep the typed ID, do not reset the form, and refresh only that category's list. On true: current success message, then the approved reset (clear the ID) and the A16 invalidation set. A delete-specific helper is added; the create mutations and `MutationEditor` are untouched.
**Why:** A15 bases mutation success on the resolved response. Today `mutate()` discards it and prints "DeleteDataExclusion saved." (`Settings.tsx:383-391`) although a false result changed nothing (`accounting.mutations.ts:105-109`; `accounting.resolver.ts:236-243`). False is not a confirmed deletion, so the approved reset does not apply.
**Mockup divergence:** the B9 and B10 C7 specimens draw today's "saved." for false; the implementation shows the not-found sentence in the same shared-message slot.

### D14 — A18 gaps (B9 C8, C11): placeholders accepted

**Decision:** keep "Not supplied" and "[not supplied: structural]" in the mockups; do not extend A18. Implementation tests and the synthetic harness use their own clearly synthetic values (a superseded policy version, a billing-period note, creation times) and never present them as A18 data. A blank date-time fails scalar coercion with library text; the UI relays `error.message` and tests assert pass-through, not the library's wording.

### D15 — Queries behind the startup error (B11 C3): gate

**Decision:** add `!startupError` to `canQuery` (`App.tsx:251-256`) together with the approved Retry. While Retry is pending, `startupError` stays set (surface kept, queries gated). Order on success: set `setup` from the re-read, then clear `startupError`, so polling starts in the same render that leaves the error surface; on failure set the new message. Never call `setReady(false)`. Intervals are unchanged.
**Why:** today LiveStatus and CollectorStatus keep running behind "Connection settings unavailable", and a security state they provoke is hidden because `App.tsx:310` checks the startup error before AUTH_FAILED and TLS_MISMATCH. The gate is part of approved change (c) and matches how the other three non-connected states already gate.
**Test helper:** `test-support.tsx` `installBridge` must accept a `settings.get` implementation or rejection and a call sequence.

### D16 — Cloud-only billing label (B11 C21): UNAVAILABLE with a reason

**Decision:** a cloud-only bill shows the returned status `UNAVAILABLE` (the existing slate chip) with reason `VENDOR_DATA_ONLY` and cost not supplied; the reason never replaces the status (A4 "always retain the status text"). No new wording and no special case: the generic renderer already prints `result.status` through `statusTone` and lists reasons separately (`UsageCost.tsx:268-298`). The engine already yields UNAVAILABLE plus VENDOR_DATA_ONLY (`engine.ts:92-100`); the service hard-codes `vendorDataOnly:false`, so the path is unreachable until the cloud contract (A12.13) exists.
**Mockup divergence:** B5-78 and the B11 cloud frames omit the UNAVAILABLE chip; they are prerequisite-blocked specimens and are not redrawn.

### D17 — Mark: candidate B, "Half-disc over horizon bars"

**Decision:** candidate B (B12-27 construction). The product uses the 16 px reduced-detail geometry (`M2 9A6 6 0 0 1 14 9Z` plus two bars, B12-27/B12-30) as an inline SVG with `fill="currentColor"`, monochrome light. The accent composition is for specimens and packaging previews only, never UI chrome.
**Why:** A14 needs an original solar or measurement motif that does not resemble a status indicator or imply live data, and A13 puts the mark beside "Loading connection…" where nothing may look like progress. Candidate A is a ring of eight equal elements around an empty centre with one highlighted element in the accent version: the standard frame of a loading spinner, and a 3×3 apps or grid-menu icon (B12-14 says so itself), placed in an `app-no-drag` chrome slot above the Overview grid icon (B12-47). Candidate C's outline is the Grid export diamond marker and its amber facet reads as a hazard sign. Candidate B's risk is a sunrise reading (partial match in B12-14), which is on-topic for a solar product, and the application has no weather surface.
**Residual risks and checks:** the half-disc overlaps the Solar marker circle (IoU 0.56) only in the amber accent version, which is never used in UI chrome; the 1-unit bar gap can soften at fractional DPI, so check 100%, 125% and 150% scaling; the brief's resemblance tests omit "loading spinner or progress ring" and "apps or grid menu", which are added.
**Mockup divergence:** B12-41 to B12-60 draw candidate A; B12-14's note applies B by substitution. Where A is drawn, substitute B at 16 px (reduced-detail geometry). The A sheets B12-20 to B12-26 become historical.

### D18 — Google Sans outlines in the wordmark (B12 C5): permitted as artwork

**Decision:** an external "Solar" wordmark SVG may be exported as outlined Google Sans letterforms, as artwork (paths only: no `<text>`, `@font-face` or embedded font data). The application keeps live text "Solar". Keep the existing OFL notice (`apps/desktop/THIRD_PARTY_NOTICES.md`). Record font provenance in the authorship record: `@fontsource-variable/google-sans` 5.3.2 and the axis values used (weight 600 at the chrome weight). Do not use Google's name to promote the product. Fallback: mark-only SVG exports plus live text.
**Evidence:** `node_modules/@fontsource-variable/google-sans/LICENSE` is "SIL Open Font License, Version 1.1", Copyright 2017 Google, with no Reserved Font Name declared; `package.json` says `"license": "OFL-1.1"`. The licence's preamble states that the requirement to stay under the OFL "does not apply to any document created using the fonts or their derivatives"; outlined glyphs in a logo SVG are artwork created with the font, not a redistribution of the font software.
**Not answered by the licence:** trademark. The OFL grants no trademark rights, so clearing "Solar" as a name or mark for any external or public use remains an open owner question. In-app use does not need it. This is not legal advice.

### D19 — Packaging (R-brand-package): separate work item

**Decision:** the redesign implementation does not touch `electron-builder.yml` (including `signAndEditExecutable:false` at line 20 and the fuses) or the `BrowserWindow` options. R-brand-package opens only after the D17 mark has shipped in the renderer and these entry criteria are met: (1) the owner names a signing certificate or records "remain unsigned" with the SmartScreen consequence; (2) a read-only spike against the installed electron-builder 26.3.1 records what `signAndEditExecutable:true` changes (rcedit icon and version strings, signing) and its order relative to the ASAR-integrity resource and the fuses; (3) an ICO is built from the approved mark at 16, 32, 48 and 256 px and the B12 preview plate is approved or dropped; (4) verification on a clean Windows machine covers exe, Start-menu shortcut, taskbar (running and pinned), installer and uninstaller icons at 100% and 150% DPI, `npx @electron/fuses read --app <exe>` against `electron-builder.yml`, and a tamper test (edit one byte of `resources/app.asar`; the app must refuse to start). Approving a mark does not authorize any of this.
**Why:** `signAndEditExecutable:false` makes `signApp` return early and the icon is applied only through rcedit, so `win.icon` alone would not embed the exe icon (as A14 states). The ASAR-integrity resource is written separately by resedit, so re-enabling rcedit changes the executable that carries it; that interaction is what the spike must verify.
**Citation fixes:** the flag is at `electron-builder.yml:20` and the file has 27 lines (the plan cited `:21` and `:1-28`); corrected in B22 and D3.

### D20 — Native icon and launch-asset export (B12 C7): deferred

**Decision:** deferred. Prerequisites: the R-client native items are approved (framework, build, signing, distribution); the D17 mark is final; the owner supplies a store and bundle identity. The contract is then taken from the chosen toolchain's current documentation. Nothing in the desktop implementation needs it.

### D21 — Mark placement (B12 C14): chrome slot only

**Decision:** the approved mark replaces the lucide `Sun` in the root chrome brand slot (`window-chrome.tsx:107`) with the "Solar" text kept and the mark `aria-hidden`. The startup card shows no decorative mark and there is no mark animation. Every launch uses the B12-43 (SP3) composition. A13's optional in-card appearance and 200 ms opacity animation are not used on desktop.
**Why:** the card mark would repeat the chrome lockup on the same screen above "House Solar Monitoring"; the chrome slot is already present in every startup, error, security and connected state (A10), so A14's placement is met with no second element, no animation to suppress under reduced motion, nothing to remove when error content wins and nothing left in the accessibility tree after startup. The renderer also has no cold-versus-warm launch signal.
**Mockup divergence:** B12-41, B12-42, B12-44 and B12-46 draw a card mark; implement B12-43 for every launch. If a later owner wants an in-card mark or animation, the B12 specifications apply unchanged.

### D22 — Proposed copy (B3–B12)

**Decision:** the 288 proposed strings are approved as proposed except 73, which are approved with an edit, moved to existing wording or rejected, as listed in `COPY-APPROVALS.md` together with the cross-batch rules. Approval is wording only: approving a string does not commit the feature that uses it.

### D23 — Billing detail header source (added during the plan review): the existing Tariffs operation

**Decision:** the billing-period detail header (A12.4 "tariff/currency/timezone") reads the tariff name, currency and timezone from the existing `Tariffs` operation by matching the period's `tariffId` (renderer-only). Usage & Cost becomes a mount-driven consumer of `Tariffs`, as History and Settings already are: no interval, no new operation, no contract or main-process change. `billVerified` is not derived in Usage & Cost: `BillingPeriod` results select no tariff-version link, so inferring a version from effective dates could show an unverified bill as verified; the bill's own status (ESTIMATED) and reason (TARIFF_NOT_BILL_VERIFIED) remain the truth and verification stays visible in Settings → Tariffs, where versions are listed. While `Tariffs` is loading or has failed, amounts print without a currency code and a notice says the currency is not shown because the tariff details are loading or could not be loaded (header "Loading tariffs…" or "Tariffs unavailable", with the existing "Retry tariffs").
**Recorded P1 exception:** this adds one `Tariffs` request (a full tariff list with versions; `useSolarQuery` sets no `staleTime`, so each visit to Usage & Cost issues it) every time Usage & Cost mounts. D03 declined a comparable extra request on Overview because `CollectorStatus.policyVersion` already supplied the data; here no selected field supplies the tariff currency, the brief requires the content (A12.4) and a field addition would be a contract change. The owner may veto and choose the field addition or amounts without a currency code.
**Why:** the brief requires the content (A12.4), `PeriodFields` carries only `tariffId` (`dashboard.graphql:85-91`) and Usage & Cost requests no tariffs today (`UsageCost.tsx:132-151`), so the data needs a source. The existing operation is the least-impact one (no new operation, no field addition, no timer); a field addition would be a contract change needing separate approval.
**Mockup divergence:** none expected; the mechanism is invisible in the frames.

## Findings from the analysis (not decisions)

- **F1 — Window creation waits for the connection check.** `main/index.ts:50-51` awaits `client.initialize()` before `createWindow`, and `initialize()` awaits `checkConnection()` (`api-client.ts:99-109`), a `CollectorStatus` request with a 10 s timeout. With the NAS unreachable at launch the window does not appear for up to 10 s, which A13 ("render the first useful surface immediately") does not describe. A fix needs a new initial connection state across main, preload and the bridge contract, so it is a separate main-process work item, not part of the redesign implementation. No decision is taken; the interim behaviour is unchanged.
- **F2 — Forget can leave the token on disk** (D08). Separate main-process decision outside this redesign.
- **F3 — TLS_MISMATCH "Forget connection and set up again" has no `.catch`** (`App.tsx:352-357`, in the branch that starts at `:333`): a rejection is unhandled in the renderer. Routing still works through the NOT_CONFIGURED broadcast. Pre-existing; the implementer should add a catch while touching that block.
- **F4 — Flow animation has no in-app pause.** The dash loops indefinitely and only the OS reduced-motion setting stops it (`globals.css:241-246`). WCAG 2.2.2 (Pause, Stop, Hide) may apply; this is pre-existing and not settled here. Verify during the rendered accessibility pass; an in-app control would be a new behaviour needing approval.
- **F5 — Citation drift (fixed):** `BRIEF.md` A8 cited `globals.css:207-220` for the flow rules, now corrected to `:231-246`; B22 and D3 cited `electron-builder.yml:21` and `:1-28`, corrected to `:20` and `:1-27` (see D19).
- **F6 — Backend nuance (not for change under P1):** the internal `LiveStatus` `activePolicy` query orders by `effectiveFrom` only, while `CollectorStatus.policyVersion` also breaks ties by version (`api.resolver.ts:114-120` against `policy.ts:42-49`); only equal-`effectiveFrom` versions can diverge, and only in the grid source used for `accountingStatus`.

## Mockup divergences carried into implementation

| Decision | Frames | Implementation follows |
|---|---|---|
| D02, D22 | B3 collector frames ("None supplied", "Not supplied") | approved wording in `COPY-APPROVALS.md` |
| D03 | B3 policy row, its Retry and Refreshing frames | version number inside the collector region |
| D08 | B7 forget pending and failure specimens | not implemented (first run appears) |
| D13 | B9 and B10 C7 frames | not-found message on a false result |
| D16 | B5-78 and the B11 cloud frames | UNAVAILABLE chip plus reason |
| D17, D21 | B12-41 to B12-60 | candidate B at 16 px, chrome slot only |
| D07 | B6-35 | not applicable (not implemented) |

## Still deferred or gated (no decision needed to start the desktop slices)

D06 (recalculation), D19 (R-brand-package), D20 (native export), R-client (web and native delivery), the cloud contract (A12.13), and findings F1, F2 and F4.
