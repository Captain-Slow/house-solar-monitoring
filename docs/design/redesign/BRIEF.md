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

