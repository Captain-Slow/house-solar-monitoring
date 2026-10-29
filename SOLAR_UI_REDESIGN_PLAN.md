# Solar UI redesign — design brief, gap audit, safe fixes and brand specifications

## Context

Create a detailed design handoff for House Solar Monitoring, using the Stash redesign plan's part structure only. Deliver `SOLAR_UI_REDESIGN_PLAN.md`, Part A alone as `docs/design/redesign/BRIEF.md`, and Part E verbatim as `docs/design/redesign/MOCKUP-PROMPTS.md`. The product remains a monitoring-only client of backend collection, accounting and pricing; no interface controls the inverter, battery or gateway (`SOLAR_MONITORING_PLAN.md:5-10`).

The owner approved design coverage for the Windows Electron app, a responsive web client, and separate native iOS and Android clients; original logo and startup-animation specifications; and Claude Design as the mockup tool. Web and native clients are new design surfaces, not existing implementations. Their security and delivery prerequisites are explicit backlog gates, not permission to weaken the desktop trust boundary.

This document supersedes `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md`. The replacement retains its useful decisions, not its obsolete implementation checklist. The desktop already uses the selected stack, Google Sans, sidebar, tiles, dialogs and custom caption controls (`apps/desktop/package.json:14-47`; `apps/desktop/src/main/index.ts:18-34`; `apps/desktop/src/renderer/App.tsx:398-475`). The original audit's 0.77/3 score describes the pre-redesign UI, not the current source (`docs/ui-audit/desktop-ui-audit.md:9-14,53-57`; `TODO.md:9`).

**Authority and approved exceptions**

- Retain Tailwind v4, Base UI, cva, tailwind-merge and lucide for Electron and web. This explicitly carries forward the override of the product plan's historical “No UI kit” instruction at `SOLAR_MONITORING_PLAN.md:378`. Native clients reproduce the design contract with native accessible components; this does not select a native implementation framework.
- Retain Google Sans, dark only, an opaque Windows window, no blur/Mica/vibrancy, and the prohibition on non-MIT Motrix assets. Alpha compositing over an opaque app-owned background is not desktop transparency.
- Preserve accounting, pricing, GraphQL operations, polling intervals, freshness decisions, role gating, connection epochs and pagination semantics. The owner explicitly permits W/kW formatting, complete Retry/dirty/pending states and keyboard-accessibility improvements after mockup approval, with affected tests changed atomically. On 2026-10-30 the owner also approved, in conversation, five Settings/startup behavior changes for later implementation: (a) a form returns to pristine after a confirmed successful save; (b) Settings drafts are retained across destination changes; (c) the startup local-settings-read failure gets a Retry; (d) mutation invalidation is narrowed to the affected queries; (e) Settings queries are requested only when their category opens. They are specified in A11, A12.7, A12.9, A12.10, A12.12 and A16. They change request timing and form behavior inside the Settings and startup flows only: accounting, pricing, GraphQL operations, the 10 s/30 s polling, freshness, role gating, connection epochs and pagination semantics are unchanged, the approval is not implementation authorization, and each change needs its own tests changed atomically.
- The owner explicitly approved removing whole-panel 64% opacity while retaining grayscale, exactly the same stale conditions, last-known values and stopped flow animation. This removes the opacity cause of the retained 3.11–3.52:1 stale-text contrast failures without pretending the old style passed AA. Whether the remaining grayscale text and graphics pass AA is not assumed: A4 gives a conservative stale-text rule, and S1/A4 require a rendered-contrast gate.
- The sample export tariff is NEM kWh-credit equivalence, not a cash export-price feature. No independent export-rate field is introduced.
- “Solar” remains the short wordmark; “House Solar Monitoring” remains the product/window/package name. No product rename is needed to design the approved mark.

**Planning evidence limits:** local files and retained images only. No app, NAS, hardware, cloud endpoint, package install or network request was run for this plan. Fresh work consisted of source review, local numerical calculations and independent reviewer checkpoints (reviewer-claude for the original plan; reviewer-openai for the later revision, recorded in Verification). Retained measurements are dated evidence, not fresh runtime acceptance; some current layout classes postdate them.

## Approach

### Documentation delivery authorized by this task

Approval of this planning task authorizes only the document handoff and the explicitly requested removal of the superseded plan. It does not authorize implementing Part C, generating brand assets, launching the app, installing packages, changing a schema, committing or pushing.

0. **Preserve the baseline.** Work from the current source, not the pre-redesign audit checklist. Do not overwrite unrelated work. Read the destination files if they have appeared since planning; merge owner additions rather than replacing them blindly. Use only already-installed dependencies for checks. If they are unavailable, record the missing prerequisite; do not install or fetch anything.
1. **Publish the replacement.** Copy this complete document to root `SOLAR_UI_REDESIGN_PLAN.md`. Extract exactly the `## Part A` section through A18, stopping before `## Part B`, into `docs/design/redesign/BRIEF.md`. Extract exactly `## Part E` through its last batch, stopping before `## Critical files & anchors`, into `docs/design/redesign/MOCKUP-PROMPTS.md`. No added wrapper, preamble or shortened version in either extract. These operations do not touch application code. Part A is the only governing document the design tool receives besides one pasted Part E block, so every requirement, label, fixture and convention a batch needs must be defined in Part A or inside that block; nothing in this Approach, Part B, Part C, Part D or the Part E preamble governs a batch.
2. **Review the three documents together.** Use an independent reviewer (reviewer-claude and reviewer-openai checkpoints are recorded in Verification) to check source citations, current-versus-historical findings, every screen/state, the fixed fictional dataset, color arithmetic, API prerequisites, safe-fix scope and prompt-to-brief consistency. Correct confirmed findings in the root document, then regenerate both extracts. Verification specifies the exact acceptance checks. Run `npm run typecheck -w apps/desktop` and `npm test -w apps/desktop` from the repository root if the installed toolchain is present; record actual outcomes, never copy historical counts.
3. **Complete the supersession.** Only after step 2 accepts the replacement and exact extracts, delete `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md`, as explicitly requested by the owner. In `docs/ui-audit/desktop-ui-audit.md:57`, recast its Step 11D sentence as a historical target and point future compact-overflow verification to this plan. At `:171`, retain the complete 1–12 step legend and “Revised” explanation so the audit's historical dispositions remain intelligible; add that the old plan is superseded/removed and `SOLAR_UI_REDESIGN_PLAN.md` owns current design, gaps and verification. Preserve all historical findings and measurements. Do not remove images, captures or the product plan. Repeat both desktop commands and document-consistency checks. These are the only additional existing documentation edits required for the cutover.

Every numbered delivery step must leave the desktop typecheck and test contracts intact. If a gate fails, report the exact failure and do not make unrelated source changes to turn this documentation task into a bug-fix task.

**Delivery status (2026-10-30).** Steps 1–3 above have been carried out on the owner's explicit instruction: `docs/design/redesign/BRIEF.md` and `docs/design/redesign/MOCKUP-PROMPTS.md` were written as exact slices of this document (byte comparison matched when they were created; regenerate both after any later change to Part A or Part E), `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md` was deleted (it remains recoverable from git history), and `docs/ui-audit/desktop-ui-audit.md` lines 57 and 171 were updated as step 3 specifies. `npm run typecheck -w apps/desktop` exited 0 and `npm test -w apps/desktop` passed 16 files and 102 tests in the same session. At that point nothing had been committed or pushed and no application code, schema or dependency had changed (a historical snapshot of that documentation session; later status is recorded under S1 and S2 in Part C). The steps are kept above as the procedure that was followed.

### Dependency order for later implementation, not authorized now

Each later step ends with `npm run typecheck -w apps/desktop` and `npm test -w apps/desktop`. Modify a broken presentation assertion in the same step as its production change; never postpone test updates to a final migration step.

4. **Apply the independent safe fixes in Part C after separate implementation authorization.** S1 stale contrast touches `panel-shell.tsx`; S2–S3 share `globals.css` and one owner integrates those stylesheet changes sequentially. S4 is independent. No dependency installation or renewed Motrix port is needed. (Status: S1–S4 were implemented on the owner's instruction on 2026-10-30; see the Part C implementation status for the rendered gates that remain.)
5. **Produce and approve foundations before screens.** Execute Part E batch 1, then batch 2. The owner reviews each numbered frame manifest before frames. Freeze the accepted token/component sheet. Advance one batch only when the owner says “next”; approval of this plan is not approval of all future mockups.
6. **Approve the data screens and administration flows.** Execute batches 3–11 in order. Every current screen and every product-plan commitment in A12 is covered. A proposed desktop recalculation control is a labelled, separately approval-gated extension of an existing backend mutation, not a current/planned Electron view. Blocked prerequisites remain visibly annotated in mockups. Do not implement backlog capabilities merely to make a frame appear complete.
7. **Approve brand prototypes independently.** Execute batch 12 against Part D. The owner chooses the mark before any production asset replacement. Startup presentation never gates connection initialization, first usable data or input. Do not enable signing/resource-editing flags as part of a design prototype.
8. **Implement approved desktop presentation in building slices.** First semantic tokens and shared accessibility, then shell/reflow, Overview, History, Usage & Cost, Data Quality and Settings. Reuse the existing `PanelShell`, `Metric`, `Reason`, `Chart`, `SettingsDialog`, `useSolarQuery`, `useMeterReadings` and date helpers. A12 specifies the behavior and B5 specifies atomic test changes. Keep current operation selection and cursors unless a separately identified prerequisite is approved. No new automatic refresh interval, router or persistence layer. The owner-approved Settings/startup behavior changes (Context) belong to the Settings slice; draft retention is an in-memory state lift, not a persistence layer.
9. **Deliver other clients only through their prerequisite gates.** Web and native mockups share data semantics, not the Electron bridge. R-client requires a separate owner-approved delivery/security specification before implementation; no web/native source scaffold belongs to this documentation task. Cloud frames similarly require the A1 backend/contract gates, not a renderer workaround. These prerequisites do not block desktop design review.

## Part A — Design brief for Claude Design

### A0. How to use this brief and hard constraints

Design a monitoring interface that makes energy direction, coverage, source and cost uncertainty clear. Start with foundations, then shell, then the most-used data screens, then administration. The batch order is in `MOCKUP-PROMPTS.md` (Part E of the root plan); this brief plus one pasted batch block and its declared attachments are self-sufficient, and nothing else governs a batch. Do not import Stash content, navigation, imagery, Mica, materials, timings or sample data.

**Hard constraints**

1. Dark only. Google Sans everywhere, including chart labels, JSON editors, fingerprints and native mockups. Existing package is `@fontsource-variable/google-sans` 5.3.2 (`apps/desktop/package.json:16`). Use system fallback only for missing glyphs/font failure, not as an alternative visual direction.
2. Motrix stack on Electron/web: Tailwind v4, Base UI, cva, tailwind-merge, lucide. Native iOS/Android use equivalent semantics and platform focus/accessibility behavior, not a pretend DOM/IPC bridge.
3. Opaque app-owned surfaces. No backdrop blur, Mica, Acrylic, vibrancy, frosted panels, luminous glass art, shader effects or wallpaper-dependent contrast. Windows uses a hidden native title bar with custom caption buttons; do not replace it with `frame:false` (`apps/desktop/src/main/index.ts:18-34`).
4. Adapt Motrix's layout, spacing and interaction patterns only. Never crop or trace its logo, speed icons, settings icons, brand-install artwork or bundled SFNS font from screenshots. Current licensed Fluent Emoji settings illustrations may remain; new brand assets must be original (`docs/ui-audit/desktop-ui-audit.md:535-541`).
5. No inverter/battery/gateway controls, firmware actions, charging modes, automation, forecasts, savings estimates, export payments, push notifications, multi-house switcher or invented cloud login. Operating mode is read-only. Alerts mean existing faults and quality events, not a new notification product.
6. Use A18 verbatim. All house information, samples, identifiers and tariff figures are fictional. Attached captures are visual evidence only, never the source for account details or readings.
7. Preserve backend source, status, coverage, flags, reasons, timestamps and role decisions. Null is not zero. Missing chart points remain gaps. No fabricated live values, smoothing over outages, interpolated SOC average, optimistic success or fake progress.
8. A stale state retains last data and becomes grayscale; it does not dim the entire panel, and its text follows A4's stale-text rule. The exact conditions are unchanged: RECONNECTING greys data views; non-LIVE Overview is greyed, including NO_DATA; Settings is exempt. Stale flow never animates (`models.ts:162-182`; `App.tsx:363-396`).
9. Desktop live polling stays 10 s; collector status stays 30 s; other queries keep their existing request timing, except the two owner-approved Settings changes in A16 (queries requested only when their category opens; mutation invalidation narrowed to the affected queries). Retry is deliberate user action, not another timer. Server `ageSeconds`, not the PC wall clock, determines measurement freshness. Unknown/VIEWER roles do not expose ADMIN mutations.
10. Every screen gets the states listed in A12. Every component gets its applicable interaction states in A11. If a state cannot exist, label the frame/manifest entry “not applicable” with the specific reason; do not silently omit it or fabricate an API result.
11. WCAG 2.2 AA, keyboard access, visible focus, reduced motion, reduced transparency and text resizing apply to the whole experience, including charts, overlays, error states and startup.
12. Where an attached image conflicts with this brief, this brief wins. Report the conflict to the owner. Do not silently introduce a new token, component, feature or data field.

**Attachments and evidence priority**

- Motrix Windows references: `docs/ui-audit/img/ref-01-settings-advanced.webp`, `ref-02-settings-integration.webp`, `ref-03-settings-network.webp`, `ref-04-settings-network-alt.webp`, `ref-05-settings-grid.webp`, `ref-06-plugins.webp`, `ref-07-trackers.webp`, `ref-08-downloads-empty.webp`, `ref-09-dashboard.webp`.
- Latest retained Solar states: `docs/ui-audit/img/redesign/solar-S1.webp` through `solar-S12.webp`, plus `solar-S13-native.webp`. S1 Overview; S2 reconnecting; S3 History; S4 Usage & Cost; S5 Data Quality; S6 reconciliation; S7 Settings grid; S8 Tariffs dialog; S9 first run; S10 authentication failure; S11 TLS mismatch; S12 no data. The S13 file is not proof of an OS-level capture: the retained measurement explicitly records that limitation.
- Original captures at `docs/ui-audit/img/solar-S*.webp` and `solar-full-*.webp` are historical “before” evidence. Never treat their flat navy styling as the target. Motrix macOS captures are supplementary, not material authority.
- Source of truth: approved owner decisions and this brief; product data contracts; current code; retained redesign measurements; older audit. An old screenshot cannot override present code behavior.

**Frame sizes and numerical provenance**

| Frame | Size | Source and use |
|---|---|---|
| Primary desktop/web | 1280×800 CSS px | Explicit owner-requested design frame, not a claimed runtime measurement |
| Large desktop/web | 1600×1000 CSS px | Explicit owner-requested large frame |
| Compact Electron | 914×672 CSS px | Current default and minimum in `apps/desktop/src/main/index.ts:19-22`; also retained client measurement |
| Narrow web and native stress frame | 320×800 CSS px / logical pt or dp, identified separately | Width is WCAG 2.2 SC 1.4.10's 320 CSS px reflow target; height reuses the requested primary frame. For native it is a compact logical-layout stress frame, not a named device screenshot |
| Native acceptance | Device viewport with system insets shown separately | Also verify real iOS/Android device layouts later; never scale a desktop screenshot and call it native |

All geometry below comes from the local Motrix measurement scale or an identified standard. Primary/large frame dimensions come from the owner. New responsive dimensions are arithmetic compositions of that scale and are labelled as design targets, not measurements. Sample readings/dates in A18 are deliberate fiction, not design-budget measurements. WCAG/Core Web Vitals/platform standards are named requirements; they were not fetched during this local-only planning task.

**Delivery status labels**

- **Current:** the renderer and its operation exist.
- **Presentation backlog:** existing data supports the design, but the proposed interaction/visualization is not implemented.
- **Prerequisite blocked:** a missing API/client/security capability must be delivered separately. Display that label outside the product UI in the frame annotation; do not imply it is an available feature.

Two named prerequisite gates recur in the batches: **R-client** is the web/native delivery and security prerequisite set listed in A12.14; **R-brand-package** is the packaging gate stated at the end of A14.

**Current versus requested state.** An A12 heading such as “current” names an existing surface and operation. Unless a bullet is explicitly marked Current or states current source behavior, a state, Retry, refreshing indicator, dirty or pending marker, per-region message or reset behavior described in A11/A12 is a design requirement (presentation backlog), not an assertion that today's renderer already provides it.

**Batch deliverable conventions — manifest columns.** Frame number; brief subsection; surface (Electron/web/iOS/Android); dimensions and logical units; screen/region; state; A18 fixture/variant; Current / Presentation backlog / Prerequisite blocked label. A frame may cover multiple independent regions only if every region's state is explicitly listed. Never collapse the eight request states into a generic “edge cases” frame. For a genuinely inapplicable state, record the A12 reason instead of inventing content.

**Batch deliverable conventions — page/list frame convention.** For a page/list batch, complete state coverage is required for the listed page on Electron 1280×800, web 320×800, native iOS 320×800 logical pt and native Android 320×800 logical dp. Native frames are stress-layout mockups, not named-device screenshots. Add an Electron 914×672 constrained state and a 1600×1000 populated state to each such batch. If a batch needs multiple numbered frames to cover its regions and workflows, produce them; do not silently sample a subset. Reuse content, not one flattened screenshot scaled across platforms.

### A1. North star

A homeowner can tell what is producing, consuming, charging, importing or exporting; how current and complete that evidence is; and why a calculated charge is or is not trustworthy. The interface is calm and compact, but uncertainty is never hidden to make it look cleaner. Energy and status have separate visual languages.

### A2. Principles

1. **Evidence before decoration.** The value, unit, direction, source and age take precedence over artwork. No house illustration in the live power flow; the product plan explicitly specifies nodes and an inverter hub (`SOLAR_MONITORING_PLAN.md:409`).
2. **Keep planes simple.** A cyan-grey shell, inset content panel except on Overview, neutral opaque data tiles, opaque overlays. No decorative glass.
3. **Preserve meaning across platforms.** The same metric has the same color, label, precision and uncertainty in Electron, web, iOS and Android. Native navigation adapts; data semantics do not.
4. **Do not hide failure behind loading.** Loading means a request is pending without data. Refreshing retains results. Empty means a successful empty result. Stale means retained evidence, not a new measurement. Partial means some data is known. Errors name the affected request and recovery path.
5. **Keep comparisons honest.** Monitored interval totals, counter interval deltas, raw lifetime counters and vendor daily summaries occupy separately labelled columns. A visually smooth chart cannot substitute for coverage.
6. **Support deliberate administration.** Read-only roles can inspect configuration. ADMIN actions show local validation, pending and failure without erasing drafts or inventing success. No automatic calibration, tariff verification or policy promotion.
7. **Reflow rather than shrink.** Reuse the measured type scale, wrap controls and add vertical space. Do not squeeze long values below readable type sizes to preserve a decorative square.
8. **Make state redundant.** Text, arrow direction, marker shape and pattern carry meaning without hue. Focus, selection, warning, offline and partial are distinguishable from each other.

### A3. Typography — Google Sans

Use `"Google Sans Variable", "Google Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` plus system emoji fallbacks. Existing source sets optical sizing (`styles/globals.css:81-88`). Weights are restricted to 400–700, as recorded for the selected font (`docs/ui-audit/desktop-ui-audit.md:540`). No second monospace typeface; JSON, IDs and fingerprints use the same family, wrapping and tabular numerals.

| Role | Size / line height / weight | Evidence |
|---|---|---|
| Page title | 24 / 32 / 600, tracking −0.025em | `captures/local/ui-audit/measure/motrix-source-values.json:22-24`; audit `:100` |
| Dialog title / group heading | 14 / 20 / 500 or 600 | Audit `:113,371`; current dialog primitive and settings heading classes |
| Body, nav and ordinary labels | 14 / 20 / 400; labels/actions 500 | Measurement `motrix-source-values.json:14-16`; audit `:322` |
| Secondary text, tables, units | 12 / 16 / 400; badges 500 | Audit `:103-114`; current `Metric` and table primitives |
| Table heading | 11 / 16 / 400 | Audit `:110`; 16 px line-height aligns with measured 4 px scale |
| Tile label | 10 / 16 / 500, tracking 0.04em | Measurement `motrix-source-values.json:30-32` |
| Metric number | 32 / 32 / 600; unit 12 / 16 / 400 | Measurement `motrix-source-values.json:34-36` |
| Empty-state heading | 18 / 24 / 500 | Audit `:324,476`; line height derived from 4 px scale |

Tile labels and table headings use sentence case in the new mockups, not uppercase as a substitute for hierarchy. This is a permitted presentation change, not a new token scale. Keep the existing accessible names for the Dashboard tabs, four destinations, separate Settings action, From/To reading selectors, caption controls and reading pager unless an approved implementation changes the name and its interaction tests together.

Use tabular numerals for power, energy, SOC, money, rates, coverage and timestamps. Check the actual font's tabular figure output; a CSS declaration alone is not proof. Right-align table numbers and reserve consistent unit space. If tabular support is insufficient, use aligned fixed-width numeric columns, not a silently substituted font.

At 200% text size, label/value/unit/reason must remain available without clipping. Change layout and tile height before reducing the type size. Fingerprints and JSON wrap or use a clearly labelled bounded code region; never truncate security-critical values with ellipsis.

### A4. Color tokens with contrast ratios

The neutral palette is the current Motrix-derived palette (`styles/globals.css:91-128`), cross-checked against local Motrix source `D:/Github/Motrix/src/renderer/styles/globals.css:262-286` and local pixels. Hex values below are the rendered sRGB equivalents/reference samples; implementation retains existing full-color CSS tokens except the explicitly approved accessibility additions.

Ratios were recomputed locally with WCAG relative luminance: linearize sRGB using the 0.04045 breakpoint, `L = .2126R + .7152G + .0722B`, then `(Llighter + .05)/(Ldarker + .05)`. Rounded figures describe the stated solid pairs, not antialiased edge pixels or unmeasured runtime scenes. Normal text requires at least 4.5:1; large text and meaningful non-text graphics require at least 3:1. Do not round a failing value up to a pass.

| Token / role | Value | Contrast and allowed context |
|---|---|---|
| Window | `#09090b` | Opaque base; current main-window background |
| Content/header base | `#0a0a0a` | Existing `--background`; table headers |
| Inset panel | `#0a0a0a` at 65% over app shell | Reference top sample `#161e1f`; not wallpaper transparency |
| Card / popover | `#171717` | Existing `--card` / `--popover` |
| Overview tile | `#1e1e1e` → `#161616` | Opaque composite; use the existing gradient, not another blur layer |
| Well / selected neutral | `#262626` | Existing `--muted`, `--secondary`, `--accent` |
| Primary text | `#fafafa` | 17.18:1 on card; 15.97:1 on tile top; 14.50:1 on well |
| Secondary text | `#a1a1a1` | 6.94:1 on card; 6.45:1 on tile top; 5.86:1 on well. Never on sidebar/active nav: only 4.01/2.78:1 there |
| Primary button | fill `#e5e5e5`, text `#171717` | 14.23:1 |
| Sidebar | reference top `#2c4447`, bottom `#1c2b2d`; solid fallback `#213436` | Derived from hue 186, saturation 24%, app-owned 92%-alpha gradient; audit `:96,253`; `styles/sidebar.css:10-79` |
| Sidebar text | `#fafafa`; secondary `#e5e5e5` | On top: 9.94/8.23:1; on active sample `#475b5d`: 6.88/5.70:1 |
| Focus / interactive edge | Focus `#e5e5e5`; control edge `#a1a1a1` | Focus minimum 5.70:1 across the listed dark surfaces including active nav. Control edge 5.86:1 on well; use only on dark control surfaces |
| Decorative border | white 10% | Existing separators/card edges only; not sufficient by itself to identify a control |
| Input fill | existing white 15% token at current fill alpha | Preserve fill; strengthen the identifying edge separately, not by turning every separator bright |
| Modal scrim | black 20% | Measured reference; modal surface itself remains opaque |

**Semantic energy palette — one mapping everywhere**

| Quantity | Token assignment / sRGB | Ratio on card / lightest tile top | Redundant encoding |
|---|---|---|---|
| Solar | `--chart-4`, `#eba747` | 8.67 / 8.06 | Sun label, circle marker, solid line |
| Battery charge | `--chart-2`, `#7c76f9` | 4.97 / 4.62 | “Charge”, downward triangle, long-dash line, arrow into battery |
| Battery discharge | `--chart-3`, `#33cc6b` | 8.53 / 7.93 | “Discharge”, upward triangle, short-dash line, arrow out of battery |
| Grid import | `--chart-1`, `#2dc2eb` | 8.56 / 7.96 | “Import”, square marker, solid line, arrow from grid |
| Grid export | `--chart-5`, `#e05281` | 4.86 / 4.52 | “Export”, diamond marker, dash-dot line, arrow to grid |
| House load | existing foreground, `#fafafa` | 17.18 / 15.97 | “Home (derived)”, cross marker, dotted line |

The five hues are existing Motrix chart tokens, not an imported palette. The sixth uses existing foreground. The ratios above are for the original, unfiltered colors on solid fills. **Text rule (a conservative design decision, not a measured failure):** energy-colored small text is permitted only for Solar, Grid import and Battery discharge, on card, tile or well backgrounds. Battery charge and Grid export always use neutral text plus a colored non-text swatch: unfiltered they already fail AA on the well `#262626` (4.19/4.10:1), and by the calculation below they fall to or below 4.5:1 in several grayscale pairings. On controls, selection or mixed backgrounds use neutral text and a colored non-text swatch. All six swatches exceed 3:1 on the well. Tooltips use neutral primary text. The current renderer uses the Solar token `text-chart-4` for estimate explanations in Usage & Cost (`UsageCost.tsx:310,393`); that is status text in an energy hue, so the redesign gives it a status or neutral tone to keep the energy and status palettes separate (presentation backlog).

**Grayscale arithmetic — local calculation, not a Chromium measurement.** Applying the CSS `grayscale(100%)` luma weights (0.2126/0.7152/0.0722 on gamma-encoded sRGB) to the text color and recomputing WCAG contrast gives, on card / lightest tile top / well: Solar 8.13 / 7.56 / 6.86; Grid import 7.30 / 6.79 / 6.16; Battery discharge 7.23 / 6.73 / 6.11; Battery charge 4.59 / 4.26 / 3.87; Grid export 3.81 / 3.55 / 3.22; secondary text `#a1a1a1` 6.94 / 6.45 / 5.86 (neutral greys are unchanged by the filter). The status-tone pairs below recompute to 7.71, 7.80, 11.81 and 6.99:1 under the same formula. Charge and export text would therefore fail 4.5:1 in several filtered pairings. These are predictions only; they do not replace measuring the rendered output.

Do not claim the palette alone is color-blind-safe. Violet and pink have similar luminance. The six labels/shapes/patterns remain unique in grayscale and under protanopia, deuteranopia and tritanopia simulation. Batch 1 must show those simulations and a no-hue version. The owner must be able to identify every series from marker/pattern/text alone. This is the acceptance criterion; no invented Delta-E threshold or “accessible palette” claim.

**Status colors are separate from energy colors.** Reuse the existing `statusTone` semantics: RECONCILED/COMPLETE green-100/green-800; UNRECONCILED/MAPPING_PROVISIONAL/ESTIMATED amber-100/amber-800; RECONCILIATION_FAILED red-100/red-700; UNAVAILABLE slate-100/slate-600; unknown strings neutral. Retained ratios are 6.49, 6.36, 5.27 and 6.92:1 respectively (`docs/ui-audit/desktop-ui-audit.md:421-425`). Always retain the status text. Never color an unknown collector state “healthy” by guessing.

**Stale-text specification.** Stale presentation is grayscale without global opacity (`data-stale:grayscale`; the approved implementation removes the whole-panel opacity class). In any region that is stale, reconnecting or greyed under A0.8: (1) all text — values, legend entries, tooltips, direction labels, axis labels, reasons and status chips — uses the neutral primary/secondary tokens or the existing status-tone pairs; (2) the six energy colors appear only as non-text marks (swatches, lines, markers, arrows, patterns), each needing at least 3:1 against its adjacent surface after filtering (Grid export on the well, 3.22:1 by the calculation above, is the tightest); (3) a grayscale screenshot must not rely on a colored legend to explain its numbers, because text, shape and pattern carry the meaning. **Acceptance gate (required; the arithmetic above does not satisfy it):** after the opacity removal, measure the actually rendered text and graphics of every stale frame — Overview NO_DATA/STALE/RECONNECTING, History, Usage & Cost, Data Quality, tooltips/popovers and status chips — in Chromium output at at least 4.5:1 for text and 3:1 for meaningful graphics. A failing pairing is reported as a finding and is never rounded up.

### A5. Materials

- Keep the opaque `#09090b` window, app-owned shell gradient, 65%-black inset panel, neutral opaque tiles and opaque `#171717` overlays. Overview has no extra panel behind its tiles. These are retained measured patterns, not a new glass design (`docs/ui-audit/desktop-ui-audit.md:250-288`).
- Toolbar groups use the existing non-glass pill: background token at 70% over the panel, measured fill `#0e1010`, measured rim `#1e2021` (`audit:264-273`). Raise an edge only where it identifies an actionable control, using A4's `#a1a1a1` control-edge token and ≥3:1 non-text contrast.
- Reduced transparency or increased contrast: solid sidebar `#213436`, solid toolbar background, solid card background instead of gradients. No layout change. This already exists for sidebar/tiles (`styles/sidebar.css:86-100`; `styles/globals.css:169-173`).
- Forced colors: allow system colors for text, outlines and meaningful strokes. Do not preserve decorative gradients or colored status fills at the expense of visibility.
- Native mobile uses opaque backgrounds too. System status/navigation bars may use platform defaults; do not turn the product into a translucent iOS-glass variant.
- No noise textures, video backgrounds, shader canvases or decorative particle layers. Data charts are the only canvas content already required by the app.

### A6. Geometry and responsive rules

**Retained scale.** Spacing is a 4 px grid with existing 8/12/16/24/32 px increments. Radii: 6 small, 8 controls, 10 cards/tables, 14 panel/dialog, 18 dashboard tile, full pill radius. These are measured/source-cross-checked in `docs/ui-audit/desktop-ui-audit.md:331-362`. Native logical sizes preserve proportions while respecting platform touch targets; they are not physical pixels.

**Desktop shell.** Sidebar 200 px; nav targets 180×38 px at 10 px side inset, 4 px vertical gap; first nav row starts at y=55. Content panel starts at x=200, with 8 px top/right/bottom inset, no left gutter. Header uses 24 px horizontal padding, 32 px top and 12 px bottom. Overview uses its existing narrower internal gutter. Reference pixel anchors: `captures/local/ui-audit/measure/redesign/solar-spotchecks.json:6-42,45-78`.

**Controls.** Desktop form controls are at least 32 px high; page toolbar 36 px; caption targets 28×28 px with 8 px gaps and 10 px glyphs. Existing controls can grow vertically with text. WCAG SC 2.5.8 minimum target is 24×24 CSS px or its specified spacing exceptions; do not invoke exceptions for primary controls. Native iOS targets at least 44×44 pt, native Android and touch-web targets at least 48×48 dp/CSS px, using Apple/Material platform target standards. Visually smaller glyphs sit inside those targets.

**Overview layout.** Keep four logical columns at all three desktop sizes, with a minimum cell width of 160 px and 16 px gaps, from current `Overview.tsx:93`. The flow spans two columns; Solar/Home and Grid/Battery occupy the other two. SOC and operating/accounting status occupy the next row; daily energy is a full-width section. Use `min-height`, not a fixed-height clipping box: current 160 px rows are the compact baseline, not a mandate to truncate content at zoom. At 1280 and 1600, distribute added width; do not add features to fill space. Keep the full flow labels and daily energy accessible by vertical scrolling at 914×672.

**Responsive web.** At widths at least 914 px, use the desktop content layout without Electron chrome. Below that existing breakpoint, use a labelled navigation drawer and a single-column page, with two-column metric groups only when each retains the 160 px content minimum plus the existing 16 px gap and gutters. At 320 px, all groups are single-column. This breakpoint is a design reuse of the existing desktop minimum, not a measured web implementation.

**Native iOS/Android.** Five destinations: Overview, History, Usage & Cost, Data Quality, Settings. Use a native labelled bottom navigation component with system safe areas; retain full accessible names when the visible label wraps. Data pages use the narrow-web content order, not a miniature 200 px sidebar. Settings categories open native full-screen detail pages; desktop keeps dialogs. Native navigation/header/back behavior is platform-native; no fake Windows caption buttons.

**Settings.** Desktop category grid stays three columns at 914 px and above; narrow web/native uses a vertical category list. Desktop dialog maximum width 700 px and maximum height 85vh come from the retained dialog measurement (`solar-spotchecks.json:69-78`). Wrap label/control rows at narrow widths; footer remains reachable with the software keyboard open. Do not apply a 700 px minimum to mobile.

**Tables.** Desktop rows start with the measured 32 px content plus 1 px divider, then grow for wrapping. Mobile offers labelled per-row key/value layouts when practical; a truly two-dimensional comparison may retain a labelled horizontal scroller under WCAG SC 1.4.10's data-table exception. Never horizontally scroll the entire page.

### A7. Elevation and layers

Reuse the current layer order: base shell/content; Windows chrome at z=30; panel actions at z=40; dialog backdrop and popup at z=50 (`window-chrome.tsx:104`; `panel-shell.tsx:54`; `ui/dialog.tsx:31,60`). Put tooltip portals above their owning dialog using the existing tooltip primitive; do not create a second overlay manager. Layer numbers are implementation order, not visual depth.

Tiles remain almost flat (`shadow-md/5` currently), cards use their existing border, and dialogs use the opaque surface plus thin light ring. No invented multiple-shadow glass stack. Keep caption buttons interactive before opening a modal; while a modal is active, its focus scope owns application keyboard navigation. Native system bars and keyboards own their platform layers.

A startup mark is decorative content in the startup surface, never a z-index curtain over an already-usable dashboard. Errors appear immediately in the normal state surface, not underneath an animation.

### A8. Motion

- Reuse 100 ms dialog/tooltip entry and exit and 200 ms control/sidebar emphasis from the existing Motrix-derived styles (`ui/dialog.tsx:31,60`; `App.tsx:399`; audit `:448-453`). Prefer opacity and transform; remove broad `transition-all` when implementing changed components rather than animating layout, filters or shadows.
- Preserve the existing live-flow cadence: dash animation takes 2 s and applies only to non-idle flow tiers with fresh, connected data (`styles/globals.css:207-220`; `EnergyFlow.tsx:12-17`). It denotes direction, not exact speed or measured throughput. Never animate a stale, unknown or cloud snapshot.
- No animated interpolation between readings, rolling counters, smoothed chart transitions or graph motion that implies missing observations. All History chart animations are disabled, including initial draw and update, so the same chart obeys reduced motion and does not fabricate a trajectory.
- Reduced motion: no moving flow dashes, scale/translation, shimmer, pulsing status dots or decorative startup animation. Immediate state replacement is acceptable. Preserve feedback text and focus; do not wait for animation completion to enable an action.
- Startup mark: at most one 200 ms opacity appearance during an already-pending cold-start state, using the existing 200 ms motion scale. It may end earlier when the app becomes usable. No minimum dwell, loop, fake percentage or replay on tab change, refresh, reconnect or mobile foreground resume. Detailed startup and logo requirements are in A13/A14.

### A9. Iconography and illustration

Use lucide for navigation and actions, the existing 16 px desktop box (`App.tsx:419,433`) with the same stroke style throughout. Windows caption glyphs stay the existing 10 px drawings inside 28 px targets. Native touch targets grow; icons do not become oversized decoration.

Keep the six current licensed settings motifs: plug/Connection, money bag/Tariffs, receipt/Billing, abacus/Accounting, no-entry/Exclusions, chart/Meter readings (`Settings.tsx:55-92`). Current display is 52 px (`:1040-1046`). Do not add an icon to suggest a missing action. Decorative artwork has empty alternative text; a control's label carries its meaning.

Energy-flow nodes use simple outlined symbols plus text, not a house rendering. Empty states use an existing lucide symbol and explanatory copy; no new 3D illustration commission is needed. Original logo requirements are in A14, separate from icon-library usage.

### A10. Shell and navigation

**Electron.** Preserve one root `WindowChrome`, visible in loading, a local settings-read failure, first run, AUTH_FAILED, TLS_MISMATCH and the connected shell (`App.tsx:301-362,468-475`). Keep “Minimize”, “Maximize”/“Restore”, “Close” and the no-drag regions. The existing 40 px drag strip is transparent only over the opaque app, not the desktop. Do not hide startup errors behind a shell that cannot close.

The sidebar contains Overview, History, Usage & Cost and Data Quality in `nav[aria-label="Dashboard tabs"]`; Settings remains at the bottom outside that nav landmark, as current tests expect. Active destination exposes `aria-current="page"`. No dashboard switcher, command palette, global search, notifications destination or extra quick action is invented.

Each page has one h1 and one main vertical content scroller. Header actions wrap below the title before they collide with the caption region or overflow. Keep connection chip and last-observed status visible: “Connected · ADMIN/VIEWER/UNKNOWN”, “Reconnecting” or “Connecting…”. Connection does not mean measurement freshness, collector health, verified accounting or a complete bill.

A reconnect notice retains the current safety sentence: “Collection runs on the NAS independently of this app.” It means the client does not own collection; it does not guarantee the NAS is currently healthy. Show last received timestamp/age and next retry from the existing state when available. No invented countdown based on a new retry scheduler.

**Web.** Same destinations and roles; browser chrome replaces Windows chrome. Narrow navigation opens as a labelled modal drawer with Escape, focus containment and restoration. A skip link targets the main heading/content. The browser cannot expose Electron's certificate-probe/pin controls; authentication and trust remain prerequisite-blocked, per A12.12.

**Native.** Same destinations in native bottom navigation. Use system back to dismiss a detail page or sheet, not to forget credentials. Preserve scroll and draft state when changing tabs as specified for the view. No pull-to-refresh is required: use the explicit Refresh/Retry controls from the shared state contract, avoiding a new gesture-only interaction.

**Role matrix.** ADMIN may use existing configuration mutations. VIEWER sees readable data/configuration but no mutation forms or deletion choices. UNKNOWN/undefined must remain locked until verified; showing a saved “ADMIN” label from an earlier token is forbidden. Local “Forget connection and token” is not a backend-admin mutation and remains available independent of role. On RECONNECTING, do not retain ADMIN controls just because a cached data query succeeded earlier.

### A11. Component inventory and state contracts

**Shared request states.** Each independently fetched region distinguishes: populated; loading without data; successful empty; retained stale; offline/reconnecting with or without retained data; partial data; refreshing with retained data; error with a Retry scoped to that request. Do not blank successful sibling regions because another request fails. Authentication and TLS errors use their security-specific recovery instead of an unsafe generic Retry. A data-source gap is not a network error. Refresh/Retry never clears the selected date range, tariff, reconciliation pair or valid draft.

**Shared mutation states.** Every credential, tariff, billing, policy, exclusion and reading workflow shows pristine; dirty; validation error; pending; success; failure with the draft retained; and role-unavailable/read-only. **Current source behavior (`Settings.tsx:262-413`):** the JSON-editor drafts (one per operation, each with its own message), the typed tariff/version/rate fields, tariff ID, holiday year, the two delete-ID fields and one message shared by typed actions and local-config errors all live in memory inside the mounted `Settings` view. Closing a dialog, reopening it, or switching to another Settings category clears nothing. A successful submit clears nothing either: it shows “… saved.”, keeps the submitted values and invalidates all cached queries (refetching the active ones); a failure also keeps them. Leaving the Settings destination (`App.tsx:453-461`), a NOT_CONFIGURED/forget/re-pin boundary, AUTH_FAILED or TLS_MISMATCH (these replace the whole shell) and application restart all discard every Settings draft — by unmounting or restarting, not by an explicit reset. RECONNECTING keeps Settings mounted, so drafts survive while role-gated editors are hidden until the role is verified again. Credential secrets are the exception: the first-run/AUTH_FAILED token input is cleared immediately on submit as current code does (`App.tsx:46-71`); never persist or redisplay it. Settings has no token field. **Approved behavior changes (owner, 2026-10-30; not current):** (1) after a confirmed successful submit, that form's own fields return to their initial values (pristine) and its success message stays visible; a failure or an ambiguous outcome keeps the draft, and shared selections such as the selected tariff and holiday year are not draft fields and are not reset; (2) drafts are retained across destination changes by moving their ownership above the conditionally rendered Settings view — in memory only, never persisted — and are discarded at every connection boundary (NOT_CONFIGURED, forget, re-pin, AUTH_FAILED, TLS_MISMATCH), so a retained draft can never reach a different backend or token identity, and at application restart; RECONNECTING keeps them. `ConnectionScope` today clears only the query cache and only on NOT_CONFIGURED, so the draft store needs its own synchronous generation reset on every named boundary, and a late mutation success, error or reset callback from a previous generation must be ignored so it cannot repopulate a cleared store. **Further presentation requirements (not current; still unimplemented):** a dirty label after edits; a pending state that disables duplicate submission and announces completion; per-category scoping of the shared message. A new leave-confirmation dialog is not required. On an ambiguous transport failure, never claim that a mutation was rolled back or automatically replay a non-idempotent create; refresh the affected list before offering the same mutation again.

| Component / existing home | Required states and behavior |
|---|---|
| Buttons, caption controls, icon actions — `components/ui/button.tsx`, `window-chrome.tsx` | Rest, hover, keyboard focus, pressed, selected where applicable, disabled, pending with a text label; destructive and outline variants. Disabled reason is adjacent text or a focusable explanation, not a tooltip on an unreachable button. Minimize/maximize/restore/close retain exact roles and names |
| Sidebar/nav items — `App.tsx` | Rest, hover, focused, current page; selection remains distinguishable from focus. Settings retains its separate position. No disabled fake future destinations |
| Toolbar/range controls — `toolbar-group.tsx`, `native-select.tsx`, `History.tsx`, `UsageCost.tsx` | Closed, open, focused, selected, disabled pending prerequisites, invalid range. Native select remains a native select; no silent replacement with a custom listbox that breaks keyboard/change events |
| Inputs, date controls and JSON editors — `input.tsx`, `Settings.tsx` | Empty, filled, focused, dirty, invalid, pending, read-only, disabled, failed. Persistent label, optional help, associated inline error; preserve exact decimal strings. JSON syntax errors are separate from server validation. Local dates are labelled as site-local; date-time entry labels the expected timezone |
| Metric tile — `Display.tsx` | Known positive/negative/zero, null with reason, lower bound, partial coverage, stale retained value, loading placeholder, error. Large digits and smaller visible unit remain separate but share one accessible value. Neutral text for uncertainty; no `0` substitution |
| Status/connection/source chip — `badge.tsx`, `status-tone.ts`, `App.tsx` | Known status, unknown neutral status, role unknown, connecting, reconnecting, stale measurement, MODBUS/CLOUD provenance. Do not collapse connection, source, freshness and accounting validation into one “healthy” dot |
| Reason tooltip — `reason.tsx`, `tooltip.tsx` | Pointer hover, keyboard focus, visible, dismissed by Escape, long text wrapping; remains available while pointer moves into it. A nested button/link is the focus target, not a redundant inner tab stop. Touch uses a labelled disclosure, not hover-only help |
| Table and list — `data-table.tsx`, `Display.tsx` | All eight request states; numeric alignment, wrapping reasons, selected row where one is actually selectable, keyboard focus on row actions, loading-more, end-of-list, pagination failure with retained rows. No invented sorting/filtering controls on read-only lists |
| Empty state — `empty.tsx` | Successful no records; no selected reconciliation pair; no monitoring history; no matching server-filtered events where filtering exists. Each names why it is empty and only offers an action available to that role/API |
| Data notice — `Message`, `ConnectionNotice` | Neutral loading/refresh, informative source, warning stale/partial, error Retry, security error with explicit recovery. Non-error status uses polite announcements; actionable failures are announced once, not at every 10 s poll |
| Modal / native detail — `SettingsDialog`, `ui/dialog.tsx` | Closed, opening, open, dirty, pending, validation failure, server failure, closing; title and description, initial focus, contained Tab order, Escape close and trigger focus restoration. Drafts survive close. At text zoom/keyboard appearance, body scrolls and close/submit remain reachable |
| Meter-reading pager — `MeterReadingsPager`, `useMeterReadings` | Initial loading, partial list, loading-more, more available, all loaded, refresh pending, page error with retained rows, fresh connection reset. Labels include “Load more readings”, “Loading more…”, “Refresh readings”, and “Showing N readings · more available” / “All N readings loaded” |
| History chart — `Chart.tsx`, `History.tsx` | Populated, loading, no points, all-null series, explicit gaps, partial buckets, stale retained, refreshing, error Retry; focusable inspection and equivalent data table; selected/hidden series with state announced; no chart animation |
| Live energy flow — `EnergyFlow.tsx` | Import/export, charge/discharge, zero/idle, unknown, partial, fresh connected, stale, reconnecting, reduced motion. Existing three line-width tiers remain (idle: unknown or under 100 W; normal: under 2000 W; strong: 2000 W and over; `models.ts:129-135`); arrows indicate only known non-zero direction. Unknown/zero connectors are neutral structural links, not false animated arrows |
| Settings category grid/list — `Settings.tsx` | Keyboard focus, hover, dialog/page open, read-only role, dirty category marker, failed category query, reconnecting. Grid itself has no independent backend request; show each dialog's request state rather than a fictitious global grid loader |
| Startup/brand mark — A13/A14 | Static, permitted cold-start opacity appearance, reduced-motion static, font failure fallback, loading, local settings-read failure, first-run/security failure. Mark never becomes a progress bar or an input blocker |

**Chart and flow interaction specification**

- A chart has a visible title, visible units and site-timezone/range label, legend, focusable plot inspection target and “View data table” control. Enter/Space starts keyboard inspection; Left/Right moves between actual returned timestamps, Up/Down selects an available series, Home/End goes to first/last returned timestamp, Escape exits inspection and dismisses its tooltip. Do not create thousands of tab stops. Pointer/touch inspection exposes the same values/reasons.
- The equivalent table contains exact returned timestamp, value/unit, coverage, provenance/flags and gap reason when supplied. Use bounded client-side pages of 50 rows, reusing the existing meter-reading page-size scale (`api.ts:61`), with explicit previous/next and total count. This is a presentation of already-fetched points, not new server sampling or silent truncation. Table values stay accessible at zoom and on mobile.
- Tooltips use neutral text on the opaque popover. Label import/export and charge/discharge explicitly, include the time and zone, and explain unavailable values without a fake zero. Do not leave a tooltip covering the keyboard focus indicator.
- The live flow exposes a textual summary adjacent to or programmatically associated with its visual nodes: Solar, Grid import/export, Battery charge/discharge, Home, SOC, data age/source and missing reasons. The whole diagram is not the sole accessible name. A static diagram is sufficient in reduced motion.
- Legends show all six energy mappings where present. Battery and grid sign conventions are written beside the relevant chart: grid positive = import; battery positive = discharge. Negative samples use the export/charge color on lines and markers with neutral text labels; do not interpolate a missing zero-crossing timestamp. All axes retain a visible zero baseline.
- Power chart: x=time across the requested site-local range; y=W or kW according to A17 with the chosen unit fixed for that chart. Signed power lines may cross zero. Solar/Home remain non-negative when data is valid. Shade explicit `gaps` and break null intervals; do not span or interpolate gaps.
- Energy chart: x=local day, month or billing-period range as labelled; y=kWh; grouped bars for solar, derived home, import, export, battery charge and discharge. Never stack these six as if they were additive parts of one total. A covered lower-bound bar is hatched and labelled; unknown is an empty slot with reason, not a zero-height valid bar.
- SOC chart: y=0–100% (the defined percentage domain); x=site-local time. Average is shown only when the API returns it. Coarse ranges may contain only minimum/maximum: label the extrema instead of synthesizing an average. Null intervals break every relevant line.
- Cost chart: use only backend `BillingPeriodResult` line items already supplied. If a visual summary is added, use labelled MYR line-item bars alongside the authoritative table; do not invent historical daily cost or cost forecasts without API data. Negative monetary credits and positive charges need signed labels and a zero axis.
- Reconciliation is primarily a labelled comparison table, not a decorative gauge. Candidate source, coverage, independent quantity, utility delta, ratio and verdict remain explicit for import and export. No automatic “best policy” action.

### A12. Screen catalogue, states and API availability

All pages retain A11's eight request states independently for each data region. The entries below name each current or committed surface and its specific meaning. The same data-state semantics apply to desktop, web and native mockups; A12.14 marks where the client itself is not implemented. No separate uncommitted feature is introduced by splitting a dense screen into native detail pages.

#### A12.1 Overview — current, highest-use screen

**Data and hierarchy:** `LiveStatus`, `CollectorStatus`, today's `EnergyTotals`. Read live data first, then Solar/Home/Grid/Battery metrics around the flow, SOC and operating mode, collector/accounting status and today's six energy totals. Show `observedAt`, server age, site timezone, configured accounting policy, source/status/coverage and monitoring start where returned. Live power itself does not provide per-value energy provenance; do not forge it. A collector source badge may describe the selected acquisition source, with A12.13's cloud limitation.

- **Populated:** A18 live snapshot, directional flow, explicit MODBUS source, fresh age, all metrics and daily totals.
- **Loading:** independent placeholders for live/collector/totals; “Loading site timezone…” blocks only date-scoped totals, never fabricates a local day.
- **Empty:** `freshness=NO_DATA`, no prior values; “No readings yet”, reasons and collector state, no flow animation. A successful zero reading remains `0 W`, not empty.
- **Stale:** retain last values, absolute observation time and age; grayscale without opacity; stop flow. Do not label the values “Live”.
- **Offline/reconnecting:** retain the same data with the connection notice; if none was ever received, show an unavailable structure rather than invented cached readings.
- **Partial:** one or more power/SOC values null, per-value reasons such as METER_LINK_DOWN (grid, phases and derived Home) or BLOCK_INVALID_0 (solar, strings, battery), or partial daily coverage; keep known siblings and explain each unknown. Daily energy coverage is independent of live freshness.
- **Refreshing:** keep prior values and show subdued request activity; no whole-page skeleton or animation reset on each poll.
- **Error with Retry:** separate live, collector or totals failure; Retry reissues only the failed existing operation. Authentication/TLS transitions leave the dashboard through A12.12.

**Live fields actually available.** `LiveStatus` returns `pv`, `load` (derived Home), `loadVendor` (vendor-reported load, the sum of the three vendor load phases), `grid` and `battery`, plus `pvStrings[]` and `gridPhases[]`. Each is a `PowerValue`: integer `watts` (W, nullable), `status` and `reason`. `pvStrings` holds four string powers or is empty; `gridPhases` holds three entries in a fixed index order (the backend's A, B, C) with no labels in the payload. Also returned: `batterySoc` (integer %), `batteryState` (text), `operatingMode` (code, label, observedAt), `activeFaults[]`, `accountingStatus`, `serverTime`, `observedAt`, `ageSeconds`, `freshness` and `meterLink` (selected by the operation but not rendered by Overview today). Reasons seen in the resolver are NO_READING, STALE_SAMPLE, METER_LINK_DOWN, METER_COMM_FAULT, METER_STALE, BLOCK_INVALID_0, BLOCK_INVALID_1800, CLOCK_STEP and NEGATIVE_DERIVED_LOAD. `status` is OK, STALE or UNAVAILABLE in practice; PARTIAL is declared in the schema but not emitted by the live resolver. **Current rendering:** string and phase powers appear as W lists in the Solar and Grid tile details, and vendor load appears only as the “Vendor figure ⓘ” reason beside Home (derived); vendor load can be present while grid and Home are unavailable. Design these as secondary detail with units and null reasons; do not invent device-health grades or phase labels. **Not available — prerequisite blocked:** voltage, current, frequency and power-factor values (per phase or per string) are not in the operation, schema or resolver; showing them needs a new API field, operation and regenerated contract, so no frame displays a measurement for them (a frame may annotate “not available from current API”).

Evidence: `apps/desktop/src/renderer/views/Overview.tsx:30-255`; `packages/contracts/src/operations/dashboard.graphql:1-5,179-266`; `apps/backend/schema.gql:254-272,378-382`; `apps/backend/src/graphql/api.resolver.ts:43-59,98-279`.

#### A12.2 History — current charts; presentation backlog for accessible inspection

**Controls:** day, week, month, year, custom; site-local From/Through dates; optional tariff for peak/off-peak breakdown. Preserve current request shapes, `maxPoints:1000`, inclusive displayed dates and exclusive UTC endpoint conversion. Changing range does not mutate billing or accounting. Show power, energy and SOC as distinct plots with the chart contract above; keep exact energy rows available.

- **Populated:** A18 curve plus totals; visible units, range and site timezone; no smoothing.
- **Loading:** loading blocks per chart; date/timezone prerequisite remains explicit; controls stay labelled.
- **Empty:** successful no power points/no energy rows/no SOC are distinct, with “No readings in this range”; do not display blank axes as if all readings were zero.
- **Stale:** if the connection makes this view stale, retain the selected range and results in grayscale; historical age is not a claim that the selected past period is “live”.
- **Offline/reconnecting:** same retained charts/tables with connection notice, or unavailable placeholders if never fetched; range changes cannot pretend to load data while offline.
- **Partial:** A18 gap variant, null points and coverage per bucket; SOC coarse extrema-only state; tariff-window rows absent if no tariff is selected.
- **Refreshing:** previous plot remains while the same range refreshes; a newly selected range is clearly marked pending so old data is not labelled with new dates.
- **Error with Retry:** the failure boundaries are the requests. `PowerSeries` is one request for PV, LOAD, GRID, BATTERY and SOC, so the power chart and SOC chart load, refresh and fail together and share one Retry; `EnergyTotals` feeds the energy chart, coverage line and tariff-window table; `Tariffs` feeds only the selector. Preserve the other requests' regions and the selection; Retry reissues only the failed request. Current source shows the power error text in the power tile and “Loading SOC…” in the SOC tile, a raw tariff Message and no Retry; scoped Retry and a shared SOC error are presentation backlog.

Current energy bars plot four quantities (solar, consumption, grid import, grid export); the six-quantity grouped bars described in A11 are presentation backlog over existing `EnergyTotals` fields.

Evidence: `apps/desktop/src/renderer/views/History.tsx:56-366`; date helpers in `models.ts:263-294,318-369`; contract `dashboard.graphql:244-290,335-339`.

#### A12.3 Usage & Cost — daily, monthly and billing-period energy totals

**Current:** range selector, custom dates, six energy totals, monitoring start, coverage/provenance, billing-period list and selected bill. **Presentation backlog:** explicit daily/monthly summary layouts and an optional billing-period energy comparison where the existing `EnergyTotals` date range supports it. **Not supplied:** a historical monetary time series, so do not draw daily/monthly cost trends.

- **Populated:** A18 month totals and period list; explicit “Calculated from measured grid import/export under your configured tariff; not your TNB bill.”
- **Loading:** totals and period list load independently; site-timezone prerequisite prevents wrong local-date requests.
- **Empty:** successful no totals in range and no configured billing periods are separate; a viewer sees guidance, ADMIN may navigate to the existing Billing settings action.
- **Stale:** retain totals, source and period results; a billing-period `stale` result additionally gets “Recalculation pending” without pretending it is a connection failure.
- **Offline/reconnecting:** retain values/list/selection in grayscale with notice; no new cost computation in the client.
- **Partial:** covered-only kWh with coverage and lower-bound indication; tariff/billing reasons remain next to affected values; known energy may coexist with unavailable cost.
- **Refreshing:** retain selected period and prior totals; show which request is refreshing.
- **Error with Retry:** separate EnergyTotals/BillingPeriods/BillingPeriod failure; Retry only that request, preserving selected IDs and range.

Evidence: `apps/desktop/src/renderer/views/UsageCost.tsx:108-447`; `dashboard.graphql:244-266,367-385`.

#### A12.4 Billing-period detail — current

**Content:** selected start/end local dates, tariff/currency/timezone, COMPLETE/ESTIMATED/UNAVAILABLE, stale flag, coverage, reasons, subtotal/total, authoritative line items, opening/closing/expired NEM kWh lots and their origin month. Distinguish an unknown amount from a zero amount. A NEM lot is energy, not currency. Preserve `billVerified` truth: a fixture or synthetic tariff cannot become verified.

- **Populated:** A18 February period and explicitly illustrative, unverified MYR result.
- **Loading:** selected period title/ID remains; detail indicates pending request.
- **Empty:** no selected period instructs selection; `result=null` is “Not calculated”, not MYR 0.00.
- **Stale:** keep returned result and “Recalculation pending”; never silently recompute it in a renderer.
- **Offline/reconnecting:** retained detail in grayscale; no result means unavailable, not uncalculated unless that state was actually returned.
- **Partial:** ESTIMATED/lower-bound line items and `reasons`; null quantities/amounts get the correct reason text.
- **Refreshing:** keep result visible with refresh state; do not clear lots or selection.
- **Error with Retry:** detail request failed; Retry the same period. A returned UNAVAILABLE calculation is a valid result with reasons, not an HTTP error to hide behind Retry.

`requestRecalculation` is a backend mutation specified by the product plan but not a desktop operation or committed desktop control. A proposed ADMIN-only request/pending/failure/result-stale control is **prerequisite-blocked** and needs separate product approval plus allow-listed operation/main-process/contract integration; it is not a safe cosmetic fix (`SOLAR_MONITORING_PLAN.md:339,349,594`; `apps/backend/schema.gql:331`; `packages/contracts/src/index.ts:32-60`).

#### A12.5 Data Quality — collector, devices, policy, gaps/events and calculation runs

**Current blocks:** collector/device status, configured accounting policy and validation, date-filtered quality events, **daily comparison against inverter counters** (ours, unvalidated interval delta and lifetime, vendor-today summary), reconciliation and calculation runs. Keep the actual device model/id and versions where returned, acquisition source, last success/error/retry, backup/certificate information and monitoring start. A green connection chip must not hide a collector failure.

- **Populated:** A18 collector/device, policy and calculation-run examples, plus the one baseline-compatible event record of A18.5 (the event list needs an explicit From/Through selection that includes 20 Feb).
- **Loading:** each query has its own status; no global “all healthy” placeholder.
- **Empty:** no devices, no active policy, no quality events and no calculation runs each have their own successful-empty copy. Empty events do not prove the data is complete.
- **Stale:** retain observed status/version/timestamps in grayscale; do not advance last-success timestamps on a client render.
- **Offline/reconnecting:** retained blocks with connection notice; no new collector-health inference from client reachability.
- **Partial:** known metadata with unknown backup/error/source fields, filtered event window with gaps, incomplete runs; preserve raw kind/reason strings.
- **Refreshing:** retain list rows and selected filters; show activity without resetting the currently shown event page except when the existing range-reset contract requires it.
- **Error with Retry:** each collector/devices/policies/events/runs failure has a scoped Retry and retains successful siblings.

Quality events preserve the current cursor replacement behavior: “More events” loads the next 100-event page, not an accumulating list. From/Through date changes, clearing a date, an invalid range and a timezone change reset its cursor before a fresh request. Do not add a Previous button or infinite accumulation without changing the pagination contract and tests in the same approved implementation. Events are listed by `startedAt` inside the selected From/Through range, so an event that began before the range is not returned, and the default range is the first of the current site month through today. Event kinds differ in shape: ledger counter events (COUNTER_RESET, COUNTER_JUMP_REJECTED, COUNTER_DISCONTINUITY) are point records with a start only, shown with end and device “—”; GAP has a start and an end. An event is history, not an active fault: active faults are `LiveStatus.activeFaults`, which comes from device status and not from the event list.

Calculation runs remain a read-only list. Current rows show id, kind, status, start time, reason and error; the finish time is returned by the operation but is not displayed today (presentation backlog). RUNNING is not a numeric progress percentage. A failed run is a returned record, not a network error.

Evidence: `apps/desktop/src/renderer/views/DataQuality.tsx:31-558`; `DataQuality.spec.tsx:235-333`; contract `dashboard.graphql:218-243,291-331,400-441`.

The daily comparison is a separate `EnergyTotals` region with the same eight request states: loaded labelled rows; pending without rows; successful no rows; retained stale/offline rows; partial per-source nulls; retained refreshing rows; and scoped Retry on query failure. Its interval delta is unvalidated, lifetime includes pre-monitoring, and vendor-today is VENDOR_SUMMARY; none is an alternative measured ledger total. A18 provides no vendor counter readings, so only their labelled not-supplied cells appear in the fictional frame (`apps/desktop/src/renderer/views/DataQuality.tsx:269-351`).

#### A12.6 Reconciliation — current Data Quality section

**Controls and table:** load utility meter readings through `useMeterReadings`; choose two different readings; show source candidates and import/export comparison for each. Include coverage, independent integrated quantity, utility delta, ratio/verdict and investigation hints. Keep current reading selector accessible names “From reading” and “To reading”.

- **Populated:** A18 fictional reading pair and candidate table; show backend `MAPPING_PROVISIONAL` accounting status because the mapping is provisional. A candidate PASS is not physical validation; with an approved mapping, the backend would classify this fictional METER_NET pair as RECONCILED.
- **Loading:** loading reading list is distinct from loading the selected reconciliation.
- **Empty:** no readings, only one reading, and no pair selected each explain the next available action; identical selection says “Select two different readings for reconciliation.”
- **Stale:** retain pair/result and source/coverage; stale does not turn a prior verdict into PASS.
- **Offline/reconnecting:** retained table in grayscale, or unavailable when not previously fetched.
- **Partial:** per-source insufficient coverage, null ratio or missing phase support; keep other candidate rows and backend hints. Coverage is relative to the whole reading window, and A18.4 defines two explicit coverage variants.
- **Refreshing:** retain pair/result while refreshing readings or comparison; temporary missing select options must not erase the chosen IDs.
- **Error with Retry:** reading-page failure preserves all loaded options; reconciliation failure preserves pair; separate Retry actions.

No auto-calibration or automatic accounting-policy switch. The administrator may separately create a policy only through Settings. Physical meter netting semantics and site accuracy remain unverified (`docs/field-mapping.md:3-11,55-62`; `TODO.md:33-37`).

#### A12.7 Settings landing — current six categories

Show Connection, Tariffs, Billing, Accounting, Exclusions and Meter readings. Desktop: current category grid opens one dialog; web narrow/native: category list opens a full-screen detail. Preserve the existing category names and no new routes in the Electron app.

- **Populated:** six categories with concise descriptions and role status.
- **Loading:** landing is static; show connection/role resolution only, not fake category data skeletons.
- **Empty:** not applicable to the static category inventory; each category's empty data state is required below.
- **Stale:** Settings is intentionally not grayscale; show connection state, retain read-only details and disable role-dependent mutations when role is unavailable.
- **Offline/reconnecting:** local connection information is still available; remote category data is retained where already fetched, and unavailable otherwise.
- **Partial:** one category failure does not remove the others; the active dialog shows its own issue. Current source keeps one message shared by typed actions, deletions and local-config errors (shown on the landing when no dialog is open, and in whichever dialog is open), while each JSON editor keeps its own message; per-category scoping of the shared message is presentation backlog.
- **Refreshing:** the landing stays stable. Approved behavior (owner, 2026-10-30; not current): a category's queries are requested only while that category is open, per the A16 map; reopening shows the retained cached rows as refreshing while stale data refetches. Current behavior: Tariffs, MeterReadings, BillingPeriods, AccountingPolicies and DataExclusions are requested when the Settings destination mounts, whichever category is open, and TariffHolidays/TariffMonthlyRates only once a valid tariff ID is selected; a successful mutation invalidates all cached queries (narrowing is approved, see A12.9).
- **Error with Retry:** category query or local config failure is scoped and recoverable; never erase all categories. Current source shows these as messages inside the open category with no Retry control, and a local-config failure leaves the Connection fields at “—”/“No”; a Retry control is presentation backlog.

All category forms additionally show pristine, dirty, validation, pending and failure. Read-only variants are required for VIEWER and UNKNOWN roles; local forget-connection remains available.

Evidence: `apps/desktop/src/renderer/views/Settings.tsx:328-413,1011-1079`.

#### A12.8 Connection and credentials — current desktop workflow

**Settings Connection:** current backend HTTPS URL, pinned fingerprint, effective role, token stored yes/no; “Forget connection and token” remains the local action. The first-run/replace-token workflow is detailed in A12.12. Never show the token itself in retained detail.

- **Populated:** A18 fictional endpoint, clearly fake fingerprint and token-stored indicator; real displayed fingerprints are full length.
- **Loading:** `settings.get()` is a local read, not a remote data loader. Current Connection detail has no pending label: URL and fingerprint show “—” and Token stored shows “No” until the read resolves, so “No” must not be read as a verified absence; an explicit local-loading state is presentation backlog.
- **Empty:** no configured endpoint/token routes to first run; it is not a successful connected state.
- **Stale:** last-known remote role/data may be stale; local config itself is labelled current local settings, not guessed live server state.
- **Offline/reconnecting:** show stored endpoint/fingerprint; no insecure bypass button.
- **Partial:** endpoint pinned but no token, role UNKNOWN or incomplete setup; expose the next authorized step.
- **Refreshing:** the first-run token test shows its pending label today; a local re-read of Settings is presentation backlog. Either shows the exact operation pending without wiping the endpoint.
- **Error with Retry:** current: a Settings local-read failure is one shared message with no re-read or Retry (a Retry is presentation backlog); first-run probe and pin failures show a message and leave the form available for resubmission; token failure requests another token; TLS mismatch requires explicit re-verification and re-pin, never generic acceptance.

Credential states: empty/dirty HTTPS URL; malformed URL validation; probe pending/failure; presented fingerprint awaiting comparison; pin pending/failure; token empty/dirty; token test pending/failure; saved; forget pending/failure. Existing code clears token input immediately on submit and the main process tests `CollectorStatus` before storing it. Preserve that secret-handling contract (`App.tsx:46-71`).

Web/native do not inherit this desktop trust flow automatically. Their mockups label trust/enrollment as prerequisite-blocked until A12.14 is resolved.

#### A12.9 Tariffs — current list and ADMIN workflows

**Read views:** tariff list and versions, currency/timezone/effective dates, bill-verification state; tariff holidays; monthly rate values. Preserve JSON rules editing as the existing ADMIN mechanism; a polished form builder is not required or silently invented.

**Existing actions:** Create tariff (`CreateTariff`); Validate and save tariff version (`CreateTariffVersion`); replace a year's Holidays list (`SetTariffHolidays`); Save monthly rate (`SetMonthlyRate`). Fields are name/currency/timezone; tariffId/effectiveFrom/effectiveTo/rules/sourceNote; tariffId/year/holidays array of date/name; tariffId/componentCode/month/ratePerKwh/sourceNote. There is no holiday-id delete action. Required decimal strings, IDs, enum values and date domains stay unchanged. Each form has a persistent label and helper text instead of asking the mockup tool to invent a rule schema.

- **Populated:** A18 fictional tariff/version, holiday and monthly-rate rows; unmistakable “Unverified”/“Illustrative tariff”.
- **Loading:** list/holiday/monthly requests independently pending.
- **Empty:** no tariffs; no versions; no holidays; no monthly rates, each with the existing permitted creation action for ADMIN only.
- **Stale:** retained configuration while disconnected; no altered effective dates or bill-verification badge.
- **Offline/reconnecting:** retain drafts/list; show inability to submit as a connection/role state, not successful save.
- **Partial:** tariff exists but version/rate/holiday coverage is missing; explain which calculation prerequisite is absent.
- **Refreshing:** keep selection and any draft of another operation. Approved behavior (owner, 2026-10-30; not current): after a confirmed success only the affected queries are invalidated, per the A16 invalidation map, and the submitted form resets to pristine (A11). Current: every successful mutation invalidates all cached queries and the form keeps its values.
- **Error with Retry:** query failure is separate from mutation failure; preserve draft and display exact server validation.

Show pristine, dirty, validation, pending, success and failure for all four actions. Unknown/VIEWER gets the same read data and no mutation controls. Replacing a holiday year's list must clearly state that replacement scope; do not invent per-holiday delete APIs. Tariff verification against an actual redacted bill is a separate operational process, not an editable “Verified” checkbox (`docs/operations.md:262-267`).

Evidence: `apps/desktop/src/renderer/views/Settings.tsx:101-154,262-320,457-784`; `packages/contracts/src/operations/dashboard.graphql:335-355,443-502`.

#### A12.10 Billing, Accounting and Exclusions settings — current separate categories

These are three distinct desktop dialogs/native detail pages, not one combined administration screen.

| Category | Read content and existing mutation scope |
|---|---|
| Billing | Period list, tariffId, start/end local dates, note, result state/stale flag. Save/upsert billing period (`UpsertBillingPeriod`) accepts bill text, note and opening-credit lots where current input supports them. No editing of calculated totals |
| Accounting | Policies with effective time, grid/solar/battery/load source choices, maximum gap, serialized per-family `validated` map and supersession/version state. Create accounting policy only; show recalculation/retention effects from the returned payload. Never auto-promote a candidate. Current list rows show version, effective time, sources, gap limit and note; the `validated` map and supersession are returned by the policy query, and `CreateAccountingPolicy` returns its recalculation/retention effects, but none of these is displayed today (presentation backlog) |
| Exclusions | Existing exclusions with from/to, families and reason (the operation also returns creator and creation time, not displayed today). Create data exclusion and Delete exclusion. Destructive removal retains confirmation and causes the A16 invalidation path (all cached queries today), not raw-data deletion |

For **each** category, provide these states:

- **Populated:** A18 period/policy/exclusion fixtures, with exact units and effective times.
- **Loading:** category request pending, separate from the editor's local draft.
- **Empty:** successful no periods/policies/exclusions; ADMIN sees the existing relevant action, VIEWER does not.
- **Stale:** retain returned state; a stale period is explicitly “Recalculation pending”; an existing superseded policy remains superseded.
- **Offline/reconnecting:** retain category and draft without pretending pending remote changes succeeded; role gating stays conservative.
- **Partial:** returned row has no calculation result, unknown/insufficient coverage or a missing optional field; label absence, never invent one.
- **Refreshing:** retain rows and drafts of other operations while the affected queries invalidate after a confirmed success (A16 map; the submitted form resets to pristine, A11). Current: all cached queries invalidate and the form keeps its values.
- **Error with Retry:** scoped query Retry; separate mutation error with preserved payload and no automatic replay.

Every action additionally shows pristine/dirty, JSON or field validation, pending, success and failure. Billing dates are inclusive local dates. Policy/exclusion date-times include their timezone and are converted through the existing backend contract, not by string slicing. A destructive confirmation identifies the record and consequence but adds no new deletion capability.

Evidence: `apps/desktop/src/renderer/views/Settings.tsx:101-154,786-909`; operations in `dashboard.graphql:356-380,423-427,503-541`.

#### A12.11 Meter readings settings — current, paginated

List utility readings with ID, timestamp, import/export kWh and existing optional tariff-window readings/notes. Create and delete readings remain ADMIN actions. The current delete sequence is: select a reading (or type its ID), then a native confirmation that names that ID; there is no separate type-the-ID challenge. Data Quality's two selectors consume the same loaded reading set; this is not a second independent paging implementation.

- **Populated:** A18 readings #901 and #902 with exact displayed dates and counters.
- **Loading:** initial list status; Add reading remains subject to verified ADMIN role.
- **Empty:** “No meter readings”; explain that two distinct readings are needed for reconciliation.
- **Stale:** retain all loaded rows; do not change timestamps to the latest app refresh.
- **Offline/reconnecting:** retained rows and draft; no false queued-save behavior.
- **Partial:** first page loaded, more available, or optional values missing; display count and explicit “Load more readings”.
- **Refreshing:** preserve rows/selection while refresh owns the request; a concurrent load-more must not cancel it. Pending next page is labelled “Loading more…”.
- **Error with Retry:** next-page error preserves prior rows; retry requests that page, not the beginning; a connection boundary discards the old backend's rows and drafts.

Show Add reading pristine, dirty, date/decimal validation, pending, success and failure; Delete reading confirmation, pending and failure. Do not copy real meter photographs or counters into design fixtures.

Evidence: `apps/desktop/src/renderer/views/Settings.tsx:911-1000`; `apps/desktop/src/renderer/api.ts:46-102`; `views/SettingsReadings.spec.tsx`.

#### A12.12 First run, startup and security states — current desktop

Required desktop frames, in actual state order:

1. Local settings/connection initialization pending (“Loading connection…”), caption controls available.
1a. **Local settings read failed (current):** heading “Connection settings unavailable” with the returned error text; the root caption controls remain. Current recovery: none inside the surface (no Retry, Forget or other control); closing and relaunching the app is an external recovery attempt that is not guaranteed to help. **Approved (owner, 2026-10-30; not current):** a Retry control that re-reads the local settings, shows “Retrying…” and is disabled while pending, keeps the surface and shows the new error if the read fails again, and on success continues into the normal state machine (setup, security or connected shell). No Forget or other clearing action is added. Draw no connected shell, sidebar or cached data here. Open point for the owner, not specified: today's `canQuery` does not consider the startup error, so remote queries may still run behind this surface; whether Retry should be paired with gating them is undecided. Evidence: `App.tsx:251-268,274-293,310-318`.
2. NOT_CONFIGURED: HTTPS URL entry and the three existing steps: enter URL; compare/pin certificate; test/save API token.
3. URL dirty and malformed input validation.
4. Certificate probe pending; probe failure with Retry.
5. Presented fingerprint, comparison guidance and explicit pin action; no “trust anything” default.
6. Pin pending/failure; successful pin moves to token entry.
7. Token empty/dirty; test-and-save pending; rejected token; success.
8. AUTH_FAILED: explain rejected credentials; replacement token form; no old admin role or cached data leakage.
9. TLS_MISMATCH: display presented fingerprint and the existing deliberate re-verification action; no dashboard data pretending to be from a trusted connection.
10. CONNECTED but LiveStatus loading, NO_DATA, stale or partial: these are Overview states, not more startup animation.
11. RECONNECTING with retained data and without retained data, with available retry timestamp and NAS-autonomy notice.

Use A11's full request vocabulary: populated = saved connection; loading = settings/probe/token request; empty = not configured; stale = retained data only; offline/reconnecting = connection notice; partial = pinned but token/role unavailable; refreshing = deliberate recheck; error/Retry = the precise failed operation (the local settings-read failure of 1a has no Retry today). Mutation states apply to URL/pin/token actions. No offline-first data storage is implied.

Evidence: `apps/desktop/src/renderer/App.tsx:46-238,240-362,468-475`; `packages/contracts/src/bridge.ts:4-58`; main security `main/security.ts:6-61`.

#### A12.13 Cloud stopgap — product-plan commitment, prerequisite-blocked

The product plan permits a read-only cloud stopgap while wired Modbus is unavailable. Cloud snapshots must stay in separate storage, never enter Modbus raw polls/ledger/accounting, and must be visibly lower-confidence. Modbus remains the target source (`SOLAR_MONITORING_PLAN.md:897-937`; `docs/field-mapping.md:3`). The current collector operation exposes `acquisitionSource`, but current LiveStatus/PowerSeries/EnergyTotals selections do not supply the planned cloud payload/freshness/source model. A source string alone is not enough to draw a cloud dashboard.

Required future frames once that contract is designed: **populated** cloud snapshot with vendor observation/fetch timestamps; **loading** cloud fetch; **empty** no snapshot; **stale** last vendor snapshot with no flow animation; **offline/reconnecting** retained cloud evidence without live claim; **partial** missing vendor fields; **refreshing** retained snapshot; **error with Retry** read-only fetch failure. Financial/accounting views are unavailable from cloud-only input unless separately supported by the product contract. Never draw inferred independent home energy, meter reconciliation or a trustworthy bill from cloud summary data.

Show “Cloud stopgap · vendor-reported · lower confidence”, not “Live”. Cloud credentials are server-side configuration/operations, not an invented account-login screen in the clients. Switching source must show the server-recorded source change; never blend streams into one continuous history.

#### A12.14 Responsive web and native iOS/Android — approved design scope, delivery blocked (R-client)

All current page/category content and eight data states above need responsive/native layout specifications. Native settings are full-screen details, with focus/back/keyboard behavior shown; there is no desktop caption strip. A12.12's desktop authentication sequence is shown only as a reference, not a browser implementation.

Before implementation, separately specify and approve the following; together they are the **R-client** gate:

- **Web:** deployable app location/build/runtime; same-origin HTTPS or explicit trusted-origin model; authentication/session and CSRF handling if cookies are used; CORS and CSP; how a private NAS certificate becomes trusted; secret storage without exposing the desktop encrypted credential; logout/connection-change cache invalidation; role checks and allow-listed operations; mobile keyboard/viewport behavior. A browser cannot read and pin an arbitrary TLS certificate the way Electron's main process can.
- **Native:** actual implementation framework, iOS/Android build/signing/distribution, permission model, TLS trust/pinning and enrollment, secure token storage, foreground/background lifecycle and reconnect policy, cache expiry/clear-on-identity-change, accessibility semantics, safe areas and system back behavior. No always-on background polling or push notification feature is authorized.
- **Shared:** preserve the exact data definitions, decimal strings, timezone rules, role gating and operation policy. Existing 10 s/30 s foreground cadence is the semantic baseline; do not invent native background collection. The NAS remains collector owner.
- **Metadata:** PV array size, installed battery capacity and house display name do not exist as client fields. They are fixture context only until an approved metadata contract exists. Device model can use the existing device model field.

Web/native client delivery and missing metadata are prerequisite-blocked, not tasks to solve with mocked transport, placeholder authentication or a permissive bridge. The designs can be reviewed now while their implementation remains explicitly blocked.

### A13. Startup

Startup presentation follows the state machine in A12.12, not a fixed animation sequence. Render the first useful loading/setup/security surface immediately. The existing font preload catches errors but awaits font loads before mounting; the replacement implementation must avoid an unbounded blank startup if font loading stalls (`apps/desktop/src/renderer/main.tsx:14-28`). Keep chart text measurement correct by rendering charts after their font is ready or refreshing chart typography when it resolves; do not hold the whole connection UI hostage to it.

The approved original mark may appear within the already-visible startup surface, with one optional 200 ms opacity appearance using the existing motion token. It must not add a startup wait, network request or synchronization dependency. Error/setup content (including a local settings-read failure) wins immediately. Reduced motion, font failure, a warm launch, reconnect and native resume use a static mark or no decorative mark.

Native launch screens are static platform launch surfaces. Any in-app mark appears only after first render and uses the same non-blocking rule. Browser startup is ordinary page loading, not a fullscreen splash overlay.

Do not show a percent, named initialization stage or estimated time unless an actual operation exposes it. “Connecting…” is sufficient. Caption controls and accessibility focus remain usable throughout.

### A14. Logo and icon

Owner-approved scope: specifications and later design prototypes, not asset production during this planning task. Use an original solar/measurement motif that works without a house illustration, a battery-brand mark or any Motrix asset. The wordmark is “Solar”; the product name remains “House Solar Monitoring”.

Required variants: monochrome light on dark; monochrome dark for external packaging only; one restrained accent version using A4's solar token; mark-only; horizontal wordmark; native/adaptive icon compositions with safe-area previews. No new color system or mandatory logo animation.

Legibility checks use existing 16 px navigation, 24 px page-title scale, 32 px metric scale and 52 px settings-art scale; Windows packaging preview follows the standard 16/32/48/256 px icon sizes. Clear space is one 4 px grid unit at the 16 px mark size and scales proportionally. These are prototype acceptance sizes, not a promise to modify packaging now. Native assets must later follow the chosen platform tooling's current export contract; this plan does not fabricate a production asset catalogue.

The icon must not resemble a status indicator or imply live data. Test grayscale, a single color, dark background and reduced detail at small size. Use no embedded fonts in SVG; create outlines only for an approved wordmark export, preserve editable source and document license/original authorship. The current brand-slot placeholder is the lucide `Sun` glyph in the window chrome (`window-chrome.tsx:107`); do not infer logo artwork from reference captures.

**R-brand-package (packaging gate).** Production executable, taskbar and installer icon work, native icon catalogues and launch assets need a separate packaging decision. The current `electron-builder.yml` configures no icon and sets `signAndEditExecutable:false`; do not flip signing or resource-editing flags as a visual fix, claim that `win.icon` alone embeds the icon, or invent an app-store identity or bundle identifier. Native exports depend on the chosen platform toolchain. Design prototypes do not wait on this gate, and approving a mark does not authorize packaging changes.

### A15. Accessibility

Meet WCAG 2.2 AA for web/Electron content; apply equivalent native accessibility semantics and platform text-size/target guidance.

- **Perceivable:** normal text ≥4.5:1; large text/non-text meaningful graphics ≥3:1; measure actual composited states, including selected, stale, focused, disabled explanation, tooltip and chart. Normal text includes 10/11/12 px labels. Color alone never distinguishes energy direction or status. Preserve visible units and absolute time/timezone alongside relative age.
- **Keyboard:** every action, range/date input, reading selector, legend control, chart inspection, tooltip disclosure, modal close and pagination control works without a pointer. Native select remains native. Native screen readers get equivalent labels/values/actions and a logical reading order.
- **Focus:** visible 2 px solid outline with 2 px offset using the high-contrast focus token, derived from the existing 2 px focus geometry and the measured 4 px spacing scale. Verify SC 2.4.7 and 2.4.11: no clipping/obscuring by title chrome, sticky headers, scroll regions, popovers or software keyboard. A full-strength outline on a pale primary button must be contrasted against the surrounding dark surface, not disappear inside the button fill.
- **Reflow and resize:** verify 200% text resize (SC 1.4.4) and 320 CSS px reflow (SC 1.4.10), including 400% browser zoom from a 1280 px viewport. Desktop minimum remains 914×672; at text zoom, content reflows inside it rather than shrinking text or arbitrarily increasing the minimum. Two-dimensional tables get bounded scrollers with captions, not page-wide overflow.
- **Semantics:** one page h1; labelled nav/main landmarks; meaningful table headers/captions; persistent input labels; `aria-invalid` plus associated error; `aria-busy` on pending regions; real buttons rather than clickable divs. Accessible metric text contains label, value, unit, status and reason without duplicated announcements.
- **Feedback:** polite connection/refresh/save status; announce errors once. Do not announce every live metric on each 10 s poll. Mutation success is based on resolved operation response; dirty/pending/failed are distinct.
- **Tooltips:** pointer and focus access, Escape dismissal, hoverable/persistent content as needed under SC 1.4.13; touch disclosure alternative; no title-only SVG explanations.
- **Motion/transparency:** honor `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast` and forced colors; native platform equivalents. Reduced-motion chart and flow must still expose the same information.
- **Security accessibility:** full fingerprint readable/copyable where allowed, not color-only match advice. A warning must name the endpoint and next safe action; never conceal a changed identity in a generic offline toast. Where no in-surface recovery exists (for example the local settings-read failure before its approved Retry is implemented), say so plainly instead of inventing an action.
- **Error and role state:** disabled actions explain why; read-only role does not remove the information needed to understand a configuration. Form failure retains non-secret input. No keyboard trap outside an intentional modal scope.

### A16. Performance budgets and implementation constraints

These are limits and future acceptance targets, not measured performance claims. No performance run occurred during planning.

| Budget / invariant | Requirement | Source |
|---|---|---|
| Network cadence | LiveStatus 10 s; CollectorStatus 30 s; all other queries keep their existing request timing (no interval; mount- or selection-driven), except the two owner-approved Settings changes in the next two rows | `App.tsx:251-268`; `Overview.tsx:39-55`; product plan `:430` |
| Chart points | Keep renderer `maxPoints:1000`; server hard cap remains 2000 points per metric and supported span at most 366 days; never increase it to make a mockup smoother | `History.tsx:84-99`; `SOLAR_MONITORING_PLAN.md:605-609` |
| Existing page sizes | Meter readings 50, quality events 100; billing periods and calculation runs keep their existing selections and pagination semantics | `api.ts:61-78`; `DataQuality.tsx:49-55,128-131`; `dashboard.graphql:291-297,367,386,428` |
| Interaction target | Browser INP ≤200 ms at the 75th percentile; for local Electron scenarios report measured input-to-paint distributions separately, not a fabricated field percentile | Core Web Vitals “good” INP threshold; proposed acceptance target |
| Main-thread work | Avoid tasks >50 ms during interaction; inspect chart creation/update, dialog open and large lists | Long Tasks API definition; diagnostic threshold, not proof from code review |
| Web rendering targets | LCP ≤2.5 s and CLS ≤0.1 at the 75th percentile after the web delivery exists | Core Web Vitals “good” thresholds; no claim that NAS network/device conditions are controlled |
| Decorative startup | Zero additional network requests and zero intentional delay to useful content, connection initialization or polling | Product monitoring-only/autonomous-client constraint plus owner-approved non-blocking startup scope |
| Charts | Initialize one ECharts instance per mounted chart; update options without dispose/re-init on every option change; dispose on unmount; clean up ResizeObserver; no chart animation | Current lifecycle issue at `components/Chart.tsx:133-146`; existing chart module imports at `:1-27` |
| Hidden settings and Settings query timing | Closed categories must not render their content (preserve the `Lazy`/dialog render-on-open pattern) **and, by owner approval (2026-10-30; not current), must not request their data.** Approved map (GraphQL queries; the Connection category's local settings read is not one): Connection — none; Tariffs — Tariffs, plus TariffHolidays and TariffMonthlyRates once a valid tariff ID is selected; Billing — BillingPeriods (first 24); Accounting — AccountingPolicies; Exclusions — DataExclusions (first 100); Meter readings — MeterReadings (first page 50). Data Quality's own meter-reading selectors keep loading with Data Quality, so `useMeterReadings` needs an enablement input rather than a second paging implementation. Cached results stay in the query cache while a category is closed and refetch on reopen when stale. Current behavior: `Settings` requests Tariffs, MeterReadings, BillingPeriods, AccountingPolicies and DataExclusions when the Settings destination mounts, whichever category is open; TariffHolidays and TariffMonthlyRates need only a valid tariff ID | `Settings.tsx:211-260,347-372`; `api.ts:30-44,61-102` |
| Mutation invalidation | **Approved (owner, 2026-10-30; not current):** a confirmed successful mutation invalidates only the queries whose data it can change, by operation name. Current: `client.invalidateQueries()` invalidates every cached query after every Settings mutation. Starting map derived from the backend's effects (the implementing slice must verify it against `apps/backend/src/accounting/accounting.mutations.ts`, `apps/backend/src/tariff/billing.service.ts`, `apps/backend/src/tariff/tariff.service.ts`, `apps/backend/src/graphql/tariff.resolver.ts` and `apps/backend/src/reconciliation/reconciliation.service.ts`, and must broaden it wherever a derived value could stay stale), by operation name: CreateTariff → Tariffs; CreateTariffVersion → Tariffs, BillingPeriods, BillingPeriod, EnergyTotals (tariff windows); SetTariffHolidays → Tariffs (it revokes `billVerified`), TariffHolidays, BillingPeriods, BillingPeriod, EnergyTotals; SetMonthlyRate → Tariffs (it revokes `billVerified`), TariffMonthlyRates, BillingPeriods, BillingPeriod (not EnergyTotals: tariff windows read versions and holidays, not monthly rates); UpsertBillingPeriod → BillingPeriods, BillingPeriod; AddMeterReading and DeleteMeterReading → MeterReadings, Reconciliation, LiveStatus (accounting status derives from the latest readings), BillingPeriods, BillingPeriod; CreateDataExclusion and DeleteDataExclusion → DataExclusions, EnergyTotals, PowerSeries, Reconciliation, DataQualityEvents (the ledger recompute rewrites counter and balance events), BillingPeriods, BillingPeriod, LiveStatus, and CalculationRuns (conservative, not a demonstrated direct dependency); CreateAccountingPolicy → AccountingPolicies, CalculationRuns, EnergyTotals, PowerSeries, Reconciliation, DataQualityEvents, BillingPeriods, BillingPeriod, LiveStatus, CollectorStatus. No Settings mutation invalidates Devices. Ledger and bill recomputation after a policy or exclusion change is asynchronous, so the first refetch after the acknowledgement can still return pre-recompute derived values: show them as retained or pending evidence (stale flag, “Recalculation pending”), leave any further refresh to the existing intervals and the user's deliberate Refresh/Retry, and add no timer. | `Settings.tsx:295,387`; `apps/backend/src/accounting/accounting.mutations.ts:82-130`; `apps/backend/src/tariff/billing.service.ts:499-545` |
| Dependencies and assets | No new charting library, motion framework, font family, renderer network client or icon pack; keep tree-shaken ECharts and existing font package | Existing `package.json:14-47`, `Chart.tsx:1-27`; this plan's no-unnecessary-dependency constraint |
| Resource-growth acceptance | Repeated page/dialog open-close and range changes must return to the same active chart/observer/listener count; no retained old connection cache after identity change | Existing cleanup and connection-epoch contracts, `Chart.tsx:140-145`; `connection-scope.tsx:22-37` |

No arbitrary bundle-size, idle-memory or FPS number is invented from screenshots. Before implementation, record the current packaged renderer assets, font bytes, cold/warm startup and chart update measurements locally; compare the same scenario/build class afterward. Report regressions with causes. Visual approval does not excuse recreating canvases or adding a request per animation frame.

Chart colors/font metrics should be resolved once per theme/font change, not repeatedly per point. Keep decimal calculations on the backend; display formatting does not justify copying data into a second client accounting engine. No virtualization library is required for the currently bounded lists; preserve explicit paging and accessible counts.

### A17. Content, units and copy

**Terminology.** “Solar”, “Home (derived)”, “Battery charge”, “Battery discharge”, “Grid import”, “Grid export”. “Connected” describes transport only; “Live” requires the existing freshness result. Use “Observed at”, “Last received”, “Coverage”, “Source”, “Unverified”, “Recalculation pending” and “Not calculated” precisely. Raw reason/status codes remain available in the explanation, even when the visible sentence is friendlier. “Home” alone is only a compact alias of “Home (derived)” in tight tables and axes where the full name is in the legend or accessible name; the API names (`load` for live power, `consumption` for energy) are not renamed, and aligning the current “Consumption” energy labels to “Home (derived)” is a presentation terminology change.

**Power.** Keep raw API power in W. For metric/flow text, `abs(value) < 1000 W` uses W with zero fractional digits; `abs(value) ≥1000 W` uses kW with two fractional digits. The 1000 threshold is the SI kilo conversion; two decimals preserve 10 W display resolution, matching the finest two-decimal kW target without changing raw data. Actual readings remain available in a tooltip/table; a nonzero sub-watt diagnostic value must use `<1 W`/`>−1 W`, not appear as a measured zero. Exact zero remains `0 W`. Use a Unicode minus sign for negative visible values; direction labels remain explicit. Axis units are selected once for the whole chart from its range, not switched independently on every tick.

This is the owner-approved presentation contract, not a small safe fix. It replaces the product plan's all-W display wording at `SOLAR_MONITORING_PLAN.md:409-410` for redesigned metric/flow text only; sign conventions and wire values are unchanged. Update affected formatting assertions in the same implementation. Do not convert IDs or Decimal monetary strings through `Number`.

**Energy.** Display kWh with exactly three decimals for tiles, totals and reading tables; the source is current `energyValue(...,3)` plus the backend's Wh-to-kWh output resolution (`models.ts:86-97`; `apps/backend/src/accounting/totals.service.ts:283`). Do not switch month totals to MWh or truncate a long value to preserve square tiles. Tooltip/export-equivalent detail may expose the original decimal string without a client recomputation.

**Money and rates.** Display the tariff's ISO currency code, e.g. `MYR 138.29`; two decimals follow the backend's 0.01 `ROUND_HALF_UP` line rounding. Rates use `MYR/kWh` with their configured precision, up to six fractional digits as the tariff contract allows; show the four-place fixture rates verbatim in Settings. Returned billing lines can normalize a zero monthly rate to `0` and return null for a PER_KWH rate even when configured; do not reprice them on the client. NEM balances use kWh with three display decimals, without rounding the stored credit bank. Credit origin/expiry and eligible components stay explicit.

**Percent and ratios.** Coverage uses the existing maximum two decimal places and trims insignificant zeros (the current formatter renders 670/672 as `99.7 %`, with a space; this brief writes 99.7%, and uses 99.70% only as calculation notation); it is a backend-returned fraction, not recomputed from a screen's count, and is always relative to its own window (a day, a month or a reading window). Backend `status` OK means coverage of at least 0.995, not complete data; show the returned coverage and flags and never round 99.7% to 100%. SOC is an integer percent from the API, labelled `%`; coarse SOC extrema are not an average. Reconciliation ratios use four decimal places for comparison and expose the original Decimal value on inspection. Percentage/ratio precision is display-only; thresholds remain the backend's.

**Locale and time.** Numeric punctuation follows the existing English comma-grouping/decimal-point convention used by `decimal()`; make `watts()` consistent instead of relying on the host's arbitrary locale. Do not reinterpret user-entered decimal strings using locale separators. Display dates with unambiguous month names where space allows (`18 Feb 2026`); date inputs retain ISO local dates. Display timestamps in the configured **site** timezone, with zone/UTC offset visible in range headings and tooltips. An optional “this device” time annotation must be explicitly labelled, not replace the site time. Current `localInstant()` follows OS-local time; changing it to site-local display requires a later atomic migration of every caller/test, not a CSS-only fix.

Use inclusive From/Through local dates in forms and billing display. Convert to `[start-of-from-day, start-of-day-after-through)` UTC instants with existing Luxon helpers. Never add a fixed 24 hours or parse a date-only string as UTC for local-day boundaries. Preserve the product's DST tests, including synthetic Europe/Berlin 23/25-hour days, even though the fictional house is in Asia/Kuala_Lumpur.

**Data honesty.** `—` means unknown with a reason; zero means measured zero. Lower-bound energy is labelled “At least …” only when that claim is supported; missing energy cannot reduce a non-negative total, but a **cost with NEM credit is not necessarily a lower bound**. Use the backend `isLowerBound` for cost, never infer it from low coverage. Interpolated counter allocations stay ESTIMATED; no line smoothing or copied SOC averages. Keep per-family coverage, source, flags and validation.

**State copy examples**

| State | Copy intent |
|---|---|
| No readings | “No readings yet. The collector has not supplied a usable reading.” Include actual reason/state; no hardware troubleshooting guess |
| Stale | “Last reading: 1 Mar 2026, 12:00:00 · Asia/Kuala_Lumpur. Data is not live.” |
| Reconnecting | Existing last-data/age notice plus “Collection runs on the NAS independently of this app.” |
| Partial history | “Coverage 91.67%. The shaded interval has no readings.” — the 18 Feb day view only; the same 2 h gap is 99.7% of the February window (A18.2) |
| Current-day partial | “Today so far · through 12:00. Coverage 50% of the requested local day.” Do not call future hours an outage |
| Query failure | Name the affected region, show returned safe error text, offer Retry |
| Unavailable bill | Show UNAVAILABLE and backend reasons, not “MYR 0.00” |
| Pending mutation | “Saving…” / “Deleting…” / “Testing token…” with the exact operation still visible |
| Failed mutation | “Could not confirm the change.” Preserve safe draft; for an ambiguous request outcome refresh before resubmitting |
| Unknown role | “Role not verified. Changes are unavailable.” |
| Cloud stopgap | “Cloud stopgap · vendor-reported · lower confidence.” |

Do not write “real-time”, “accurate bill”, “verified” or “saved” without the corresponding data/operation evidence. No marketing copy or placeholder lorem ipsum.

### A18. Shared fictional sample data — use verbatim in every batch

Everything in this section is invented for design. It is not a real home, tariff, bill, endpoint, credential, observation or hardware verification. Never substitute values from attached captures. Reuse the named variants rather than inventing extra examples.

#### A18.1 House, clock and connection

| Field | Fixed fictional value |
|---|---|
| Fixture name | Cedar demo house — fictional |
| Site timezone | `Asia/Kuala_Lumpur` (UTC+08:00; no DST in this fixture) |
| PV array | 8.4 kWp — design context only; no current API capacity field |
| Battery | 20.0 kWh — design context only; no current API capacity field |
| Inverter model | `DEMO-HYBRID-10` — fictional placeholder, not a real manufacturer model |
| Device | id `701`, key `demo-inverter-701`, first seen `2026-01-01T00:00:00+08:00` |
| Monitoring since | `2026-01-01T00:00:00+08:00` |
| Frame clock | `2026-03-01T12:00:02+08:00` (`2026-03-01T04:00:02Z`) |
| Live observation | `2026-03-01T12:00:00+08:00`, `ageSeconds=2`, freshness `LIVE` |
| Connection | CONNECTED, role ADMIN; separate VIEWER and UNKNOWN variants change only the role |
| Acquisition source | MODBUS; mapping remains provisional and policy unvalidated |
| Endpoint | `https://solar-demo.invalid:8443` — reserved non-routable example domain; never contact it |
| Fingerprint | `SHA256/DEMO-NOT-A-VALID-FINGERPRINT` — visibly invalid design placeholder, not a reusable trust anchor |
| Token field | Masked dots and “Not a real token”; no plausible bearer token string |
| Token stored indicator | “Yes” in the baseline connected variant (Settings Connection detail, a stored-or-not flag). It is separate from the token-entry field; the token itself never appears in retained detail |
| Configured policy | version `7`; grid `METER_NET`; PV/battery `INTEGRATED`; load `DERIVED`; `maxGapSec=30`; serialized `validated={}` (no family validated); fictional note |
| Collector | RUNNING; last success at live observation; mappingVersion `1` (provisional); calcVersion `3`; policyVersion `7`; zero consecutive failures in baseline |
| Last backup | `2026-03-01T02:00:00+08:00` |
| Fictional TLS expiry | `2027-03-01T00:00:00Z` |

The fixture name/capacities appear in the design-system/context sheet only unless a frame is explicitly annotated as **prerequisite-blocked: metadata contract**. The product UI may show the existing device model; it must not imply that the API already returns installed capacities or a house name.

**Live snapshot:** Solar `5400 W` → `5.40 kW`; Home `1700 W` → `1.70 kW`; Grid `−1884 W` → `1.88 kW export`; Battery `−1600 W` → `1.60 kW charging`; SOC `60%`; operating mode “Normal”; current faults empty. The 216 W residual is 4% of PV in this invented arithmetic, **not** a measured loss or an accounting-policy/API field. Displayed direction magnitudes are positive with labels; a signed chart uses the signed raw values. A18 supplies no vendor-reported load, per-phase grid powers, per-string PV powers or `meterLink` text: show those slots as not supplied (A12.1).

**Today-so-far energy, 1 Mar 2026 through 12:00:** solar `18.400 kWh`, home `11.200 kWh`, grid import `2.448 kWh`, grid export `4.912 kWh`, battery charge `6.000 kWh`, battery discharge `2.000 kWh`. The current totals API measures coverage over the requested whole local day, not clipped to now: coverage `0.5` / `50%`, status PARTIAL, despite complete observations in the elapsed half-day. This follows `apps/backend/src/accounting/totals.service.ts:204-218,275-295,542-555,694-699`. Label “Today so far”; do not normalize 50% to 100% or call the future half-day missing telemetry.

#### A18.2 One completed sample day

Date: **18 Feb 2026**, local range `[00:00, 19 Feb 00:00)`. The table defines twelve two-hour mean-power intervals; rows cover `[start,start+2h)`. Use a piecewise-constant/step representation for this deliberately coarse fixture, not a fabricated smooth curve. Production plots use their actual returned bucket width. Values are kW. Grid positive means import; battery positive means discharge.

| Interval start | Solar | Home | Battery signed | Grid signed | SOC start → end |
|---|---:|---:|---:|---:|---|
| 00:00 | 0.000 | 0.600 | +0.400 | +0.200 | 40% → 36% |
| 02:00 | 0.000 | 0.500 | +0.300 | +0.200 | 36% → 33% |
| 04:00 | 0.000 | 0.500 | +0.300 | +0.200 | 33% → 30% |
| 06:00 | 0.600 | 1.200 | 0.000 | +0.624 | 30% → 30% |
| 08:00 | 3.000 | 1.300 | −1.000 | −0.580 | 30% → 40% |
| 10:00 | 5.600 | 1.500 | −2.000 | −1.876 | 40% → 60% |
| 12:00 | 5.400 | 1.700 | −1.600 | −1.884 | 60% → 76% |
| 14:00 | 3.200 | 1.400 | −0.400 | −1.272 | 76% → 80% |
| 16:00 | 0.800 | 1.500 | +0.300 | +0.432 | 80% → 77% |
| 18:00 | 0.000 | 2.700 | +2.200 | +0.500 | 77% → 55% |
| 20:00 | 0.000 | 2.300 | +1.600 | +0.700 | 55% → 39% |
| 22:00 | 0.000 | 1.200 | +0.700 | +0.500 | 39% → 32% |

Complete-day totals: solar **37.200 kWh**, home **32.800 kWh**, import **6.712 kWh**, export **11.224 kWh**, charge **10.000 kWh**, discharge **11.600 kWh**, coverage **100%** for every family. Provenance is MEASURED_INTEGRATED for solar/grid/battery and DERIVED for home; `validated={}`. Residual `37.2 + 11.6 + 6.712 − 10 − 11.224 − 32.8 = 1.488 kWh`, 4% of solar by construction, **not** a reported physical loss. The 20 kWh battery goes from 8.0 to 6.4 kWh, matching discharge minus charge of 1.6 kWh; the fictional SOC endpoints ignore conversion loss and do not assert battery efficiency.

**Gap variant:** remove the entire 12:00–14:00 interval (7,200 s) in every power/energy family. Show a gap and no invented SOC average; known endpoints can remain separately labelled if returned. Covered-only totals become solar **26.400**, home **29.400**, import **6.712**, export **7.456**, charge **6.800**, discharge **11.600 kWh**. Coverage is `22/24 = 91.67%` **of this 24 h day** (backend status PARTIAL, below 0.995); the same 7,200 s is `670/672 = 99.7024%` of the 672 h February window (calculation; displayed 99.7%), which is the coverage in A18.3's gap-month variant and A18.4's shared-gap variant. Coverage is always relative to its own window. These are partial lower-bound non-negative energy totals, not a second complete day. This variant replaces the complete-day dataset in its frame; do not mix its totals with the complete curve.

**SOC coarse variant:** use the same interval endpoints as minimum/maximum bounds; `avg=null` in every coarse bucket, so no average line. A completely missing interval has no invented extrema. This is a distinct presentation variant of the same day, not a claim that two-hour averages exist in the current rollup API.

#### A18.3 One month, tariff and billing period

Month and billing period: **1–28 Feb 2026**, inclusive local dates. The underlying range ends **1 Mar 2026 00:00**. Baseline month totals are solar **810.000 kWh**, home **942.600 kWh**, import **420.000 kWh**, export **250.000 kWh**, battery charge **145.000 kWh**, battery discharge **140.000 kWh**; coverage **100%**. Residual is **32.400 kWh**, exactly 4% of solar. Grid import splits into **180.000 kWh peak** and **240.000 kWh off-peak**. The sample day is one plausible constituent day; no daily interpolation of the remaining month is permitted.

**Gap-month variant (explicitly shares the A18.2 gap).** Because the 18 Feb day is a constituent of the February baseline, removing its 12:00–14:00 interval gives covered-only month totals of solar **799.200**, home **939.200**, import **420.000**, export **246.232**, battery charge **141.800** and battery discharge **140.000 kWh**; import and its 180.000/240.000 kWh peak/off-peak split are unchanged because that interval had no import. Coverage is `670/672 = 99.7024%` (displayed 99.7%) for every family. The backend would label this status OK (coverage at least 0.995) although 7,200 s are unobserved, so frames show the returned coverage and any returned gap flags rather than a “complete” mark. **No bill is supplied for this variant:** the MYR 138.29 result below belongs to the baseline month and must not sit beside these totals as if it had been recalculated; show cost as not supplied, or the retained baseline result flagged “Recalculation pending”. This variant replaces the baseline month in its frame.

Tariff id **301**, version **3011**, name **Cedar fictional ToU + NEM**, currency **MYR**, timezone **Asia/Kuala_Lumpur**, effective **1 Jan 2026**, no end date; `billVerified=false`. This is not a TNB rate quotation. Source note: **“FICTIONAL DESIGN DATA — not a utility tariff or bill.”**

- Peak: Monday–Friday 14:00–22:00 local, excluding the fixture's tariff holiday; all other times off-peak, matching the product's defined window structure.
- ENERGY import rates: **MYR 0.5000/kWh peak**, **MYR 0.3000/kWh off-peak**, single flat tier in each window.
- NETWORK import rate: **MYR 0.2000/kWh**, all windows; not eligible for NEM offset.
- AFA monthly rate: **MYR 0.000000/kWh** for Feb 2026; a known zero, not a missing rate.
- RETAIL fixed charge: **MYR 8.00**, not prorated in this fictional rule.
- `consumptionBasis=GROSS_IMPORT`, `thresholdProration=NONE`, `totalRounding=NONE`.
- NEM: `offsetComponents=[ENERGY]`, `touOffset=PRO_RATA`, `creditExpiryPeriods=12`. **Export rate equivalent:** 1 kWh eligible credit offsets 1 kWh of ENERGY import basis, valued at the applicable **0.5000/0.3000 MYR/kWh** import-window rates after pro-rata allocation. There is **no cash export payment or independent sell-back rate**.
- Fictional tariff holiday: **12 Feb 2026 — “Cedar example holiday”**. This is not a claim about a real gazetted holiday. Settings saves the year's holiday list through `SetTariffHolidays`, not a new holiday-delete API.
- Opening lots: **50.000 kWh** from **1 Dec 2025**; **10.000 kWh** from **1 Jan 2025**. The older lot expires before use under the provisional >12-month age rule; expired lots show that **10.000 kWh**. The remaining 50 plus current export 250 provides **300.000 kWh** eligible credit, all consumed; closing bank **0.000 kWh**.

**Fictional returned bill, id 801:** ENERGY chargeable basis is `420−300=120 kWh`. PRO_RATA allocation yields `51.428571… kWh` peak and `68.571428… kWh` off-peak. Those window figures explain the calculation; the backend returns **one aggregated ENERGY line**, not separate peak and off-peak line items. Its stored display quantity is `120.000 kWh`; PER_KWH lines return `rate=null` even for a single configured rate. Do not recompute the returned charge from rounded display quantities (`apps/backend/src/tariff/engine.ts:274-340`).

| Returned line | Basis / rate | Returned amount |
|---|---|---:|
| ENERGY | 120.000 kWh; returned rate null, configured peak/off-peak rates as above | MYR 46.29 |
| NETWORK | 420.000 kWh; returned rate null, configured MYR 0.2000/kWh | MYR 84.00 |
| AFA | 420.000 kWh; configured MYR 0.000000/kWh, returned rate `0` | MYR 0.00 |
| RETAIL | Fixed; quantity null, returned rate MYR 8.00 | MYR 8.00 |
| Subtotal / total | No additional rounding line | **MYR 138.29** |

Status **ESTIMATED**, `isLowerBound=false`; reasons **TARIFF_NOT_BILL_VERIFIED**, **MAPPING_PROVISIONAL**. The fictional pair yields a passing METER_NET comparison, so the current billing service does not add ACCOUNTING_UNRECONCILED; a candidate PASS still does **not** verify the physical meter or provisional mapping. Coverage can be 100% while the result remains estimated. This is never labelled a real bill or verified cost. A current UNAVAILABLE variant has null subtotal/total, no line items or NEM, and reason **COVERAGE_BELOW_80**; a future cloud-only **VENDOR_DATA_ONLY** variant is prerequisite-blocked (A12.13). A stale variant retains MYR 138.29 and adds “Recalculation pending”.

The COMPLETE visual/status component may appear on the design-system sheet as a semantic swatch. Do not change this fictional bill to COMPLETE merely to exercise the color.

#### A18.4 Readings, reconciliation, runs and exclusions

| Reading | Site-local instant | Import counter | Export counter | Source / resolution |
|---|---|---:|---:|---|
| #901 | 1 Feb 2026 00:00 | 12,600.000 kWh | 3,850.000 kWh | UTILITY_METER_MANUAL; 1 kWh |
| #902 | 1 Mar 2026 00:00 | 13,024.000 kWh | 4,102.000 kWh | UTILITY_METER_MANUAL; 1 kWh |

Utility deltas: import **424.000 kWh**, export **252.000 kWh**. Both are fictional typed readings; no photograph is attached.

| Candidate | Coverage | Our import / utility / ratio / verdict | Our export / utility / ratio / verdict |
|---|---:|---|---|
| METER_NET | 100% | 420.000 / 424.000 / 0.9906 / PASS | 250.000 / 252.000 / 0.9921 / PASS |
| METER_PER_PHASE | 100% | 444.000 / 424.000 / 1.0472 / FAIL | 255.000 / 252.000 / 1.0119 / PASS |
| INVERTER_COUNTER | 100% | 455.000 / 424.000 / 1.0731 / FAIL | 260.000 / 252.000 / 1.0317 / FAIL |

Verdicts follow the product's `max(2% of utility delta, 2×meter resolution)` tolerance (`SOLAR_MONITORING_PLAN.md:701-704`). They are fictional result examples, **not** verification of physical meter netting, hardware mapping or policy family validation. Live accounting status is **MAPPING_PROVISIONAL** while mapping version 1 is provisional; a non-provisional mapping with the same fictional METER_NET PASS would report RECONCILED.

**Coverage windows and variants.** Reconciliation coverage is measured over the whole reading window #901→#902: 1 Feb 00:00 → 1 Mar 00:00 +08:00 = 672 h (2,419,200 s). It is computed per direction, and a candidate's coverage is the lower of its import and export coverage. The backend returns INSUFFICIENT for a direction when coverage is below 99%, the utility delta is below 50 kWh (import) or 20 kWh (export), or our quantity is unavailable; otherwise PASS when |ours − utility| ≤ max(2% of the utility delta, 2 × the readings' resolution) — 8.48 kWh for import and 5.04 kWh for export here — and FAIL otherwise. A day's 91.67% (22/24 h) therefore says nothing about reconciliation coverage. The two variants below define their own missing intervals and **share none unless stated**; each replaces the baseline reconciliation table in its frame and is never combined with the baseline or with the other variant.

| Variant | Missing interval and coverage | METER_NET import / export | METER_PER_PHASE import / export | INVERTER_COUNTER |
|---|---|---|---|---|
| **Shared-gap** | Explicitly the A18.2 gap, 18 Feb 12:00–14:00 (7,200 s): `670/672` = 99.7024%, displayed 99.7%, for the meter candidates | 420.000 / 424.000 / 0.9906 / PASS; 246.232 / 252.000 / 0.9771 / **FAIL** (difference 5.768 > 5.04) | Not supplied | Not supplied |
| **Insufficient-coverage** | A separate hypothetical outage of grid-meter data, 10 Feb 00:00 → 11 Feb 00:00 (86,400 s), **not** the 18 Feb gap: `648/672` = 96.4286%, displayed 96.43% | 405.000 / 424.000 / 0.9552 / INSUFFICIENT; 241.000 / 252.000 / 0.9563 / INSUFFICIENT | 428.000 / 424.000 / 1.0094 / INSUFFICIENT; 245.500 / 252.000 / 0.9742 / INSUFFICIENT | Baseline row unchanged: 100%; 455.000 / 424.000 / 1.0731 FAIL; 260.000 / 252.000 / 1.0317 FAIL |

The shared-gap row is the A18.2 gap's own arithmetic: that interval had export 3.768 kWh (1.884 kW × 2 h) and no import, so METER_NET export falls from 250.000 to 246.232 kWh; it shows that 99.7% coverage can still FAIL when the missing interval carried export. In the insufficient-coverage variant the missing day is fictional and carried METER_NET 15.000 kWh import / 9.000 kWh export and METER_PER_PHASE 16.000 / 9.500 kWh, stated here rather than derived from the sample day, and the counter row assumes the inverter counters, read before and after the outage in one device segment with no GRID/ALL exclusion, still bracket the interval (counter energy across a gap stays valid and is allocated over the span). Neither variant changes the baseline month, the baseline reconciliation table or the live accounting status (MAPPING_PROVISIONAL while mapping 1 is provisional). Each variant replaces its baseline only inside its own frame, and the shared-gap variant is the A18.2 gap's month and reading-window consequence. With a non-provisional mapping the backend would report RECONCILIATION_FAILED for the shared-gap METER_NET pair. Never display PASS below the backend coverage threshold.

Calculation-run fixtures: **#1101 LEDGER_RECOMPUTE DONE**, finished `2026-03-01T01:05:00+08:00`, reason “Fictional policy replay”; **#1102 CALC_PARAMS_CHANGE RUNNING**, started `2026-03-01T11:59:00+08:00`, no percentage; **#1103 LEDGER_RECOMPUTE FAILED**, finished `2026-02-20T03:01:00+08:00`, error “Fictional calculation failure”. These are separate displayed records, not three simultaneous states of one run.

Exclusion fixture **#1201**, `2026-01-10T02:00:00Z` through `2026-01-10T02:05:00Z`, families `["GRID"]`, reason **“Fictional maintenance interval”**, creator **demo-admin**. It is outside the February totals, so it does not contradict that month's full coverage.

#### A18.5 Alert and state variants

Alerts here are records/status explanations, not new push notifications. Use these exact examples and label each frame's variant.

| Variant | Fixed example and required visual treatment |
|---|---|
| Complete baseline | The A18.1 snapshot, no active fault; February history remains complete. The only event record compatible with it is “Counter jump rejected” below |
| No data | `observedAt=null`, `ageSeconds=null`, freshness NO_DATA, all live powers null with reason NO_READING and batterySoc=null; no animated arrows, no numeric zeros |
| Stale telemetry | Same last-good 12:00 snapshot; frame clock 12:02:00, `ageSeconds=120`, freshness STALE; retain numbers in grayscale |
| Reconnecting | Same last-good snapshot; frame clock 12:06:00; RECONNECTING, nextRetryAt 12:06:30; show 6 min age and the NAS-autonomy sentence |
| Meter link fault | At 12:00:00, kind METER_LINK_DOWN (event start 12:00:00; no end supplied); grid and derived home null with METER_LINK_DOWN, solar/battery known; no false grid/home flow direction. Alternate live variant: it replaces the baseline grid and Home values, so it is **not** compatible with the complete baseline snapshot |
| Missing interval | GAP record 18 Feb 12:00–14:00 (start and end). Alternate dataset, **not** compatible with the complete baseline. Day view: A18.2 gap totals, 91.67% of the day. Month and reconciliation views: A18.3 gap-month totals and A18.4 shared-gap variant, 99.7% of the window |
| Counter jump rejected | `COUNTER_JUMP_REJECTED` on 20 Feb 09:10:00, a point record (no end, no device: shown as “—”); “Rejected counter jump; integrated values retained where valid.” **Baseline-compatible:** it affects counter-based values only, so METER_NET/INTEGRATED coverage and every A18 quantity are unchanged. The backend aggregates row flags across families, so any `EnergyTotals` range that includes 20 Feb lists the `COUNTER_JUMP_REJECTED` flag in its reasons (the 18 Feb day does not). The event appears only when the Data Quality range includes 20 Feb (for example 1 Feb–1 Mar; the default range, first of the month to today, would be 1 Mar–1 Mar). No automatic zero or calibration. It is a different kind from `COUNTER_DISCONTINUITY` |
| Source change | ACQUISITION_SOURCE_CHANGED at 1 Mar 10:00:00, MODBUS → CLOUD; future cloud variant only, incompatible with the baseline MODBUS live values and today's totals; do not mix |
| Cloud failure | CLOUD_AUTH_FAILED at 1 Mar 10:05:00; future contract required; explain vendor access failure without exposing credentials |
| Query failure | “Could not load this data. Retry.” Retain successful sibling regions; no made-up server error code |
| Mutation failure | “Could not confirm the change. Refresh the affected list before submitting again.” Keep non-secret draft |
| Validation | Invalid range: through date before from date; invalid rate: `0.1234567` exceeds six fractional digits; invalid JSON: a missing closing brace. Do not create extra business rules |
| Known zero/idle | Alternate 04:00 sample: solar 0 W, battery 0 W, home 500 W, grid import 500 W; SOC 33%; neutral idle connectors. This replaces, not supplements, the 04:00 battery-discharge row for that demonstration |
| Refreshing | Same baseline values while a request is pending; no change to timestamps until a new response supplies one |

All event timestamps without a suffix in this table are in Asia/Kuala_Lumpur. Preserve them verbatim across batches. **Compatibility rule:** an event record may sit beside the complete baseline only if it cannot change any baseline quantity, coverage, source or live value. Of the rows above only “Counter jump rejected” qualifies; “Missing interval”, “Meter link fault”, “Source change” and “Cloud failure” are alternate variants that replace baseline frames. Event records are history, never active faults: the baseline `activeFaults` stays empty. Data absent from A18 must be shown as not supplied or explicitly requested from the owner; the mockup tool must not invent additional readings, rates, totals or identities.

## Part B — Gap audit with evidence

### B0. Method, severity and disposition

Severity: **P1** risks misleading data, inaccessible essential information or crossing a security boundary; **P2** blocks a required interaction or causes a material visual/performance mismatch; **P3** is clarity/maintainability or an unverified acceptance claim. These are prioritization labels, not vulnerability ratings.

Disposition **S#** refers to the exact small safe-fix specification in Part C. “Safe now” means independent of mockup approval, **not permission to change source during this documentation-only task**. **R** means backlog after the relevant mockups and prerequisites are approved; suffixes identify backlog slices, not additional severities.

Findings use current source plus retained evidence. The old audit is historical. Numerical color findings identify whether they are retained measurements or new local calculations. No runtime accessibility/performance pass is claimed.

### B1. Visual design and accessibility findings

| ID / severity | Finding and evidence | Disposition |
|---|---|---|
| B01 · P1 | Whole-panel 64% opacity makes stale/no-data text fail AA. `apps/desktop/src/renderer/components/panel-shell.tsx:61-67` applies opacity plus grayscale; retained `captures/local/ui-audit/measure/redesign/solar-contrast.json:25-50,181-205` includes 3.11/3.49/3.52:1 in reconnecting and 3.11/3.31/3.46:1 in no-data. Owner chose grayscale without dimming; conditions stay unchanged. Those ratios were measured with opacity applied; the remaining grayscale pairs are only calculated (A4), so the S1/A4 rendered-contrast gate decides the outcome | **S1** |
| B02 · P2 | Focus indicators have inadequate computed contrast. Ring tokens are `oklch(.556 0 0)` and many controls use 50% alpha: `styles/globals.css:109,127`; `ui/button.tsx:6`; `ui/input.tsx:11`; `ui/native-select.tsx:20`; `Settings.tsx:168,1035`. Reviewer calculation was approximately 1.8–2.6:1 on listed surfaces, below the 3:1 identifying-graphic target. Retained capture measures only the caption ring, not a keyboard sweep (`solar-spotchecks.json:114-121`) | **S2**; exact new token/geometry in A4/A15 |
| B03 · P2 | Form boundaries rely on 15%-white `--input`, with 30%-input fill: `styles/globals.css:108`; `ui/input.tsx:10`; `ui/native-select.tsx:20`; `Settings.tsx:168`. Computed boundary contrast is about 1.6:1 against the panel, not a captured measurement. Decorative separators may stay subtle; control-identifying borders need ≥3:1 | **S3** |
| B04 · P1 | Energy identity is not consistent across surfaces. Every non-idle flow connector is chart-1 (`styles/globals.css:188-205`); History maps series by index and hides the power legend (`views/History.tsx:107-132,164-180`); chart palette is positional (`components/Chart.tsx:74-81`). Import/export and charge/discharge are not six persistent semantic encodings | **R-semantic**; A4/A11 |
| B05 · P1 | Chart accessibility is only `role=\"img\"` plus a general label (`components/Chart.tsx:148-153`). Canvas points/tooltips/legend/zoom lack a keyboard/data-table path in that component; History's existing energy table is not a complete power/SOC equivalent (`views/History.tsx:265-360`) | **R-chart-access**; A11's plot and table interaction |
| B06 · P2 | Power flow has a generic image name and SVG `<title>` only for missing values, without a complete accessible directional summary (`components/EnergyFlow.tsx:19-24,59-65`). Unknown/zero values inherit an arrow endpoint from `models.ts:144-158`, potentially suggesting known direction | **R-flow**; retain raw data/tier rules, change presentation and summary |
| B07 · P2 | Larger/compact/text-resize layouts are not verified by the retained 914×672 captures. Current Overview uses four 160 px-min columns and fixed 160 px rows (`views/Overview.tsx:93`); Settings changes layout at 914 px (`views/Settings.tsx:1028-1035`). No evidence proves 1280×800, 1600×1000, 320 px reflow or 200% text | **R-responsive**; A6/A15 |
| B08 · P2 | JSON/control rows can resist narrow reflow: settings row controls are `w-56` and side-by-side (`views/Settings.tsx:161-168`); fixed chart height is 360 px (`components/Chart.tsx:150`). Native/detail layouts need explicit wrapping and keyboard-visible footers, not scaled screenshots | **R-responsive** |
| B09 · P2 | The API/markup distinguish many null/partial states, but successful-empty, refreshing and scoped Retry are inconsistent. Examples: Overview errors use Message without Retry (`views/Overview.tsx:88-92,245-249`); History tariff error is a raw Message (`views/History.tsx:245`); charts use a loading/error fallback rather than every state (`:254-360`), and the SOC tile shows “Loading SOC…” when the shared PowerSeries request fails (`:359`); reconciliation lacks a complete pre-selection empty guide (`views/DataQuality.tsx:352-400,509-517`) | **R-states**; A11/A12 |
| B10 · P3 | “Glass/native vibrancy” terminology survives in an opaque app's sidebar comment/variables (`styles/sidebar.css:2-21`), although no native material is configured (`apps/desktop/src/main/index.ts:18-31`). It can mislead a mockup tool into adding blur | **R-naming**; brief resolves terminology now; no unnecessary source variable rename in safe fixes |

### B2. Correctness, performance and delivery findings

| ID / severity | Finding and evidence | Disposition |
|---|---|---|
| B11 · P1 | Billing editor guidance says end date is exclusive (`views/Settings.tsx:123`), but the product billing algorithm treats endDate as inclusive and advances to the following local midnight (`SOLAR_MONITORING_PLAN.md:753`). Wrong instructions can cause a user to enter the wrong period without any API error | **S4**; copy only |
| B12 · P1 | Current timestamp display uses the device's locale/timezone (`models.ts:242-254`), while query boundaries use the configured site timezone (`:255-295,320-370`). History time axes use ECharts defaults (`views/History.tsx:112,143`). A travelling phone or differently configured PC can show a different local day from the query | **R-time**; migrate display callers/axis formatter and date tests together |
| B13 · P2 | Power uses host-dependent `toLocaleString()` and W only (`models.ts:41-43`), while Decimal formatting uses fixed comma grouping and Unicode minus (`:11-19`). W/kW conversion affects flow, KPI, string/phase values and axis/unit text, not just CSS | **R-format**; A17, B5 |
| B14 · P2 | `Chart` creates and disposes its ECharts instance/ResizeObserver whenever option identity changes (`components/Chart.tsx:133-146`). Range/query refresh can reconstruct a canvas and discard inspection/zoom state. Source establishes lifecycle churn, not a measured speed regression | **R-chart-life**; initialize on mount, update options separately, keep cleanup |
| B15 · P2 | CSS reduced-motion rules cannot disable ECharts' JavaScript animation. History options do not set `animation:false` (`views/History.tsx:107-181`), and the chart wrapper passes them directly (`components/Chart.tsx:138-139`) | **R-chart-motion**; explicit no-animation chart contract, verify actual canvas |
| B16 · P2 | Font loads are awaited before React mounts; a rejected load is caught but a stalled load leaves no connection UI (`renderer/main.tsx:14-28`). Adding a splash or longer font wait would compound the problem | **R-startup**; useful surface first, no unbounded brand/font gate |
| B17 · P1 | Settings generic mutation/editor has no pending ownership or duplicate-submit guard (`views/Settings.tsx:262-320,383-391`); typed tariff forms call the same mutation helper (`:585-780`), and every successful mutation invalidates all cached queries (`:295,387`). Dirty/validation/pending/failure need explicit UX; a failed network response is not proof the server did nothing | **R-mutations**; no automatic create replay |
| B18 · P1 | `requestRecalculation` exists in the backend schema but not the desktop operation map (`apps/backend/schema.gql:331`; `packages/contracts/src/index.ts:32-60`). The product plan specifies the backend mutation (`SOLAR_MONITORING_PLAN.md:339,349,594`) but no desktop control; an active mockup button would overstate current capability | **R-recalculate**; separate product approval plus operation/generated contract/allow-list/main policy integration before any desktop UI |
| B19 · P1 | The existing transport is Electron-only: CSP `connect-src 'none'`, sandbox and permissions (`main/security.ts:6-61`), bridge methods (`packages/contracts/src/bridge.ts:26-58`), pinned main-process requests and safeStorage (`main/api-client.ts:146-151,398`; `main/settings-store.ts:82-87`). The product plan says browser CORS is disabled (`SOLAR_MONITORING_PLAN.md:274`) | **R-client**; separate web/native delivery/security design before implementation |
| B20 · P1 | Cloud acquisition is a committed stopgap, not current independently measured accounting. CollectorStatus has `acquisitionSource` (`apps/backend/schema.gql:115-129`; `dashboard.graphql:222-242`), but selected LiveStatus/PowerSeries/EnergyTotals fields do not provide the planned cloud snapshot/source contract (`dashboard.graphql:112-289`; product plan `:903-935`) | **R-cloud**; do not repeat the erroneous claim that all source metadata is absent |
| B21 · P2 | House name/PV array size/battery capacity are not device/client fields in the current schema; Device supplies identity/model and first/last seen (`apps/backend/schema.gql:184-190`). The brief may use them as fictional context but cannot show an implemented system-profile editor | **R-metadata** |
| B22 · P2 | No current app icon is configured in BrowserWindow or builder (`apps/desktop/src/main/index.ts:18-31`; `apps/desktop/electron-builder.yml:1-28`). `signAndEditExecutable:false` at `:21` also blocks the current resource-editing path identified by the checkpoint reviewer. Asset approval alone does not authorize a packaging/security change | **R-brand-package**; prototype first, separately verify packaging and ASAR/signing effects |
| B23 · P3 | The old native acceptance “outer minus inner = 0” conflicts with retained inner 914×672/outer 930×680 and the explicit absence of an OS capture (`captures/local/ui-audit/measure/redesign/solar-native.json:2-28`). The 16×8 difference was attributed in that record to invisible DWM resize borders, not a visible menu/title band | **S5** documentation truth; **R-native-proof** for actual DWM border/corner verification |
| B24 · P3 | Retained measurements predate current classes: `measure/redesign/solar-S2.json:307` records the earlier content gutter, while `views/Overview.tsx:77` now includes `pe-0.5` and stable scrollbar gutter. The audit's baseline score is not a current score (`docs/ui-audit/desktop-ui-audit.md:9-14`) | **S5** historical qualification; **R-capture** fresh same-build evidence |
| B25 · P1 | Current-day EnergyTotals coverage spans the requested whole local day, not elapsed time (`apps/backend/src/accounting/totals.service.ts:204-218,275-295,542-555,694-699`). Calling 50% coverage at noon an outage or silently normalizing it to 100% would misrepresent the API | **R-content**; A17/A18 preserve returned coverage and explain “today so far” |
| B26 · P1 | Synthetic verification cannot establish physical meter netting, wiring or bill validity (`docs/field-mapping.md:3-11,55-62`; `docs/operations.md:262-267`; `TODO.md:33-37`). Mockups must not turn source names, candidate PASS or synthetic bill totals into “Verified” | **R-content**; retain the existing operational gates |

### B3. Historical findings already resolved or retained as guardrails

These are not new work items to reimplement. Their R disposition means preserve/check the contract during the approved redesign, not reopen a completed port.

| ID / severity | Current evidence and required disposition |
|---|---|
| B27 · P2 | Motrix stack, Google Sans and dark mode are installed (`apps/desktop/package.json:14-47`; `renderer/main.tsx:5-6`; `main/index.ts:42`). **R-regression:** reuse, no reinstall or second component convention |
| B28 · P2 | Custom caption controls, sidebar and root startup chrome exist (`components/window-chrome.tsx:35-113`; `App.tsx:398-475`). **R-regression:** preserve titlebar behavior and tab test selectors |
| B29 · P1 | Source/null/reason/coverage and staleness helpers already exist (`models.ts:45-120,162-182`; `components/ui/reason.tsx:5-32`; `views/Overview.tsx:224-243`). **R-regression:** improve presentation without replacing null with zero or changing freshness thresholds |
| B30 · P1 | Backend identity isolation already cancels/removes old queries and advances an epoch (`connection-scope.tsx:22-37`; `api.ts:20-28`). **R-regression:** a new shell/client must not reuse old backend data or credentials after forget/re-pin |
| B31 · P2 | Native-select event semantics, meter-reading pagination and event cursor reset are covered by tests (`ui/native-select.tsx:5-7`; `api.spec.tsx:42-138`; `views/DataQuality.spec.tsx:235-333`). **R-regression:** preserve replacement versus accumulating semantics |
| B32 · P2 | Reduced-motion CSS and reduced-transparency fallbacks exist (`styles/globals.css:169-173,217-220,231-257`; `styles/sidebar.css:86-100`). **R-regression:** keep them; chart JS motion is the separate B15 gap |
| B33 · P1 | The old “No UI kit” clause survives in the product plan (`SOLAR_MONITORING_PLAN.md:378`). **S5:** this replacement explicitly retains the approved stack override before the old redesign plan is removed |

### B4. Motrix adaptation map — patterns only

| Pattern | Local evidence | Solar adaptation / excluded material | Disposition |
|---|---|---|---|
| Opaque Windows shell | `captures/local/ui-audit/measure/motrix-source-values.json:2-20`; audit `:250-273` | Keep 200 px sidebar and inset panel, no blur/Mica; omit extra panel on Overview | **R-regression**, P2 |
| Header/nav/control geometry | `motrix-source-values.json:14-24`; audit `:299-317,337-362` | Same measured scale; reflow at text zoom/narrow layouts; controls meet A15 | **R-responsive**, P2 |
| Neutral materials/tile texture | Local Motrix `styles/globals.css:262-286,395-410`; current Solar `styles/globals.css:91-173` | Reuse opaque surface hierarchy, not wallpaper glass; accessibility token deviations are deliberate | **S1–S3** / **R-regression**, P2 |
| Typography | `motrix-source-values.json:22-36,98-102`; audit `:535-541` | Reuse scale, replace Motrix Inter with binding Google Sans; never copy SFNS | **R-regression**, P2 |
| Settings grid/dialog | audit `:369-380`; retained Solar `solar-spotchecks.json:69-98` | Existing six categories; desktop dialog, native full-screen detail; no Motrix settings features | **R-responsive**, P2 |
| Empty/error/status patterns | audit `:421-425,474-481`; Solar `ui/empty.tsx`, `ui/status-tone.ts:1-18` | Plain empty message, status text plus tone; add actual request/mutation states, not invented alerts | **R-states**, P2 |
| Chart/data displays | Local Motrix theme tokens in `styles/globals.css:276-286`; Solar `components/Chart.tsx:62-112` | Energy semantics replace download-speed semantics; fixed metric colors, direction patterns, visible units | **R-semantic**, P1 |
| Icons/artwork | audit `:535-541`; `Settings.tsx:55-92,1040-1046` | lucide plus already-attributed Fluent assets; original solar mark later; no Motrix logo/speed/settings art | **R-brand-package**, P1 |
| Motion | `motrix-source-values.json:94-96`; current `ui/dialog.tsx:31,60` | Reuse 100/200 ms interaction scale, not Motrix boot identity; no chart animation or decorative polling work | **R-chart-motion/R-startup**, P2 |
| Native window behavior | `main/index.ts:18-36`; retained `solar-native.json:2-28` | Hidden title bar/custom controls; preserve DWM handling, do not force `frame:false` or 0 outer-inner delta | **S5/R-native-proof**, P2 |

The local absolute Motrix path is evidence only, not a build dependency or license grant. Final implementation may copy only MIT-compatible patterns/code with attribution; it must not read another repository at runtime.

### B5. Test contracts — keep or change atomically

Tests below are existing evidence, not a claim that they were run during this plan. Keep behavior contracts; do not preserve class strings, incidental element hierarchy or decorative wording as if they were product requirements.

| Existing tests / evidence | Contract to keep | Required same-change update |
|---|---|---|
| `apps/desktop/src/renderer/models.spec.ts`; `models.ts:129-182,263-294` | Signed directions; idle/normal/strong thresholds (<100, <2000, otherwise strong); ageSeconds ≤30 freshness; NO_DATA; reconnection staleness; Decimal precision; inclusive local dates and DST boundaries | R-format changes only display assertions; add boundary coverage where rounding/threshold/negative-zero behavior is genuinely uncertain. Do not alter thresholds to fit an animation |
| `components/EnergyFlow.spec.tsx:22-41`; `views/Overview.spec.tsx:109-129` | No stale/disconnected animation; zero distinct from missing; missing reason remains available; directional values remain truthful | Existing `flow-live` assertions are the only automated animation-off guards. Keep them until the same approved presentation change replaces them with an observable synthetic-browser check of computed animation on stale/reconnecting/zero/unknown versus fresh flow; then delete class-string assertions rather than repinning utility names. Preserve numeric/reason assertions and change meaningful W/kW expectations with R-format |
| `views/Overview.spec.tsx` | NO_DATA, coverage, stale state and retained values; `data-stale` may remain a semantic state hook | S1 removes opacity only; do not remove stale state or change timers. Role/color/layout assertions must test observable state, not a utility-class snapshot |
| `views/History.spec.tsx`; `views/DateEndpoints.spec.tsx`; `models.spec.ts` | Date range and timezone inputs produce correct operation variables; tariff selection controls window breakdown; SOC extrema do not invent averages; missing data is not zero | Keep native `change`/select events. Current Chart mocks are valid unit isolation, but cannot prove canvas rendering/contrast/keyboard/motion; add runtime smoke evidence for those, not mock-echo tests |
| `views/UsageCost.spec.tsx` | Missing bill values/reasons; NEM lots; lower-bound and unavailable semantics; stale calculation state | Layout/currency formatting changes preserve numeric meaning and `isLowerBound`; do not delete null/zero tests or recompute amounts in UI tests |
| `views/DataQuality.spec.tsx:235-333` | More-events page replaces prior 100 rows; an earlier range, a start-only or end-only date move and a site-timezone change each restart at the first page (the tested cases). Clearing a date or entering an invalid range also resets the cursor today (the list unmounts through the `valid` guard and remounts with a null cursor; valid range changes remount through the key, `DataQuality.tsx:112-118,267`), but those two cases are implementation behavior these tests do not cover | Keep “More events” and selector roles unless the entire approved pagination contract is deliberately changed. Do not silently convert to accumulation/infinite scrolling |
| `views/SettingsReadings.spec.tsx`; `api.spec.tsx:42-138` | Reading pages accumulate; cached load-more cannot cancel refresh; pending next page is labelled; repeated load-more is ignored while fetching; errors retain prior rows | Preserve accessible pager labels/counts and refresh ownership; changed dialog layout must still mount the same data contract |
| `views/Settings.spec.tsx` | ADMIN sees mutation controls; VIEWER/UNKNOWN do not; settings categories and drafts behave consistently | R-mutations adds pending/dirty/error behavior without loosening roles. The approved changes (reset after confirmed success, drafts retained across destination changes and discarded at connection boundaries, startup Retry, per-mutation invalidation map, category-open query timing) change this file's draft, request-timing and invalidation expectations atomically with the production change; assert observable requests and form state, never the invalidation call's implementation. Do not test copied helper prose; S4 must not create a wording-only regression test |
| `renderer/connection.spec.tsx`; `connection-scope.tsx:22-37` | Forget/re-pin changes epoch, clears old cache, ignores late responses, preserves same-backend data on reconnect; old credentials never label a new backend ADMIN | Shell/web/native work must preserve equivalent observable isolation. Never “fix” these tests by accepting leaked old rows |
| `main/api-client.spec.ts`; `main/policy.spec.ts`; `main/connection-state.spec.ts`; `main/settings-store.spec.ts` | HTTPS/pinning, sender/operation policy, 64 KiB variables, token identity binding, retry/auth/TLS boundaries and role recovery | No changes for a UI redesign. A separately approved web/native delivery needs its own real trust model; do not weaken Electron tests |
| Existing browser harness `captures/local/ui-audit/harness/bootstrap.tsx:1-4`, `vite.config.ts:1-23` | Synthetic bridge installs before renderer import; Tailwind source discovery; no NAS or hardware required | Refresh fixtures from A18 for future design validation only. Do not assume retained measurements prove the current build |

Stable selectors/accessible names to preserve include `nav[aria-label=\"Dashboard tabs\"]`, Overview/History/Usage & Cost/Data Quality, the separate Settings action, `From reading`, `To reading`, native range/date selects, caption names, and the meter-reading pager names. If owner-approved copy genuinely changes a name, change the relevant interaction test in the same production step; remove assertions that merely pin decorative prose. Deterministic clocks and QueryClient seeding are not defects by themselves.

## Part C — Safe-fix specifications

**Implementation status (2026-10-30).** On the owner's instruction S1 and S2 were implemented in the working tree: S1 removed `data-stale:opacity-[.64]` from `panel-shell.tsx`; S2 added the `--focus` token (`#e5e5e5`, `.dark`) and the unlayered universal `:focus-visible` outline with the forced-colors `Highlight` override to `globals.css`. `npm run typecheck -w apps/desktop` exited 0 and `npm test -w apps/desktop` passed 16 files and 102 tests; a reviewer-openai read-only review found the two-file diff conformant to the S1/S2 text below. The rendered stale-contrast measurement (A4) and the real keyboard sweep in Electron (S2 acceptance) have **not** been run, so neither fix is accepted for AA or focus visibility yet. S3 and S4 were implemented afterwards in the same working tree on the owner's instruction: S3 added the `--control-edge` token (`#a1a1a1`) and the unlayered control-edge rule to `globals.css`; S4 replaced the billing-period hint in `Settings.tsx` with the inclusive-dates copy. Typecheck exited 0 and the 16 test files / 102 tests passed again, and a reviewer-openai read-only review found both diffs conformant, the S4 copy correct against the backend `[startDate, endDate+1 day)` contract, and the token pairs at 5.86–7.70:1 by calculation. Rendered acceptance for S3 (edge measurement in each listed view, forced-colors and invalid/disabled states) and for S4 (reading the rendered Billing helper) has **not** been run. Statements elsewhere that describe the 64% opacity, the missing focus outline, the 15%-white control boundary or the exclusive billing end date as current (B01, B02, B03, B11) are historical findings that S1–S4 address.

**Rendered verification (partial, 2026-10-30).** The synthetic Vite harness (admin, reconnecting, no-data and first-run fixtures, 1280×800, DPR 1) was exercised in two runtimes, with combined fixture coverage (the first-run fixture was run only in Electron): Google Chrome 156.0.8078.48, and Electron 44.7.2's own Chromium 152.0.7977.149 loaded from a throwaway main script that opened only the loopback harness URL (isolated profile; the app's main process, preload, CSP, settings store and any backend were not involved). Neither is the packaged app. The repeated S1 samples agreed between the two runtimes; items attributed to Electron below were recorded only there. **S1:** in reconnecting and no-data views the greyed content had opacity 1 and `grayscale(1)`, and Settings under RECONNECTING stayed ungreyed; sampled visible-DOM-text pixel estimates (the most frequent background pixel in the element's box against the pixel of greatest luminance difference) were at least 4.98:1 overall (the reconnect notice, which sits outside the greyed content) and at least 6.37:1 within the sampled greyed Overview content; the lowest samples elsewhere were 6.22 (the notice) then 6.45 in History, 6.22 (the notice) then 6.37 in Usage & Cost, and 5.78 (the date-field labels, inside the greyed content) in Data Quality. These samples do not establish complete text or graphics contrast: chart-canvas text, content below the fold and stale tooltips or popovers were not measured. **S2:** with real Tab presses and settled transitions, outlines resolved to 2px solid `#e5e5e5` with a 2px offset on the caption buttons, sidebar items, Settings tiles, tooltip triggers, form fields, buttons, dialog buttons, the Rules JSON `<summary>` (outline pixels observed in Electron) and the first-run URL field and button; sampled painted outlines measured 5.5–14.2:1 against adjacent surfaces. Nav and caption outlines animate for about 200 ms, so a measurement taken sooner shows an intermediate colour. In a focused window, in the recorded Tariffs-dialog sweep only, opening the dialog from the keyboard moved focus into it (onto the summary), and Tab stayed inside it and wrapped through the Base UI focus guard; other categories, close and focus restoration were not swept. **Open S2 finding:** the native date and month input picker Tab stop shows no visible focus indicator (no pixel change in either runtime; the host input does not match `:focus-visible` at that stop), so S2's `:focus-visible`-only rule does not reach that stop; S2 changed no native picker behavior, and a pre-S2 comparison was not performed. **Measurement caveats:** the earlier Chrome summary-paint and dialog-escape observations occurred during sessions with window-focus and key-delivery problems and were not reproduced in the focused Electron run; they are not confirmed defects and those earlier probes are inconclusive (a runtime change plus restored focus is not a single-variable comparison, so the cause is unexplained). Screenshots drop the 6 px custom scrollbar and shift scrolled dialog content horizontally, so left/right ring samples inside dialogs were discarded and only top/bottom and diff-based extents were used. **S3:** Data Quality and Settings inputs, selects, textareas and the first-run URL field rendered a `#a1a1a1` edge at 6.45–6.94:1 against their outside surface (5.78–6.23:1 against their own fill, measured in Electron; the first-run field was measured only there); the History and Usage & Cost toolbar fields have `border-0` and are not applicable. Still open for S3: separately recorded focused and invalid controls (no current callsite sets `aria-invalid`), disabled explanations, forced colors, text contrast and unchanged-geometry evidence. **S4:** the Billing dialog displayed the corrected inclusive-date guidance beside the JSON field. Not yet covered by any run: the packaged Windows app, 200% text and 914×672 reflow cases, scrolled-region focus stops, dialog focus restoration on close, forced colors, and the stale-frame chart-canvas measurement. These observations are partial evidence, not an acceptance pass for S1–S3 or a claim that every keyboard target has visible focus.

These source changes are **not executed by this documentation task**. S1–S4 are eligible for a later small implementation authorization without waiting for mockup approval. They preserve data, requests, role decisions and operations. S5 is the documentation cutover included in this handoff.

### S1. Restore stale readability without changing stale behavior

**Files:** `apps/desktop/src/renderer/components/panel-shell.tsx`; relevant existing `views/Overview.spec.tsx` / `components/EnergyFlow.spec.tsx` only if a presentation assertion fails.

**Exact change:** remove `data-stale:opacity-[.64]` from the panel-content class at current line 65. Retain `data-stale:grayscale`, the `data-stale` attribute, ShellContext/stale props, Settings exception, connection notice and every condition in `models.dashboardStaleness`. Do not raise opacity to an unmeasured intermediate value or increase text brightness in only the failing screenshot.

**Why safe:** no state calculation, value, animation condition or operation changes. This is the owner-selected resolution of a contrast conflict.

**Acceptance:** synthetic connected/stale/reconnecting/NO_DATA cases retain identical values/reasons and flow-off decisions; Settings remains ungreyed. Measure the rendered stale text and graphics under A4's acceptance gate (≥4.5:1 text, ≥3:1 meaningful graphics, every stale frame and status chip), not only S2/S12-equivalent samples. S1 itself changes only opacity, so it cannot guarantee that the remaining grayscale pairings pass; if measurement fails, report the failing pairs and treat A4's neutral-text rule as the remaining presentation work rather than claiming S1 resolved AA. Keep functional existing tests; delete an opacity/class-string assertion rather than repinning it. Run both desktop commands.

### S2. Give keyboard focus a visible high-contrast outline

**File:** `apps/desktop/src/renderer/styles/globals.css`.

**Exact change:** add a dedicated dark `--focus` token resolving to `#e5e5e5`. After the `@layer base` block, add an **unlayered** author rule `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`; unlayered CSS outranks Tailwind's layered `outline-none` utilities. A universal `:focus-visible` is chosen over an element-type list because an attribute list cannot enumerate every focus stop: the native `<summary>` “Rules JSON” disclosure (`Settings.tsx:477-483`) is focusable by default but is not a button, link, input or `[tabindex]`, and in Chromium versions that make scroll containers without focusable content keyboard-focusable, overflow regions such as the data-table wrapper (`data-table.tsx:10-16`), the Rules JSON `<pre>` (`Settings.tsx:481`), the Settings dialog body (`Settings.tsx:244`) and panel content (`panel-shell.tsx:61-67`) can be focus stops too. Whether the Chromium bundled with Electron 44.7.2 behaves that way is **not verified here**; only the Electron version was read locally. Existing low-contrast ring shadows may remain decorative, but cannot be the sole indicator. Do not make noninteractive text focusable or change tabindex/order/ARIA behavior (making a scroller focusable, if the sweep shows it is needed, is a separate accessibility change). Under `@media (forced-colors: active)`, use `outline-color: Highlight`. Verify computed styles and actual keyboard focus.

**Why safe:** only visual focus presentation changes. It covers caption/nav controls, Base UI buttons/dialog close, reason triggers, native selects, JSON editors, Settings tiles and native disclosures without editing their behavior. `SegmentedControl` (`ui/segmented-control.tsx`) has roving tabindex but no current view uses it, so it is not a current focus stop.

**Acceptance:** a real keyboard sweep in Electron's own Chromium (the synthetic browser harness shows only its own Chromium's behavior): Tab/Shift+Tab through first run, the local settings-read failure surface, shell, every settings category, open dialog (entry, focus restoration on close), reason tooltip, native “Rules JSON” disclosure (collapsed and expanded), overflowing data tables at 914×672 and 200% text, table actions and pager, plus arrow-key and programmatic focus moves. Record every focus stop and its computed outline. The outline must be visible, not clipped on the sidebar active state, panel, tile and dialog, and ≥3:1 against adjacent surfaces; verify primary light-filled buttons' outline against the outside dark surface. A stop without a visible outline, or one that is clipped or below 3:1, is a finding. Claim “every keyboard target” only for the recorded scope. Run both desktop commands; no class-string tests.

### S3. Separate interactive control boundaries from decorative borders

**File:** `apps/desktop/src/renderer/styles/globals.css`.

**Exact change:** add a dedicated dark `--control-edge` token resolving to `#a1a1a1` on approved dark control surfaces. After `@layer base`, add an **unlayered** rule `:is([data-slot="input"], [data-slot="native-select"], textarea):not([aria-invalid="true"]) { border-color: var(--control-edge); }` so the existing Tailwind border utility is overridden without overriding an invalid control's destructive border. The two current settings JSON editors are plain `textarea`, not data-slot elements; S2 supplies focus independently. Keep `--input` fill and `--border` decorative separators unchanged. Do not globally brighten cards/dividers or change sizing/validation.

**Why safe:** visual identification changes only; all native control semantics and fills stay the same.

**Acceptance:** measure normal/focused/invalid input/select/textarea edges in History, Usage & Cost, Data Quality, first run and Tariffs dialog; ≥3:1 where the edge identifies the control. Confirm clear text contrast, forced-colors visibility and no geometry change. Disabled controls need an explanation but are not misrepresented as active controls. The History and Usage & Cost toolbar fields use `border-0` (`pillField`), so S3's color rule gives them no visible edge; record them as not applicable to the edge measurement (they sit in the decorative toolbar pill) rather than reporting a ratio, and treat any wish to draw an edge there as a separate, separately authorized design change. Run both desktop commands.

### S4. Correct billing-period date guidance

**File:** `apps/desktop/src/renderer/views/Settings.tsx`, billing-period action hint at current line 123.

**Exact replacement text:** “Local dates mark the start and end inclusively. Optional bill must be a JSON string accepted by the backend; do not paste an unredacted bill.”

Do not change the initial JSON, input names, `UpsertBillingPeriod` variables, validation or backend date handling. Do not alter tariff-version effective-date semantics under cover of this billing hint.

**Acceptance:** read the rendered Billing editor helper beside its existing local-date JSON fields; compare the statement with the backend/product `[startDate, endDate+1 day)` contract. Existing date-endpoint and Settings tests remain passing. Do not add a wording-only test.

### S5. Preserve authority and honest verification during supersession

**Files:** `SOLAR_UI_REDESIGN_PLAN.md`; `docs/design/redesign/BRIEF.md`; `docs/design/redesign/MOCKUP-PROMPTS.md`; `docs/ui-audit/desktop-ui-audit.md`; delete only `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md` after the replacement is accepted.

**Exact work:** perform Approach steps 1–3. Carry the approved stack override, Google Sans/dark/opaque/no-blur/license constraints, unchanged data semantics and approved presentation exceptions into the replacement. Qualify retained capture ages. Preserve the audit's 1–12 step legend, mark its Step 11D note historical, and refer future checks to this plan. Replace the old impossible zero outer-inner acceptance in the active implementation contract with visible-window/chrome checks and retain the measured 16×8 difference as historical evidence, not a guaranteed cross-machine target.

**Acceptance:** standalone Part A and Part E are byte-for-byte extractions; all referenced local image/source paths exist; every current gap has severity/evidence/disposition; no remaining live instruction depends on the deleted old plan. Historical mentions may remain as historical context. Preserve the product plan and raw audit/capture records. No implementation, install, commit, push, NAS or hardware access.

## Part D — Brand prototype specifications

The owner approved logo and startup-animation scope. This part specifies later design deliverables; no SVG, icon bundle, HTML prototype or production asset is generated by the documentation-only task. The design tool never receives Part D: batch 12 (E12) restates its design-deliverable subset, A14 carries the R-brand-package gate that D3 details, and the three must be kept consistent.

### D1. Original mark and wordmark

Produce an original solar/measurement mark that reads at the A14 sizes, paired with “Solar” in Google Sans. Deliver mark-only, horizontal wordmark, monochrome light/dark and one solar-accent composition. Provide editable vector source plus clean SVG exports without embedded fonts, scripts, external resources or proprietary image fragments. Preserve the full product name for packaging and accessibility.

Supply small-size previews at 16/24/32/52 px and Windows packaging previews at 16/32/48/256 px. These are A14's existing scale/platform export checks. Show on the actual shell/card backgrounds and in monochrome/grayscale. Report any shape that looks like a connection/fault status indicator. Do not alter the energy semantic palette to accommodate the logo.

A later asset handoff may use `apps/desktop/src/renderer/assets/brand/` for approved renderer SVGs and a builder asset directory for platform exports; neither path is created now. Do not replace the current lucide Sun until the owner chooses a final mark.

### D2. Non-blocking startup prototype

Build the later review prototype (after the owner chooses a mark; batch 12 itself returns design frames and specifications only) as local HTML/CSS plus the approved SVG, not a video or animation framework. It must demonstrate static/reduced-motion, allowed cold-start opacity appearance, immediate setup/error takeover, warm start and reconnect without replay. Maximum decorative appearance is the existing 200 ms token; no minimum dwell. The prototype has no credentials, backend requests, telemetry, installer hooks or real account data.

If a pre-React surface is later implemented, its minimal styles and `prefers-reduced-motion` rule must be available before renderer JS loads. CSP currently allows inline styles but not inline scripts (`main/security.ts:7`); do not weaken CSP for a splash. Prefer SVG paths rather than text that waits for a font. Once the real app is usable, the startup mark is gone and no overlay remains in the accessibility tree.

Pass criteria: connection/setup/error controls appear without waiting for the brand animation; close/minimize remain usable; reduced motion is completely static; no fake progress; no extra network or polling work; font failure cannot strand the user behind the mark. Verify on the actual desktop surface after implementation, not only in the standalone prototype.

### D3. Packaging gate

The current `electron-builder.yml` has no icon and uses `signAndEditExecutable:false` (`:1-28`). Production exe/taskbar/installer icon work requires a separate packaging decision and verified resource-editing/ASAR-integrity/signing behavior. Do not flip signing/resource flags as a “visual fix”, add binaries now or claim that configuring `win.icon` alone embeds the icon.

Native iOS/Android icon catalogues and launch-screen assets depend on their chosen delivery toolchain. Provide compositions and safe-area intent in mockups now; validate exact production exports against the actual toolchain later. No unapproved app-store identity, domain or bundle identifier is invented.

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

## Critical files & anchors

| Area | Files and why they matter |
|---|---|
| Product authority | `SOLAR_MONITORING_PLAN.md:11-16,377-435,511-515,613-791,897-937`; `TODO.md:33-37,55-59`; `docs/field-mapping.md:3-11,55-62`; `docs/operations.md:262-267,458-466` |
| Historical visual evidence | `docs/ui-audit/desktop-ui-audit.md:9-14,169-593`; `docs/ui-audit/img/ref-*.webp`; `docs/ui-audit/img/redesign/`; `captures/local/ui-audit/measure/motrix-source-values.json`; `measure/redesign/solar-contrast.json`, `solar-spotchecks.json`, `solar-native.json` |
| Desktop window/security | `apps/desktop/src/main/index.ts:18-42`; `main/security.ts:6-61`; `api-client.ts`; `ipc.ts`; `policy.ts`; `connection-state.ts`; `settings-store.ts`; `apps/desktop/electron-builder.yml:1-28` |
| Root/query/identity state | `apps/desktop/src/renderer/App.tsx:46-475`; `main.tsx:14-28`; `api.ts:12-102`; `connection-scope.tsx:22-37`; `models.ts:11-43,86-182,242-295,318-376` |
| Shell and controls | `renderer/components/panel-shell.tsx:19-71`; `window-chrome.tsx:35-113`; `Display.tsx`; `components/ui/{button,input,native-select,reason,tooltip,dialog,data-table,empty,status-tone}.tsx` (status-tone is `.ts`) |
| Visual tokens | `renderer/styles/globals.css:35-173,175-220,231-279`; `renderer/styles/sidebar.css:2-100` |
| Data views | `renderer/views/Overview.tsx:30-255`; `History.tsx:56-366`; `UsageCost.tsx:108-447`; `DataQuality.tsx:31-558`; `Settings.tsx:101-154,262-413,1011-1079`; `components/Chart.tsx:62-154`; `EnergyFlow.tsx:12-78` |
| Contract availability | `packages/contracts/src/operations/dashboard.graphql:1-541`; `packages/contracts/src/index.ts:32-60`; `packages/contracts/src/bridge.ts:4-58`; `apps/backend/schema.gql:115-129,184-190,323-334,421-439`; generated `graphql.ts` is generated output, never hand-edited |
| Local verification surface | `captures/local/ui-audit/harness/bootstrap.tsx:1-4`; `bridge.ts`; `fixtures.ts`; `vite.config.ts:1-23`; `apps/desktop/package.json:7-12`; tests enumerated in B5 |

Paths abbreviated to `renderer/`, `views/`, `components/`, `styles/` or bare renderer filenames in this document resolve under `apps/desktop/src/renderer/` (`views/` and `components/` are subfolders of it, so a bare `Settings.tsx` means `renderer/views/Settings.tsx` and a bare `Chart.tsx` means `renderer/components/Chart.tsx`); `main/` and the bare main-process files `api-client.ts`, `ipc.ts`, `policy.ts`, `connection-state.ts` and `settings-store.ts` resolve under `apps/desktop/src/main/`. A bare `dashboard.graphql` is `packages/contracts/src/operations/dashboard.graphql`; a bare `package.json` is `apps/desktop/package.json`; the contract bridge is always written with its `packages/contracts/src/` prefix; the harness files `bootstrap.tsx`, `bridge.ts`, `fixtures.ts` and `vite.config.ts` are under `captures/local/ui-audit/harness/`. `measure/` abbreviates `captures/local/ui-audit/measure/` and `measure/redesign/` its `redesign` subfolder. Absolute Motrix references are local evidence only. Implementers must use language-server references before changing exported formatting/chart/date symbols and migrate all discovered callsites in the same slice.

## Verification

### Documentation-only handoff

1. Check headings: Context, Approach, Part A A0–A18 exactly once, Part B, Part C, approved Part D, Part E, Critical files & anchors, Verification, Assumptions & contingencies. The Stash file is a structural template only.
2. Compare BRIEF.md byte-for-byte with the Part A slice of the root plan and MOCKUP-PROMPTS.md with the Part E slice. Regenerate extracts after any root correction. Each of the twelve batches must contain all six preamble requirements, a manifest instruction, an explicit stop, and at least one compact frame. Closed-world audit: for each batch, read only Part A, that batch's block and its declared attachments, and confirm that every label, section, fixture, frame convention, manifest column and prerequisite it cites is defined there; no block may rely on Part B, C or D, the Part E preamble, the Approach or a safe-fix number. Byte equality alone does not prove self-containment.
3. Check the current/planned screen inventory against A12 and all existing operations: Overview, History, totals/bill detail, Data Quality including daily inverter-counter comparison/reconciliation/runs, six Settings categories, the local settings-read failure and first run/auth/TLS/reconnect states, the explicitly approval-gated desktop recalculation proposal, cloud stopgap and new client prerequisites. Every list/page has all eight request states or an explicit truthful N/A, assigned to the real request boundary (for example, History's power and SOC charts share one PowerSeries request); every mutation has dirty/validation/pending/failure; and every state, Retry or reset behavior not present in today's renderer is labelled presentation backlog (A0), not current.
4. Recalculate A4's exact solid-color pairs using WCAG relative luminance, and the grayscale-filtered text pairs with the stated luma weights. Check all numerical design targets have a local measurement/current source/standard/owner-frame origin. Distinguish newly calculated token contrast (including filtered text) from measured screenshots and future acceptance targets; the filtered figures are predictions, and only the rendered-contrast gate in A4/S1 establishes compliance.
5. Recalculate A18's day/gap/month energy balances, battery SOC change, meter deltas/ratios/verdicts, NEM expiry/use, **aggregated** ENERGY line rounding and MYR 138.29 total. Recompute coverage against its own window (22/24 for the day; 670/672 and 648/672 for the 672 h reading window), the reconciliation thresholds (coverage under 0.99; tolerance max(2% of utility, 2 × resolution)) and every variant verdict; confirm which variants share missing intervals and that no variant pairs changed energy with the baseline bill; and confirm event-variant compatibility with the baseline. Ensure today-so-far is not a complete future day, month totals do not imply fabricated daily points, and fixture states do not contradict baseline source/coverage.
6. Check all cited local paths and line ranges against source; no finding may cite a nonexistent feature or an obsolete capture as present proof. Verify no real endpoint, credential, account, reading or bill was copied into A18.
7. Use independent reviewers for separate brief/data/scope and evidence/safe-fix/test-contract checks (the reviewer-claude and reviewer-openai checkpoints actually completed are recorded below). Resolve confirmed findings, rerun document checks, regenerate extracts. A review result is evidence, not automatic acceptance; inspect the cited issue.
8. If the installed dependencies/toolchain are available, run exactly `npm run typecheck -w apps/desktop` and `npm test -w apps/desktop` after the documentation cutover. No install, app launch, hardware, NAS, cloud or network access. If a gate cannot run, record the concrete reason and do not invent a pass.
9. Remove only the superseded redesign plan after the replacement/extracts are accepted, and update the audit's live plan reference as S5 specifies. Preserve raw audit history and current source. No commits or pushes.

### Later implementation acceptance — requires separate authorization

- Before editing an exported formatter/date/chart symbol, resolve references with the available language server. Before new helpers/components, reuse existing conventions. Do not add parallel formatters, query caches, a second component library or a second transport path.
- At each implementation step, run the two desktop commands. For a bug fix, retain a regression test only when it defends a real uncertain boundary; otherwise use a throwaway smoke scenario and remove the throwaway after evidence is recorded. Never add tests for source text, class names or mock forwarding.
- Use the existing synthetic harness only. Its bootstrap installs a fake bridge before renderer import; the Vite harness runs on local port 5199 (`vite.config.ts:22`). Launch via the supervised process tool only after implementation authorization. Do not open the real configured backend, NAS, cloud account or hardware. The app's autonomous collection claim is not permission to connect.
- Capture actual rendered 1280×800, 1600×1000 and 914×672 Electron/web surfaces, plus 320 px reflow and 200% text. Record viewport, device scale, font-loaded state, screenshot identity and matching DOM/measurement output. Do not compare a screenshot from one build with geometry from another.
- Exercise all A11/A12 states using synthetic responses, including null versus zero, current-day 50% coverage, last-known data, independent region failures, role changes, draft/error/pending states and epoch reset. Confirm the unchanged 10 s/30 s cadence by observed requests; do not add timers for mockup convenience. Also observe that a closed Settings category issues no request, that each Settings mutation invalidates exactly its A16 map, that a confirmed success resets only its own form, and that retained drafts are gone after every connection boundary and restart.
- Keyboard-test navigation, captions, native selects, dialogs, reason help, chart inspection/table, reading/event paging and form validation. Verify focus restoration, no clipping/obscuring, speech labels and live-region restraint. Run color-blind/grayscale, reduced-motion, reduced-transparency, increased-contrast and forced-color checks on the actual surface, not just tokens.
- For charts, verify units/ranges/site timezone, visible six-way semantics, negative sign/direction, null gaps, extrema-only SOC and no canvas motion. Resize and change ranges repeatedly; observe that instance/observer/listener counts do not grow and inspection remains coherent.
- For Windows packaging, exercise minimize, maximize, restore, close, drag and resize in the actual packaged app. Verify no OS menu/title band plus usable custom captions. Accept normal DWM resize borders; do not require zero outer-inner delta. Obtain a real OS-level capture before claiming verified native corners/borders. The retained CDP capture is insufficient.
- For brand/startup, simulate slow/failed font load, immediate connection, first run, AUTH_FAILED/TLS_MISMATCH, reduced motion and warm/native resume. Prove there is no added startup wait, fake progress, hidden error or extra backend request.
- Web/native implementation cannot pass solely by reproducing the Electron layout. Its separately approved trust/credential/lifecycle contract must be implemented and exercised before calling the client ready.

### Planning checkpoint record

The first reviewer-claude checkpoint identified stale opacity/contrast conflict, weak focus/control boundaries, W/kW contract changes, Electron-only security, native capture limits, missing icon pipeline, startup font gating and the need to preserve the UI-kit override. The owner then approved presentation/accessibility exceptions and grayscale without dimming; the replacement records other-client security and packaging as prerequisites. The review's suggestion that all source metadata was absent was checked against schema: CollectorStatus does expose `acquisitionSource`; only the planned cloud payload/client integration is missing. No checkpoint ran the app or tests.

The final two reviewer-claude checks separately inspected the brief/data and the gap/safe-fix/test contract. Confirmed corrections include API-shaped `observedAt`, integer SOC and mappingVersion, the serialized validation map, the omitted daily comparison, a passing fictional METER_NET candidate's `MAPPING_PROVISIONAL` rather than `ACCOUNTING_UNRECONCILED` live status, the unreachable-current `VENDOR_DATA_ONLY` bill, Tailwind v4 unlayered focus/control-edge rules, historical audit legend retention and accurate source-line citations. A pure local `computeBill` invocation returned one ENERGY line (120.000 kWh, MYR 46.29), total MYR 138.29, ESTIMATED with TARIFF_NOT_BILL_VERIFIED and MAPPING_PROVISIONAL under the corrected context; the fictional curve's twelve intervals were independently summed. Neither reviewer ran the app or tests.

**Revision checkpoints (reviewer-openai).** A later revision of this plan used reviewer-openai, never reviewer-claude, as the independent verifier; the revising agent kept ownership of every decision, and no checkpoint ran the app, tests, formatters or builds. *Pre-edit:* two concurrent read-only reviews of the proposed corrections, one on source/contracts (API availability, draft lifecycle, query timing, dataset arithmetic, reconciliation semantics, event compatibility, citations) and one on design/handoff (prompt dependencies, extract boundaries, startup and focus coverage, scope, acceptance criteria). Confirmed and integrated: the LiveStatus field inventory and the absence of voltage/current/frequency/power-factor; the draft lifecycle (nothing clears on dialog close, category change or successful submit; destination change, shell-replacing states and restart discard drafts); eager versus conditional Settings queries and unfiltered mutation invalidation; History's single PowerSeries request for power and SOC; point-record shape of ledger counter events; the reconciliation arithmetic and thresholds; the missing prompt inputs (manifest columns, frame convention, flow tiers, R-labels, Part D subset, batch-1 attachment, token-stored indicator, delete-confirmation sequence, rules-JSON and returned-effects placeholders). Corrections the reviewers made to the proposals, accepted after checking source or recomputation: coverage must render under the existing trim rule (99.7%, not 99.70%); the counter candidate stays at 100% only under explicit fixture assumptions; JSON editors keep per-operation messages while typed actions share one; retained status-tone pairs recompute to 7.71/7.80/11.81/6.99:1 after grayscale (the proposal had used non-retained shades); a universal `:focus-visible` is cleaner than an enumerated selector list; the Settings Connection fields are not all “—” (Token stored reads “No” while unknown); no bill may be paired with the gap-month totals. Not adopted as proposed: none were rejected outright. *Post-edit:* two concurrent adversarial reviews of the revised plan, one for source truth, arithmetic and citations and one for handoff closure, consistency, acceptance criteria and scope, followed by focused re-reviews of the corrections. Confirmed and corrected: E9 wrongly attributed recalculation/retention effects to the billing-period mutation (only `CreateAccountingPolicy` returns them); an undefined “S work” label inside Part A; ambiguity about batch 12's output level (frames and specifications only) and Part D2's timing; the DataQuality.spec.tsx coverage claim (the tests cover an earlier range, start-only, end-only and timezone changes, not clearing or invalid ranges) and its mechanism (valid guard plus key); the shared Settings message also showing on the landing; ambiguous bare citations (`totals.service.ts`, `security.ts`, `dashboard.graphql`, harness and main-process files), now mapped explicitly. The source/arithmetic reviewer independently re-derived the A18 day, gap, gap-month, today and month totals, residuals, SOC steps, reconciliation ratios/verdicts, coverage fractions and the MYR 138.29 bill, and the A4 contrast and grayscale figures, without disagreement with the revising agent's own local calculations (the handoff reviewer did not recompute these). Unverified by either reviewer: the Chromium version bundled with Electron 44.7.2 and its keyboard-focusable-scroller behavior, all rendered contrast and focus behavior, historical approvals and prior reviewer execution, and extract byte equality (the extract files do not exist and were not created).

## Assumptions & contingencies

1. **Supersession is explicit.** The owner chose replacement and later removal of the old redesign plan. Keep its useful authority in this document before deletion. The product plan, historical audit and evidence images are not purged.
2. **No hidden expansion.** Web plus native iOS/Android and brand/startup specifications are owner-approved design scope. No implementation framework, auth/pairing mechanism, deployment, public endpoint, installer identity or packaging flag has been approved by that choice.
3. **Current compact minimum stays 914×672.** 1280×800 and 1600×1000 are design/verification frames, not permission to change the BrowserWindow default/minimum. Reflow/scroll before requesting a minimum-size change.
4. **Presentation exceptions are bounded.** W/kW precision, locale-consistent numeric formatting, clearer copy, Retry/dirty/pending states, chart/keyboard accessibility and grayscale without dimming are approved design changes, as are the five Settings/startup behavior changes recorded in Context (reset after success, draft retention across destinations, startup Retry, narrowed invalidation, category-open query timing). Accounting, pricing, raw values, polling, stale thresholds, roles and source provenance are not.
5. **No independent sell-back feature.** The fixed fictional export equivalent is NEM kWh credit against eligible import components. If a future owner asks for cash export prices, that is a new product/schema/pricing decision, not a label change.
6. **Source confidence stays honest.** Modbus remains the target; cloud is lower-confidence stopgap and never feeds independent accounting. Physical mapping/netting and tariff bill verification remain operational gates. Synthetic results cannot satisfy them.
7. **Local evidence may lag current source.** Refresh captures only in a separately authorized synthetic implementation verification. If the toolchain cannot provide actual Windows/native visual proof, report the exact missing capability; do not substitute a browser capture and claim OS proof.
8. **Standards are acceptance sources, not online research claims.** WCAG 2.2 AA, Core Web Vitals and native touch-target guidance are identified standards. No external content was fetched during planning. Before a real native packaging release, check the actual selected platform/toolchain requirements under separate authorization.
9. **Missing data is not an invitation to fabricate.** A18 context-only metadata and cloud placeholders stay annotated. Unsupported detailed week/year points, extra meter pages or phase/string values use not-supplied/structural states, not invented “realistic” readings. Any added canonical fixture must first be approved and added to A18, then reused everywhere.
10. **Review cannot silently relax scope.** If a mockup tool cannot produce all listed states or frame sizes in a batch, it must report the missing frames in the manifest and stop for owner direction. Do not call a sampled subset complete or invent new tokens to work around a difficult layout.
