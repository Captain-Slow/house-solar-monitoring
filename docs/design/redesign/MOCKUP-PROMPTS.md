## Part E — Mockup prompt batches

Copy this entire Part E verbatim to `docs/design/redesign/MOCKUP-PROMPTS.md`. Paste one batch at a time into Claude Design. Each batch is a separate review gate; do not run later batches automatically.

**Attachment set for every batch:** `BRIEF.md`; all nine `docs/ui-audit/img/ref-01-*.webp` through `ref-09-*.webp` Motrix Windows references listed in A0; retained `docs/ui-audit/img/redesign/solar-S1.webp` through `solar-S12.webp` plus `solar-S13-native.webp`. From batch 2 on, also attach the approved batch 1 design-system sheet. If an attachment is missing, identify it before proceeding; do not substitute internet imagery or real household data. Retained images are not fresh-runtime proof.

**Manifest columns and frame convention:** defined in A0 of `BRIEF.md` (“Batch deliverable conventions”), and each block below cites them, so a block pasted with `BRIEF.md` and its attachments is self-contained. Nothing in this preamble, Part B, Part C or Part D governs a batch.

### E1. Batch 1 — Foundations and design-system sheet

```text
Attach BRIEF.md, the Motrix reference images and the retained Solar captures listed in A0.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Create the batch 1 design-system sheet strictly from BRIEF.md. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 1 only. Establish the design-system sheet from A0–A11 and A15–A18.

Produce separate numbered sheets as needed for typography and tabular numerals; neutral/energy/status colors with the stated contrast pairs and prohibited pairings; opaque materials; spacing/radii/layers; motion/reduced motion; iconography; and every A11 component with every applicable interaction/request/mutation state.

Show all six energy identities as labels + shapes + line patterns in normal color, grayscale, protanopia, deuteranopia and tritanopia simulations. Color alone is not an acceptable distinction. Show A4's text rule and stale-text specification: Battery charge and Grid export as neutral text with a colored swatch, stale/grayscale panels with neutral text and energy colors only on non-text marks, and the calculated post-filter ratios labelled as calculations, not measurements. Include visible focus on active sidebar, primary button, input, select, textarea, reason trigger and dialog close; control boundaries; forced-colors intent; reduced-transparency solid fills.

Use 1280×800 sheets, a 1600×1000 expanded sheet, and at least one 914×672 compact component/state sheet. Include 320×800 web/iOS/Android stress sheets demonstrating text wrap and touch targets with logical units labelled.

Use the existing lucide Sun glyph (A14) as the brand-slot placeholder; do not design a new logo yet. Reserve the A11 startup/brand slot so batch 12 replaces an asset, not the component system.

Show the exact A18 live snapshot, today-so-far partial coverage, fictional month total, MYR 138.29 ESTIMATED bill, known zero and unknown value. Do not label the sample bill COMPLETE.

Return the token/component index and deviations/conflicts with the images. This sheet becomes the fixed source for later batches.
```

### E2. Batch 2 — Shell, navigation and responsive structure

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 2 only. Design A6/A7/A10 shell and navigation, preserving the current five destinations and the separate desktop Settings action.

Full shell state set: populated; loading; empty/no-data; stale; offline/reconnecting with and without retained data; partial data; refreshing; error with the appropriate Retry or security-specific recovery. Make connection, freshness, source and role separate signals.

Show Electron at 1280×800 and 1600×1000, with a 914×672 compact reconnecting frame. Keep the custom caption controls, 40 px drag strip, no-drag actions, 200 px sidebar and Overview-without-extra-panel rule. Include current/hover/focus nav states and caption maximize/restore states.

Show web at 1280×800 and 320×800 without fake Windows chrome, including drawer closed/open/focused/dismissed. Show separate 320×800 logical iOS and Android frames with native bottom navigation, safe areas and native back behavior. Apply the full shell data-state set to each surface, splitting frames as required.

Include ADMIN, VIEWER and UNKNOWN role variants. Settings is not grayscale on reconnect. A saved old admin role must not leak into a new or unverified connection.

Do not invent web/native login, pairing, TLS-probe controls, notifications, search or a house switcher. Mark client delivery/trust as the R-client prerequisites (A0, A12.14) outside the product UI. Startup workflow details and the root error surfaces (local settings-read failure, first run, AUTH_FAILED, TLS_MISMATCH, which show root caption chrome and never the connected shell) belong to batch 11.
```

### E3. Batch 3 — Overview and live power flow

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 3 only. Design A12.1 using A11's flow and metric contracts.

Full state set for live, collector and daily-energy regions: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. Include both retained-data and never-received-data offline cases.

Use the fixed 1 Mar live snapshot: 5.40 kW Solar, 1.70 kW Home, 1.88 kW export, 1.60 kW charging, SOC 60%, age 2 s. Today's totals are the A18 today-so-far values with 50% whole-day coverage, not the completed 18 Feb totals.

Show known zero/idle, missing grid/home due to METER_LINK_DOWN, no data, stale 120 s and reconnecting 6 min variants. Preserve source, coverage, reasons and provisional/unvalidated accounting. Include the per-phase and per-string power lists (W only, API index order, no phase labels) and the vendor-load reason as secondary detail; A18 supplies none of these values, so label them not supplied. Voltage, current, frequency and power factor are not available from the current API (A12.1): do not draw them.

Show labelled arrows and all three flow-width tiers (idle: unknown or under 100 W; normal: under 2000 W; strong: 2000 W and over; A11), with no movement or directional arrow on unknown/zero connectors. Include the textual flow summary and reduced-motion static frame.

Use A0's page/list frame convention for Electron 1280×800, web 320×800, iOS 320×800 pt and Android 320×800 dp. Add 914×672 stale and 1600×1000 populated Electron frames. At compact/text zoom, reflow and scroll; never clip values or shrink typography to preserve square tiles.

No house illustration, installed-capacity fields, inverter control, forecast or savings card.
```

### E4. Batch 4 — History, gaps and chart access

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 4 only. Design A12.2 and the complete A11 power/energy/SOC chart contract.

Full state set for each chart and its equivalent table: populated; loading; empty/no points; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. Include the real failure boundaries, not only a whole-page failure: PowerSeries (the power chart and SOC chart share one request and load, refresh and fail together with one Retry), EnergyTotals (energy chart, coverage line and tariff-window table) and Tariffs (the selector only). Do not show power failing while SOC succeeds from the same request; extrema-only or all-null SOC are render states of a successful response.

Show day/week/month/year/custom controls, From/Through local dates, invalid range, timezone loading and optional tariff selection. Where A18 lacks detailed points for a range, show the control/layout and explicitly not-supplied data rather than inventing another curve.

Use A18's completed 18 Feb curve, its exact 12:00–14:00 gap variant (91.67% of that day; the same gap is 99.7% of the February window, A18.2–A18.3), its extrema-only SOC variant and the fixed month totals. Legend, tooltip and inspection text is neutral (A4); energy colors appear only on lines, markers and swatches. Label units, date range and Asia/Kuala_Lumpur. Null is a gap, never zero or interpolated. Preserve grid/battery signed conventions and six energy identities.

Show visible legends, pointer tooltip, keyboard inspection, focus order, Escape exit, equivalent data table and its bounded 50-row paging pattern. Include no-hue and reduced-motion variants. No ECharts draw/update animation.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800 logical frames. Add a 914×672 gap/keyboard-focus frame and a 1600×1000 populated comparison frame.

Do not fabricate cost history, smooth over gaps, imply an unsupported server bucket width or add a new polling interval.
```

### E5. Batch 5 — Usage, costs and billing-period detail

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 5 only. Design A12.3 and A12.4.

Full state set for energy totals, billing-period list and selected detail independently: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. Also distinguish no selected period, result not calculated, ESTIMATED, UNAVAILABLE and recalculation pending.

Show daily, monthly and billing-period energy ranges with visible dates/units/provenance/coverage. Use only A18's supplied day/month/today values. No invented daily monetary trend.

Show billing period 801, 1–28 Feb inclusive, tariff 301, MYR 138.29 ESTIMATED, the exact aggregated returned line amounts and reasons, opening/expired/closing NEM kWh lots. Never split the returned ENERGY line into invented peak/off-peak line items, call NEM a cash export payment, or label this fictional tariff bill-verified. Null quantities and rates differ from a zero amount and from an unavailable line.

Include compact line-item/lot layouts, keyboard period selection, refresh preserving selection, partial energy with uncertain cost (use A18.3's gap-month totals, which supply no bill: show cost not supplied, or the retained MYR 138.29 baseline result flagged “Recalculation pending”; never pair changed energy with an apparently recalculated bill), and a current UNAVAILABLE result with COVERAGE_BELOW_80. A future cloud-only VENDOR_DATA_ONLY result is a separately annotated prerequisite-blocked frame.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add 914×672 detail/error and 1600×1000 populated Electron frames.

The proposed requestRecalculation action is a labelled prerequisite-blocked annotation for separate product approval, with proposed ADMIN pending/failure states shown only as such. Do not present it as currently callable; do not add it to viewer controls.
```

### E6. Batch 6 — Data Quality and reconciliation

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 6 only. Design A12.5 and A12.6.

Full state set for collector/devices, configured policy, events, daily inverter-counter comparison, reconciliation and calculation runs independently: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. List the state of every region in each manifest row.

Use A18's device/policy/event/run fixtures and readings #901/#902. Show the exact candidate ratios/verdicts with 100% coverage, then A18.4's two coverage variants separately: shared-gap (99.7% of the 672 h reading window; METER_NET export FAIL) and insufficient-coverage (96.43%; INSUFFICIENT). Coverage is relative to the whole reading window, never the day's 91.67%. A fictional candidate PASS does not validate physical wiring or the active policy.

Include no readings, one reading, no selected pair, identical pair validation, pending comparison, failed comparison and retained-pair refresh. Keep From reading/To reading labels.

Show event From/Through filters, invalid/cleared dates and cursor reset. Select 1 Feb–1 Mar to show the 20 Feb COUNTER_JUMP_REJECTED point record (end and device “—”); the default range (first of the month to today) excludes it. Beside the complete baseline show only baseline-compatible event records; the GAP, meter-link, source-change and cloud-failure rows belong to their own variant frames (A18.5). More events replaces the current 100-event page; do not invent accumulation, Previous, search or filters the API/UI does not expose.

Show run DONE/RUNNING/FAILED as returned records without fake percent progress, source/version/backup/error details where A18 supplies them, and plain not-supplied placeholders for absent fixture metadata. A18 contains no vendor counter values: show labelled not-supplied cells in the daily comparison, never invented lifetime or vendor-today figures.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add a 914×672 reconciliation/partial frame and a 1600×1000 populated Electron frame. Include a readable narrow comparison layout or bounded labelled table scroller.

No automatic calibration, best-policy switch, physical-device command or new notification product.
```

### E7. Batch 7 — Settings shell and connection detail

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 7 only. Design A12.7 and A12.8, not the full first-run sequence.

Full state set: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. For the static six-category landing, explicitly mark empty/global-loading as not applicable and show the connection/active-category state instead. Never remove categories because a query failed.

Show Connection, Tariffs, Billing, Accounting, Exclusions and Meter readings. Desktop uses the measured grid and one active dialog; narrow web/native uses category list and full-screen detail. Include keyboard focus, close/Escape/back, trigger focus restoration, scroll body and reachable footer at text zoom/software keyboard.

Connection detail shows only A18's fake endpoint/fingerprint and “Token stored: Yes” indicator, plus role. Show local forget-connection pending/failure (a proposed presentation; today only a failure message exists) and the retained safe state. Show the Settings local-read states too: today pending or failed leaves URL and fingerprint as “—” with Token stored “No” and one shared message, so draw a labelled proposed loading/Retry variant instead of presenting “No” as verified. Credentials are never visible.

Include ADMIN, VIEWER and UNKNOWN variants, a proposed dirty-category marker and draft persistence across category close/reopen and category change (current behavior while the Settings destination stays mounted). Show draft retention across a destination change as the owner-approved behavior (A11), labelled not current; today drafts do not survive leaving the Settings destination. Each category's data loads when that category opens (owner-approved, A16; labelled not current), so show the open category's own loading state on first open. Settings stays ungreyed on reconnect, but remote role-gated mutations are unavailable.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add 914×672 open-dialog/keyboard-focus and 1600×1000 category-grid Electron frames.

Web/native trust details remain blocked under the A0 R-client gate; do not transplant Electron certificate probing or safeStorage into those mockups. First-run/auth/TLS flows are batch 11.
```

### E8. Batch 8 — Tariffs, versions, holidays and monthly rates

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 8 only. Design A12.9 with the current four mutation workflows.

Full state set for tariff/version list, holidays and monthly rates: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry.

For CreateTariff, CreateTariffVersion, SetTariffHolidays and SetMonthlyRate, show pristine, dirty, validation error, pending, success and failure, plus VIEWER/UNKNOWN read-only variants. A failure preserves the non-secret draft; a confirmed success returns that form to pristine and keeps its success message (owner-approved, A11; labelled not current). Do not replace the existing JSON rules mechanism with an invented form-builder product. A18 describes the tariff's rates and structure but supplies no canonical rules JSON payload: show the editor with labelled not-supplied or structural placeholder content and do not reconstruct a backend rules schema.

Use tariff 301/version 3011 and A18's rates, source note, fictional holiday and known-zero AFA monthly rate. Show six-fractional-digit validation and the distinction between missing monthly rate and zero rate. State that saving holidays replaces the selected year's list; there is no per-holiday delete API.

Show unverified tariff state and the real-bill operational gate. No Verified checkbox, imported real bill, cash export price or guessed TNB rates.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add 914×672 invalid-JSON/pending form frames and a 1600×1000 populated Electron frame. Demonstrate JSON wrapping/scrolling, full labels, keyboard focus and a reachable Save action.
```

### E9. Batch 9 — Billing, accounting policy and exclusions settings

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 9 only. Design the three separate A12.10 categories; do not merge them into one new administration page.

For each category's list/detail, show the full state set: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry.

For UpsertBillingPeriod, CreateAccountingPolicy, CreateDataExclusion and DeleteDataExclusion, show pristine, dirty, validation, pending, success and failure (a failure keeps the draft; a confirmed success returns the form to pristine with its success message, A11). Include destructive confirmation for exclusion deletion and VIEWER/UNKNOWN read-only states. Ambiguous request failure must not imply rollback or auto-resubmit.

Billing uses 1–28 Feb inclusive, period 801 and the A18 opening lots. Make inclusive date guidance explicit. Accounting uses policy version 7 and provisional/unvalidated status; no automatic policy promotion or calibration. Exclusions uses #1201 outside February, so the baseline month's full coverage remains consistent.

`CreateAccountingPolicy` returns recalculation/retention effects (invalidated billing periods, an outside-retention boundary and a calculation run) that today's UI does not display, and A18 supplies none: show those slots as labelled not-supplied placeholders; the billing-period mutation returns the period record, not such effects, never a fabricated progress percentage or an enabled schema-only requestRecalculation action.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add 914×672 dirty/error category frames and a 1600×1000 populated Electron frame. Keep UTC/site-local labels unambiguous, JSON decimals as strings and focus/submit/close reachable.
```

### E10. Batch 10 — Meter readings and paging

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 10 only. Design A12.11 and the reading-picker/pager states shared with A12.6.

Full state set: populated; loading; empty; stale; offline/reconnecting; partial data; refreshing; error with scoped Retry. Include first-page loading, more available, loading-more, next-page failure with retained rows, all loaded and refresh owning the request.

Use only readings #901/#902 and their exact counters/timestamps. If illustrating more pages, use skeleton rows and explicit structural annotations, not invented real-looking readings. Keep counts consistent with the shown fixture; do not claim 50 populated readings exist.

Show AddMeterReading pristine, dirty, validation, pending, success and failure (success returns the form to pristine with its success message, A11). Show DeleteMeterReading selection/confirmation/pending/failure, keeping the current sequence: select a reading (or type its ID), then a confirmation that names that ID (A12.11). Include VIEWER/UNKNOWN read-only variants.

Keep the accessible pager labels, loaded-count wording and independent refresh behavior. A late old-backend page must never appear after connection reset; show the cleared new-connection state.

Use A0's page/list frame convention for Electron 1280×800 and web/iOS/Android 320×800. Add a 914×672 next-page-error frame and a 1600×1000 populated Electron frame. Include keyboard selection and the narrow list layout.
```

### E11. Batch 11 — Startup, security and cloud-prerequisite states

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 11 only. Design A12.12–A12.14 and A13 with the existing placeholder mark, not the new brand asset.

Full request state set: populated/saved connection; loading; empty/not configured; stale retained data; offline/reconnecting; partial setup/data; refreshing/recheck; error with the operation-specific Retry or safe recovery. Full mutation state set: pristine, dirty, validation, pending, success and failure for URL, pin and token actions, respecting secret clearing.

Produce every desktop step in A12.12: local initialization, the local settings-read failure “Connection settings unavailable” (no in-surface Retry today; show the owner-approved Retry, labelled not current), URL input/invalid, probe pending/failure, fingerprint comparison, pin pending/failure, token entry/test/rejection/success, AUTH_FAILED, TLS_MISMATCH, connected loading/no-data and reconnecting with/without prior data. Caption controls remain available.

Web and native trust/enrollment is prerequisite-blocked, not an Electron pinning clone. Show their known layout/state shell and explicit outside-UI dependency notes; do not invent a pairing mechanism, browser certificate API or secret-storage implementation.

For the future cloud-stopgap surface, show populated, loading, empty, stale, offline/reconnecting, partial, refreshing and error/Retry as annotated prerequisite frames. Where A18 provides no cloud measurement payload, use named not-supplied slots, not baseline MODBUS numbers. Cloud-only billing is UNAVAILABLE/VENDOR_DATA_ONLY. Never animate cloud flow or call it live.

Use Electron 1280×800, web/iOS/Android 320×800 logical frames, a 914×672 security-error frame and a 1600×1000 setup frame. Include reduced-motion/static and font-failure startup without delayed controls. No fake progress, timed blocking splash or hardware/cloud-account action.
```

### E12. Batch 12 — Approved brand and startup prototype specification

```text
Attach BRIEF.md, the Motrix reference images, the retained Solar captures listed in A0 and the approved batch 1 design-system sheet.
Follow A0's hard constraints and use A18's fictional data verbatim.
Return the numbered frame manifest defined in A0 (all A0 columns) before producing frames.
Stop after this batch until I say "next".
Reuse the attached approved batch 1 design-system sheet. Invent no new tokens or components.
Where an attached image conflicts with BRIEF.md, BRIEF.md wins; report the conflict to me.

Batch 12 only. The owner approved the logo and startup scope below. Design A14's original mark and wordmark and A13's non-blocking startup presentation, using the existing brand slot rather than new tokens/components.

Deliverable requirements: a mark-only and a horizontal “Solar” wordmark in Google Sans; monochrome light and dark and one solar-accent composition; specifications for editable vector source and for clean SVG exports with no embedded fonts, scripts, external resources or proprietary image fragments (later implementation produces the files; this batch does not); small-size previews at 16, 24, 32 and 52 px and Windows icon previews at 16, 32, 48 and 256 px on the actual shell and card backgrounds and in monochrome/grayscale; report any shape that resembles a connection or fault indicator; do not alter the energy palette to suit the logo; keep the full product name “House Solar Monitoring”. The startup prototype is specified as local HTML/CSS plus the SVG: no video or animation framework, credentials, backend requests, telemetry or installer hooks; at most one 200 ms opacity appearance with no minimum dwell; fully static under reduced motion; setup and error content takes over immediately; once the app is usable the mark is gone, including from the accessibility tree; prefer SVG paths over text that waits for a font; a pre-React surface may not need inline scripts (the current CSP allows inline styles but not scripts). Pass criteria: setup/error controls appear without waiting for the animation; close and minimize remain usable; no fake progress; no extra network or polling work; a font failure cannot strand the user behind the mark.

Produce mark-only and Solar wordmark, monochrome light/dark and one solar-accent variant as design frames, plus the editable vector construction and SVG export specifications (batch 12 returns design frames and specifications; it does not modify the repository, production assets or packaging). Show the exact A14 small-size/platform previews and clear space. No Motrix logo, proprietary artwork, brand tracing or embedded font asset.

Show static/reduced-motion, permitted cold-start opacity appearance, immediate setup/error takeover, warm start, reconnect and native-resume states. The decorative appearance is at most the existing 200 ms token, never a minimum wait or loading percentage.

Show Electron 1280×800 and 1600×1000 application contexts, at least one 914×672 compact startup/security-error frame, and separate 320×800 web/iOS/Android logical contexts. Native launch surface is static; no fake Windows chrome.

Return original vector construction/export specifications and a local HTML/CSS prototype specification with no backend/network calls. Do not change production assets or packaging flags. Document the R-brand-package gate (A14: the current builder configuration has no icon and sets `signAndEditExecutable:false`, so production icon work needs its own packaging decision) and the native-toolchain export prerequisites separately.

The owner chooses a mark before any implementation. Stop; do not start a new batch or produce code/assets outside this approved design scope.
```

