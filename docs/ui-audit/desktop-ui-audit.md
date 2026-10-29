# Desktop UI audit: House Solar Monitoring vs Motrix liquid-glass

## 1. Summary

The solar desktop UI is a different design family from Motrix on every shell-level dimension (chrome, navigation, materials, palette, typeface). This revision scores every pair against the user's nine Windows 11 Motrix screenshots (`img/ref-01` … `img/ref-09`). On Windows, Motrix has no blur glass: the look is a teal gradient shell, a 65% black panel, opaque neutral cards and dialogs, and small Inter type on a 4px grid.

| Score | 0–3 | 0–100 |
|---|---|---|
| Image-backed pairs, this revision (all nine, P0–P8) | 0.77 | 25.7 |
| All pairs, this revision | 0.77 | 25.7 |
| Image-backed pairs, first audit (P0–P3, P6, P8 against macOS fallbacks) | 0.68 | 22.7 |
| All pairs, first audit (adds source-scored P4, P5, P7) | 0.79 | 26.2 |

No pair moved because of a different reading of the same evidence. The image-backed mean rose because P4, P5 and P7 became image-backed and joined the mean. P7 fell from 1.00 to 0.86 once it was scored on materials (D3). The six pairs scored in both audits keep their scores (0.68 for that subset in both).

Top S1 findings:
- **F-001** Native Windows frame plus an Electron menu bar costs 65px of vertical chrome; none of the nine Motrix captures has an OS title bar or menu.
- **F-003** Top header with tab buttons instead of a 200px gradient sidebar beside an inset panel.
- **F-006** No gradient shell and no tinted panel layer: flat navy fills (Motrix on Windows has no blur either).
- **F-007** Navy palette (`#111b29` / `#1b2c40`) instead of neutral greys on a teal-grey shell.
- **F-009** System font (`system-ui, "Segoe UI"`) instead of the bundled Google Sans (Motrix itself renders Inter).
- **F-013** Settings is a long page of cards and raw JSON textareas instead of a category grid with dialogs.
- **F-030** (new) Motrix's Dashboard has no panel: 160px tiles sit directly on the shell gradient.

New findings in this revision: F-028 to F-033 (Section 7).

## 2. Method & environment

- **Reference:** the user's nine Windows 11 dark screenshots, `C:/Users/User/Downloads/motrix screenshots/` (captured 2026-10-08 14:30:49–14:32:10). They were copied to `captures/local/ui-audit/reference/`, first as `ref-01..ref-09` in capture order. Their content matched the planned inventory in exact reverse order, so they were renamed to the planned names (`reference/MAPPING.md` holds the table and sha256 prefixes). Lossless WebP copies, pixel-identical by decode comparison, are in `img/ref-*.webp`.

  | File | Capture | Image px | Screen |
  |---|---|---|---|
  | `ref-01-settings-advanced` | 14:32:10 | 917×677 | Settings › Advanced dialog |
  | `ref-02-settings-integration` | 14:31:59 | 914×670 | Settings › Integration dialog |
  | `ref-03-settings-network` | 14:31:47 | 922×675 | Settings › Network dialog |
  | `ref-04-settings-network-alt` | 14:31:40 | 939×712 | Same dialog, larger capture region (same 914px window) |
  | `ref-05-settings-grid` | 14:31:25 | 917×671 | Settings category grid (8 categories) |
  | `ref-06-plugins` | 14:31:16 | 911×678 | Plugins |
  | `ref-07-trackers` | 14:31:07 | 918×678 | Trackers |
  | `ref-08-downloads-empty` | 14:30:58 | 921×677 | Downloads, empty state |
  | `ref-09-dashboard` | 14:30:49 | 941×712 | Dashboard |

- **Scale:** DPR 1. The PNGs carry 96 dpi (pHYs 3779 px/m), and the client area is 914px wide between the 1px window borders in `ref-07` and `ref-03`. Each capture's client origin (for crops that cut the border) is in `motrix-ref-pixels.json` → `references.*.clientOriginInImage`; all coordinates below are client CSS px.
- **Pixel measurement** (`captures/local/ui-audit/measure/motrix-ref-pixels.json`, replacing the earlier `absent` record):
  - Colours: the original PNGs decoded without colour management; 8-bit sRGB hex. Alpha values are derived as (measured − underlay) / (overlay − underlay) with the sample and underlay coordinates recorded.
  - Font sizes: the ink width of a whole string divided by the ink width of the same string in Inter Variable at the source weight and letter-spacing, measured in a scratch Chromium tab. Inter came from `D:/Github/Motrix/node_modules` and was used only for measurement, never copied. 55 of 61 strings land within 0.3px of a whole size.
  - Radii: arc fits to corner coverage, or a 45° border-peak position for bordered shapes (about ±1.7px).
  - The plan-prescribed samples on `ref-05` and `ref-09` are under `planSamples`. On `ref-09`, `panelEdge` falls outside the window.
- **Source cross-check:** `measure/motrix-source-vs-pixel.json` compares every row of `motrix-source-values.json` with the pixels (Section 5.1). Pixels win for what the user sees on Windows.
- **Supplementary evidence only:** the three macOS dark screenshots from the Motrix repo (`img/motrix-dashboard-dark.webp`, `motrix-settings-en-dark.webp`, `motrix-downloads-en-dark.webp`). No score depends on them.
- **Motrix was never launched.** Starting any Motrix build deletes the user's native-messaging registry keys (`D:/Github/Motrix/src/main/index.ts` L2915–2922 → `src/main/bridge/native-messaging-installer.ts` L395–428). `reg query HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\app.motrix.bridge` returned `C:\Users\User\AppData\Roaming\Motrix\bridge\manifests\chrome.json` before and after this revision. The user's `%APPDATA%/Motrix/settings.json` was read, not changed: `theme` `system`, `sidebarColor` `cyan`, `liquidGlassEffect` `false` (L37, L38, L65).
- **Motrix source:** `D:/Github/Motrix` at `ad3ea65b`, package version 2.0.0-beta.46.
- **Solar:** commit `f4b8dff`; harness at `http://127.0.0.1:5199` (`captures/local/ui-audit/harness`), real renderer code, synthetic bridge and data. Packaged exe `apps/desktop/release/win-unpacked/House Solar Monitoring.exe`, last written 2026-10-18 07:44. The solar captures and DOM measurements (`measure/solar-S*.json`) are unchanged from the first audit.
- **Viewport:** solar 914×672, DPR 1 (full-page shots 1280×850). Dark only; light theme is not scored (F-027).
- **Native chrome (S13):** launched with an isolated `--user-data-dir` (first-run screen shown, so no user backend was contacted); the CDP listener owner was verified as the launched PID. The OS-level window capture failed (`MainWindowHandle` 0), so P0 uses a CDP renderer screenshot (`solar-S13-native-renderer.webp`) plus measured geometry: outer 1280×850, inner 1264×785, **65px vertical and 16px horizontal frame** (`measure/solar-native.json`).
- **Not measurable from stills:** hover, pressed and focus states, tooltips, motion, the caption buttons' hit area and the 40px drag strip (both transparent), and the stale/reconnect banner (not on screen in any capture). Solar's hover/focus on `main button` and `main tr` in S1 are also `null` (`solar-interactions.json`). D9 and the focus part of D11 therefore compare DOM records with Motrix source, as in the first audit.
- **Google Sans width check:** at Motrix's sizes and weights, Google Sans 5.3.2 sets 0–6% narrower than Inter for the 10 strings measured (mean 0.965, `measure/font-width-ratio.json`). Those strings wrap no earlier than in Motrix; the superseded plan's Step 11D set a target of checking every view for overflow at 914px (a historical target); future compact-overflow verification belongs to `SOLAR_UI_REDESIGN_PLAN.md` (A6, A15 and its Verification section).

## 3. Reference inventory and pairs

| Pair | Solar | Reference (Windows) | Type |
|---|---|---|---|
| P0 | S13 | `ref-09` window chrome, confirmed on all nine | image-backed |
| P1 | S1 | `ref-09` | image-backed |
| P2 | S2 | `ref-08` status chips plus `ref-09` | image-backed |
| P3 | S3 | `ref-09` sparklines and activity tile | image-backed |
| P4 | S4 | `ref-09` TRANSFER tile plus `ref-06` cards | image-backed (was source-scored) |
| P5 | S5/S6 | `ref-07` | image-backed (was source-scored) |
| P6 | S7/S8 | `ref-05` plus `ref-03`, `ref-01` | image-backed |
| P7 | S9–S11 | `ref-03`, `ref-01` dialog surface; onboarding layout from `src/renderer/components/onboarding/onboarding-surface.tsx` | image-backed for the surface; layout source-only (no screenshot of the onboarding window exists) |
| P8 | S12 | `ref-08` | image-backed |

## 4. Gallery

| Solar | Reference |
|---|---|
| [S13 native renderer](img/solar-S13-native-renderer.webp) | [ref-09 dashboard](img/ref-09-dashboard.webp) (chrome: caption glyphs, no OS bar) |
| [S1 Overview](img/solar-S1.webp) | [ref-09 dashboard](img/ref-09-dashboard.webp) |
| [S2 reconnecting](img/solar-S2.webp) | [ref-08 downloads](img/ref-08-downloads-empty.webp), [ref-09](img/ref-09-dashboard.webp) |
| [S3 History](img/solar-S3.webp) | [ref-09 dashboard](img/ref-09-dashboard.webp) |
| [S4 Usage & Cost](img/solar-S4.webp) | [ref-09 TRANSFER](img/ref-09-dashboard.webp), [ref-06 plugins](img/ref-06-plugins.webp) |
| [S5 Data Quality](img/solar-S5.webp), [S6](img/solar-S6.webp) | [ref-07 trackers](img/ref-07-trackers.webp) |
| [S7 Settings, holidays/rates](img/solar-S7.webp), [S8 Create tariff](img/solar-S8.webp), [full Settings](img/solar-full-settings.webp) | [ref-05 grid](img/ref-05-settings-grid.webp), [ref-03 network](img/ref-03-settings-network.webp), [ref-01 advanced](img/ref-01-settings-advanced.webp) |
| [S9 first run](img/solar-S9.webp), [S10 auth](img/solar-S10.webp), [S11 TLS](img/solar-S11.webp) | [ref-03 network](img/ref-03-settings-network.webp), [ref-01 advanced](img/ref-01-settings-advanced.webp) |
| [S12 no data](img/solar-S12.webp) | [ref-08 downloads empty](img/ref-08-downloads-empty.webp) |

Other references: [ref-02 integration](img/ref-02-settings-integration.webp), [ref-04 network, alternate crop](img/ref-04-settings-network-alt.webp). Full-page solar: [overview](img/solar-full-overview.webp), [history](img/solar-full-history.webp), [data quality](img/solar-full-data-quality.webp), [settings](img/solar-full-settings.webp). Supplementary macOS: [dashboard](img/motrix-dashboard-dark.webp), [downloads](img/motrix-downloads-en-dark.webp), [settings](img/motrix-settings-en-dark.webp). The native OS window capture `solar-S13-native.png` was not produced (see Method).

## 5. Token comparison

Motrix values are Windows pixel samples (`motrix-ref-pixels.json`, key in brackets) unless marked "source". Solar values come from `measure/solar-S*.json`. "Contrast" is the measured WCAG ratio of solar text on its composited background; null where a group effect makes it uncomputable.

| Role | Property | Motrix reference (Windows pixels) | Solar measured (screen) | Within tolerance | Contrast |
|---|---|---|---|---|---|
| windowBg | background | covered everywhere; the sidebar gradient matches composition over `#09090b` to 0.5 levels [`window.backdrop`] | `rgb(17,27,41)` `#111b29` (S1) | no | 14.72 |
| navContainer | form | 200px sidebar, gradient `#2c4447` (y=1) → `#1c2b2d` (y=671), opaque window, no blur (`ref-07`) [`sidebar`] | 914×72 header, flat `rgb(27,42,60)` (S1) | no | 12.37 |
| navActive | bg / radius / size | white 14% (`#475b5d` on `#294043`), r 8.1–8.4, 180×38 at x=10, pitch 42 (`ref-07`) [`sidebar.navItem`] | `rgb(23,101,123)`, 7px, 41px high, 1px border `rgb(112,210,214)` (S1) | no | 6.19 |
| navInactive | bg / text | transparent; label 14px/400 `#fafafa`; hover (source) 6% white | `rgb(40,65,92)`, 7px, 1px border `rgb(104,123,148)` (S1) | no | 9.85 |
| panel | rect / radius / bg | x 200–905, y 8–663 (margins 0/8/8/8), r 13.7–14.1, `#0a0a0a` at 0.61–0.65 over the gradient (`#161e1f` at y=30, `#111617` at y=600); none on Dashboard (`ref-07`, `ref-09`) [`panel`] | full-width `main`, 0 radius, transparent (S1) | no | 14.72 |
| pageTitle | size / weight / position | 24px/600, −0.025em, `#fafafa`, x = panel + 24, cap top y=48 (`text.title.*`) | 25.5px/38.25px, 700 (S1) | no | 14.72 |
| card | radius / bg / border | tiles: 160×160, gap 16, r 18.4–19.6, opaque `#1e1e1e` → `#161616`, no border (`ref-09`); cards: r 10.0–10.5, `#171717`, 1px `#2e2f2f` (10% white), padding 16, gap 16 (`ref-06`) | section `.card`: 10px, `rgb(27,44,64)`, 1px `rgb(52,78,105)`, padding 15/18 (S1, S4); KPI `.metric`: 8px, `#1c3047`, 1px `#3d5d76`, padding 12, gap 10.5 (`styles.css` L102–113; 10px in `measure/solar-image-geometry.json`) | no | 12.05 |
| cardLabel | size / weight / case | 10.1–10.2px/500, uppercase, 0.04em, `#a1a1a1` (`text.dash.label.*`) | 12.6px/18.9px, 400, normal case (S1) | no | 7.83 |
| kpi | size / weight | number 32px/600 (`0` ink 24.45px), unit 12px; "Ready" 22.1px/600 (`ref-09`) [`dashboard.kpiGlyph`] | 22.5px, 680 (S1) | no | 11.42 |
| mutedText | color / size | `#a1a1a1`, 12–14px (dialog description 14.0, helper 12.0, footer 12.0) | `rgb(174,191,210)`, 12.3px (S1) | no | 9.22 |
| primaryButton | fill / radius / size | `#e5e5e5`, r 8.1, **32px** (Sync Now 790–881 × 620–651; Save), label `#171717` 14px/500 (`ref-07`, `ref-03`) | `rgb(40,65,92)` blue fill, 7px, 41px high, 15px/400 (S4) | no | 9.85 |
| outlineButton | fill / border | fill `#212121` (4.3% white), border `#434343` (15.3% white), 32px, r 7.3 (`ref-03`) | same single button style as primary (S7) | no | 9.85 |
| input / select | size / fill / border | 32px in dialogs, 36px chip input on Trackers; r ~7.3; fill 4.3% white; border 15% white; 14px text (`ref-03`, `ref-07`) | 38px, 6px, `rgb(12,26,40)`, border `rgb(108,128,146)` (S7, S5) | no | 15.6 |
| segmented | control | tabs list 36px, r 10.2–11.1, `#262626`, active `#2f2f2f` + 15% border (`ref-07`); tile control 24px track `#242424`, 20px option `#0a0a0a`, 10px text (`ref-09`) | `button[aria-pressed]` list, 41px, 7px (S4) | no | 9.85 |
| switch | control | 32×18; on `#e5e5e5` + `#171717` thumb; off `#333333` + `#fafafa` thumb (`ref-07`, `ref-03`) | absent; no checkbox/switch rendered (S1–S8) | no | n/a |
| tableHeader | style | 33px row, opaque `#0a0a0a`, 11.1–11.4px uppercase `#a1a1a1`, container r ~10 with 10% border (`ref-07`) | 13.35px, 700, normal case, 34px, 6.75/9px padding (S5) | no | 12.05 |
| tableCell | style | 12.1–12.2px, row 32px + 1px `#2b3233` divider (pitch 33), no hover (source) | 13.35px, 400, 35px (S5) | no | 12.05 |
| chip | form | 20px pill, `#262626`, 12px/500, dot `#00c950` (`ref-08`); outline count pill 20px, 8% border (`0/0`); success pill `#dbfce7`/`#008236`, 12px (`ref-06`) | 22px, 5px radius, `rgb(49,82,107)`, 12.75px/700 (S1) | no | 7.00 (S1); 4.39 (S4 detail badge) |
| dialogGroupHeader | size | 14px/600 ("Proxy", "Port mapping (NAT)", `ref-03`) | 17.1px/700 `h3` in a card (S1) | no | 12.05 |
| rowLabel | size | 14px/500 ("Enable proxy", "RPC port") | 15px/550 stacked label (S7) | no | 12.05 |
| helperText | style | 12px `#a1a1a1` | 15px/630 `.caption` (S4) | no | 12.71 |
| banner | style | not on screen in any capture; source `rounded-md border bg-muted/50 px-3 py-1.5 text-xs` | full-width, 0 radius, `rgb(99,61,36)` orange, 15px/620 (S2) | no | 7.54 |
| font | family | Inter Variable renders on Windows (55/61 strings fit); target Google Sans (user decision) | `system-ui, "Segoe UI", sans-serif`, 15px root (all) | no | — |
| focus | style | not visible in any capture; source 3px ring `oklch(.556 0 0)/50%` | `3px solid rgb(255,206,115)` outline (`solar-interactions.json`) | no | — |
| motion | reduced | not visible in stills; source honours `prefers-reduced-motion` | 4 animations → 0 under reduce (Overview flow lines) | yes | — |

S2 values for roles inside `main.data-stale` have null contrast ("opacity 0.64, filter grayscale(1)"). For reference, Motrix's own muted text measures 6.75:1 on the panel, 6.94:1 on cards and 7.66:1 on the table header (`measure/tone-contrast.json`).

### 5.1 Source versus pixel discrepancies

Every row of `motrix-source-values.json` was checked (`measure/motrix-source-vs-pixel.json`): 13 match, 1 consistent, 4 unverifiable from stills (focus, tooltip, banner, motion), 1 reference-font note, and 6 discrepancies. Each discrepancy below traces to a source line the first record omitted, or to the user's settings. None is a Motrix rendering bug.

| Role | Source record said | Windows pixels show | Explanation |
|---|---|---|---|
| panel | `m8` on all sides; translucent panel on every page | left margin 0 (panel x=200 abuts the 200px sidebar), top/right/bottom 8; **no panel on the Dashboard** | `sidebar.tsx` L341 `md:…:ms-0`; `router.tsx` L21 `transparentInset: true`, consumed in `app-layout.tsx` L107–108 |
| card (tile) | translucent gradient `oklch(.24/.95)→(.2/.9)` | opaque neutral `#1e1e1e` → `#161616` | `.dark .dashboard-tile` stacks the gradient over `var(--card)` (`globals.css` L408–410) |
| toolbarPill | glass child, `blur(10px) saturate(1.03)`, `rgb(44 46 50/88%)` gradient | `#0e1010` fill (= `bg-background/70` over the panel), `#1e2021` rim; no glass gradient (expected about `#292b2e`) | `liquidGlassEffect: false` in the user's settings (L65); `ToolbarGlass` renders only when it is `true` (`toolbar.tsx` L24–28, `use-liquid-glass.ts` L14). A still over a smooth field cannot prove the absence of blur; the fill colour is the evidence |
| primaryButton | h36 | every primary button on screen is 32px | `size="sm"` (`trackers-page.tsx` L74, `network-dialog.tsx` L569/L577) |
| input / select | h36 | 32px in dialogs; 36px only for the Trackers chip input | `network-dialog.tsx` L299 (`size="sm"`), L338/L531 (`h-8`) |
| tableHeader | `px12 py8 11px uppercase muted border-b` | adds an opaque `#0a0a0a` header band | `bg-background` in `effective-tracker-panel.tsx` L136 |

Additions with no source row: the 1px DWM window border (`#383838` left, `#363534` bottom in `ref-07`) and 8px rounded window corners. Mixed text anti-aliasing: ClearType in panel content, greyscale in the sidebar and dialogs (`observations[0]`).

## 6. Scorecard

`—` = dimension not applicable to the pair (plan applicability matrix). Every pair is image-backed. D9, and the focus part of D11, compare DOM records with source because stills cannot show interaction (Method).

| Dimension | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 |
|---|---|---|---|---|---|---|---|---|---|
| D1 Window chrome & shell | 0 | 0 | — | — | — | — | — | — | — |
| D2 Navigation & IA | — | 0 | — | — | — | — | 0 | — | — |
| D3 Materials & depth | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| D4 Color tokens | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| D5 Typography | — | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| D6 Shape, radius & spacing | — | 1 | 1 | 1 | 2 | 2 | 1 | 1 | 1 |
| D7 Components | — | 1 | 1 | — | 1 | 1 | 0 | 1 | — |
| D8 Data visualization | — | 1 | — | 1 | 1 | — | — | — | — |
| D9 Motion & interaction | — | 1 | — | — | — | 1 | 1 | — | — |
| D10 Empty/loading/error/stale | — | — | 1 | — | — | — | — | 1 | 1 |
| D11 Accessibility | — | 1 | — | — | — | 1 | 1 | 1 | — |
| **Pair score (0–3)** | 0.33 | 0.70 | 0.83 | 0.80 | 1.00 | 1.00 | 0.63 | 0.86 | 0.80 |

Image-backed mean = all-pairs mean = 6.95 / 9 = **0.77 (25.7/100)**.

### 6.1 Score changes

| Pair | Old | New | Cells | Evidence |
|---|---|---|---|---|
| P4 | 1.00, source-scored on D4–D7 | 1.00, image-backed on D3–D8 | D3 0 (new), D6 1→2, D8 1 (new) | **D6 → 2:** `img/ref-06-plugins.webp` cards are r 10.0–10.5 with a 1px 10%-white border, 16px padding and 16px gaps (`plugins.bannerCard`, `plugins.pluginCard`). The S4 KPI cards are `.metric`: r8 with a 1px border, 12px padding and a 10.5px gap (`styles.css` L102–113; 10px measured in `solar-image-geometry.json`), inside an r10 section `.card` (`solar-S4.json` `card`). Same bordered-card family with measurable deltas: radius −2, padding −4, gap −5.5. **D3 0:** the panel tint over the gradient (`#161e1f`) around the `ref-06` cards is absent in S4. **D8 1:** `img/ref-09-dashboard.webp` TRANSFER tile (32px number + 12px unit, segmented Today/All Time) vs S4's 22.5px whole-string KPIs with provenance badges |
| P5 | 1.00, source-scored on D4–D7 | 1.00, image-backed on D3–D7, D9, D11 | D3 0 (new), D6 1→2, D9 1 (new), D11 1 (new) | **D6 → 2:** `img/ref-07-trackers.webp` table: container r 9.6–10.7 with a 10% border, rows 32px + 1px divider (pitch 33), header 33px (`trackers.table`). S6 keeps the same divided-row structure inside an r10 card with 35px rows and a 34px header (`solar-S5.json` `tableCell`/`tableHeader`). **D3 0:** the opaque `#0a0a0a` header band and the 65% panel are absent in S5/S6. **D9/D11 1:** the P1 records apply (amber focus ring, no transitions); S5 table text measures 12.05:1 |
| P7 | 1.00, source-scored on D4–D7 | 0.86, image-backed on D3–D7, D10, D11 | D3 0 (new), D10 1 (new), D11 1 (new) | **D3 0:** `img/ref-03-settings-network.webp` and `img/ref-01-settings-advanced.webp` put content on an opaque `#171717` card, 700px wide, r 12.7–14.2, with a 10%-white ring over a black-20% overlay (`dialog`). S9–S11 render bare text on the window background with no surface. **D10 1:** the states exist but have no card or stepper; the onboarding layout is source-only. **D11 1:** the P1 focus and labelling records apply; no contrast was computed for S9–S11 |

P0–P3, P6 and P8 keep their scores: the Windows images confirm each cell. They now cite `ref-09` (chrome, tiles, sparklines), `ref-08` (chips, empty state) and `ref-05`/`ref-03`/`ref-01` (grid, dialogs) instead of the macOS fallbacks.

## 7. Findings

Redesign plan step numbers refer to `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md`: 1 foundations (dependencies, tokens, Google Sans), 2 window chrome, 3 UI primitives, 4 shell (sidebar and panel), 5 Overview and energy flow, 6 charts and History, 7 Usage & Cost and Data Quality, 8 Settings, 9 state screens and banners, 10 accessibility fallbacks and tooltips, 11 test and harness migration plus packaged verification, 12 polish. "Revised" marks a finding whose reference or fix changed in this revision. `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md` is superseded and removed; `SOLAR_UI_REDESIGN_PLAN.md` now owns current design, gaps and verification, and the step legend above is kept only so this audit's historical dispositions remain intelligible.

### D1 Window chrome & shell

### F-001 [S1] Native OS frame and menu bar
- Dimension · Pairs: D1 · P0, P1
- Reference: `src/main/window/platform-options.ts` L50–53 (win32 `titleBarStyle: 'hidden'`, solid background), `window-manager.ts` L414–417 (menu hidden) · `img/ref-09-dashboard.webp`, `img/ref-07-trackers.webp`: none of the nine captures has an OS caption strip or menu bar
- Current: `apps/desktop/src/main/index.ts` L18–29 sets only size and `show: false`; no `Menu` call in `src/main`. Native window outer 1280×850 vs inner 1264×785: 65px vertical, 16px horizontal frame · `img/solar-S13-native-renderer.webp` · `measure/solar-native.json`
- Hypothesis: H1 confirmed
- Fix (Motrix stack): `titleBarStyle: "hidden"`, `setAutoHideMenuBar(false)`, `setMenuBarVisibility(false)`, `backgroundColor: "#09090b"`, 40px `app-drag` overlay with custom caption buttons (F-028), window controls through `SolarBridge.window`.
- Disposition: Redesign plan step 2

### F-002 [S2] Window size
- Dimension · Pairs: D1 · P0
- Reference: `src/main/window/window-configs.ts` 914×672, min 914×672; client 914×672 measured between the 1px borders in `img/ref-07-trackers.webp` (`window.client`)
- Current: `apps/desktop/src/main/index.ts` L19–22: 1280×850, min 900×650; native outer size measured 1280×850 (`measure/solar-native.json`)
- Hypothesis: H17 confirmed
- Fix (Motrix stack): default and minimum 914×672, unless a view needs more width (the plan's step 11 records the check).
- Disposition: Redesign plan step 2

### F-028 [S2] Windows caption controls, wordmark row and frame (new)
- Dimension · Pairs: D1 · P0, P1
- Reference: `img/ref-07-trackers.webp` (`chrome`, `window`):
  - Caption glyphs: three 10×10 glyphs centred at x 813.5 / 849.5 / 885.5, y 26.5 (pitch 36 = 28px button + 8px gap), drawn over the panel's top-right corner, colour `#abaeae` (= `#fafafa` at 65% over `#161f20`).
  - Sidebar top row on the same centre line: wordmark x 18–61, chevron, sidebar-toggle icon (14px ink, x 101–114), "+" (x 137–146).
  - Frame: Windows keeps a 1px border (`#383838` left, `#383736` right, `#363534` bottom; `window.dwmBorder`) and 8px rounded window corners.
  - Source: `window-chrome.tsx` L85–99 (`size-7`, `gap-2`, `pe-3.5 pt-3.5`, `[&>svg]:opacity-65`).
- Current: native caption bar plus menu bar (F-001); no in-app controls · `img/solar-S13-native-renderer.webp`
- Hypothesis: new (refines H1)
- Fix (Motrix stack):
  - Caption buttons `size-7`, `gap-2`, `pe-3.5 pt-3.5`; glyph `size-2.5` at `opacity-65`, 90% on hover/focus; close hover `bg-destructive`.
  - Leading wordmark row centred on y≈27.
  - Keep `titleBarStyle: "hidden"` (never `frame: false`) so DWM keeps the 1px border and rounded corners seen in every reference.
- Disposition: Redesign plan steps 2 and 11

### D2 Navigation & IA

### F-003 [S1] Top header and tab buttons instead of a sidebar beside an inset panel (revised)
- Dimension · Pairs: D2, D1 · P1, P6
- Reference: `src/renderer/layouts/app-layout.tsx` L73–115, `components/ui/sidebar.tsx` L341, L521 · `img/ref-07-trackers.webp` (`sidebar`, `panel`):
  - Sidebar 200px. Pills 180×38 at x=10 (`h-[38px] px-2.5`, r ~8), pitch 42; the first pill spans y 55–92 (`img/ref-09-dashboard.webp`).
  - Footer: 1px hairline (x 10–189, y=613, 10% white) above the Settings pill (y 618–655, `img/ref-05-settings-grid.webp`).
  - Panel x 200–905, y 8–663: **no left margin**, 8px top/right/bottom, r ~14, `#0a0a0a` at 0.61–0.65 over the gradient. The Dashboard has no panel (F-030).
- Current: `App.tsx` L304–325: `header` 914×72 flat `rgb(27,42,60)` with `h1` app name, `nav` of five buttons, connection span; `main` is full width, 0 radius, transparent · `img/solar-S1.webp`
- Hypothesis: H2 confirmed
- Fix (Motrix stack): keep the `Tab` state in `App.tsx`. Render a 200px sidebar (Overview, History, Usage & Cost, Data Quality; Settings at the bottom after the hairline) with the measured pill geometry. Beside it, a panel at `m-2 ms-0`, 14px radius, `bg oklch(.145 0 0/.65)`, with a header band holding the page title and trailing actions.
- Disposition: Redesign plan step 4

### F-004 [S2] App name shown as the window title
- Dimension · Pairs: D2 · P1
- Reference: HIG toolbars: "Don't title windows with your app name"; no Motrix capture shows a window title
- Current: `App.tsx` L305 `h1` "House Solar Monitoring" · `img/solar-S1.webp`
- Hypothesis: H14 confirmed
- Fix (Motrix stack): panel title is the page name; the app name appears only in the sidebar wordmark slot and the OS taskbar label. The native window title string stays "House Solar Monitoring" as an accepted exception: with `titleBarStyle: "hidden"` it is not drawn, and the taskbar needs it for identification.
- Disposition: Redesign plan step 4

### F-005 [S2] Connection state as plain text (revised)
- Dimension · Pairs: D2 · P1
- Reference: `img/ref-08-downloads-empty.webp` status chips: 20px pills, `#262626`, 12px/500, green dot `#00c950` for "Engine ready", spinner for "NAT mapping" (`downloads.statusChips`); `routes/downloads/engine-badge.tsx`
- Current: `App.tsx` L318–324 text "Connected · ADMIN" · `img/solar-S1.webp`
- Hypothesis: new
- Fix (Motrix stack): `Badge variant="secondary"` pill (20px) with an 8px status dot (green connected, amber reconnecting) in the panel header actions.
- Disposition: Redesign plan step 4

### F-032 [S2] No iconography in navigation, actions or status (new)
- Dimension · Pairs: D7, D2 · P1, P6
- Reference:
  - `img/ref-07-trackers.webp`: lucide nav icons, 14×14px ink at x 21–34 (Dashboard y 67–80) in a 16px box at x 20–35 (`size-4` after the pill's 10px padding, `sidebar.tsx` L512/L521), 8px before the label at x=44 (`sidebar.navItem`).
  - `img/ref-08-downloads-empty.webp`, `img/ref-06-plugins.webp`: icon actions in a 36px toolbar pill plus a 36px round search button (`downloads.toolbarPill`, `downloads.searchButton`).
  - `img/ref-05-settings-grid.webp`: 3D category icons, 42–47px ink (`settingsGrid.iconInk`).
  - `img/ref-06-plugins.webp`: 38px monogram tiles.
  - `img/ref-09-dashboard.webp`: 10px status dot `#00bc7d`.
- Current: S1–S12 are text-only: nav, actions and connection state carry no icon · `img/solar-S1.webp`, `img/solar-S4.webp`
- Hypothesis: new
- Fix (Motrix stack): lucide `size-4` icons on every nav item, the wordmark and icon-only toolbar actions (with `aria-label`); Fluent Emoji 3D icons on the Settings grid; status dots on the connection chip.
- Disposition: Redesign plan steps 4 and 8 (already specified there)

### D3 Materials & depth

### F-006 [S1] No gradient shell or tinted panel layer (revised)
- Dimension · Pairs: D3 · all
- Reference (Windows pixels, `window.backdrop`, `panel`): Motrix on Windows has **no blur and no Mica**.
  - Sidebar: the gradient `hsl(186 24% 24%→15% / .92)` over the opaque `#09090b` window, reproduced to 0.5 levels at ten rows of `img/ref-07-trackers.webp`.
  - Panel: `#0a0a0a` at 0.61–0.65 over that gradient (teal-tinted `#161e1f` → `#111617`).
  - Cards and dialogs: opaque (`#171717`; tiles `#1e1e1e` → `#161616`).
  - Dialog overlay: black 20% (×0.8).
  - Toolbar: the non-glass fallback (F-029).
  - Source: `sidebar-color.css` L39–151, `platform-options.ts` L50–53 (no `backgroundMaterial` on win32).
- Current: no gradient, no translucent layer, no box-shadow (0 roles with `backdrop-filter` in S1; `box-shadow: none` on all measured roles); flat navy fills · `img/solar-S1.webp`
- Hypothesis: new
- Fix (Motrix stack): sidebar gradient (hue 186, saturation 24%, alpha 0.92, top lightness 24%, range 9%) over `#09090b`. Panel `oklch(.145 0 0/.65)`. Opaque cards and tiles (`.dashboard-tile` over `var(--card)`). Black-20% dialog overlay. No `backdrop-filter` anywhere.
- Disposition: Redesign plan steps 1 and 4

### F-029 [S2] Toolbar pill material: the non-glass surface the user sees (new)
- Dimension · Pairs: D3, D7 · P2, P4, P5
- Reference: `img/ref-08-downloads-empty.webp`, `img/ref-06-plugins.webp` (`downloads.toolbarPill`):
  - Pill 104×36 (x 734–837, y 40–75), `rounded-full`, fill `#0e1010` (= `#0a0a0a` at 70% over the panel), rim `#1e2021`.
  - Separate 36px round search button 8px to the right.
  - No glass gradient (expected about `#292b2e`): `liquidGlassEffect` is `false` in the user's settings, and `ToolbarGlass` renders only when it is `true` (`toolbar.tsx` L24–28, `toolbar-group.tsx` L17–21).
- Current: no toolbar; range and tariff selects sit in a `.form-row` under the title · `img/solar-S3.webp`, `img/solar-S4.webp`
- Hypothesis: new (corrects the first audit's "toolbar glass pills")
- Fix (Motrix stack): `ToolbarGroup` surface `h-9 rounded-full border border-border/70 bg-background/70 p-0.5` with no `ToolbarGlass` child and no displacement map.
- Disposition: Redesign plan steps 4 and 10

### F-030 [S1] Dashboard tiles sit on the shell; no panel; fixed 160px grid (new)
- Dimension · Pairs: D3, D6 · P1, P2, P3, P8
- Reference: `img/ref-09-dashboard.webp` (`dashboard.tiles`, `dashboard.kpiGlyph`); `router.tsx` L21, `app-layout.tsx` L107–108, `dashboard-page.tsx` L179–185:
  - No dark panel: the title (x=209, 24px/600) and tiles sit directly on the teal gradient.
  - Tiles are 160×160 cells with 16px gaps in four columns (x 210–897), rows at y 104 / 280 / 456. Wide tiles span 2 or 4 cells.
  - Tile r 18.4–19.6, opaque `#1e1e1e` → `#161616`, no border, 16px padding.
  - Label 10px/500 uppercase at x = tile + 16. Number 32px/600 with a 12px unit.
- Current: `img/solar-S1.webp`: Overview in a flat full-width `main`, the flow diagram in a 460×446 card, metrics in 190×101 `.metric` cards (r8, 1px `#3d5d76` border, 12px padding; `styles.css` L108–113) with 10px gaps (`measure/solar-image-geometry.json`); every KPI renders its whole string ("-1,600 W") at 22.5px.
- Hypothesis: new
- Fix (Motrix stack):
  - Overview uses a transparent panel (`bg-transparent shadow-none`; header `px-2`; content `ps-2.5 pe-2 pt-4`) and a `grid-cols-4 gap-4` grid with 160px rows.
  - The flow diagram spans 2×2 and each power metric is 1×1.
  - Numbers render at 32px with the unit at 12px in the same `dd`, so the text is unchanged. At 32px Google Sans, "-1,600 W" is 136.2px as one string but 108.6px split, inside the 128px tile content width (`measure/kpi-fit.json`).
- Disposition: Redesign plan steps 4 and 5

### D4 Color tokens

### F-007 [S1] Navy palette instead of neutral greys on a teal-grey shell
- Dimension · Pairs: D4 · all
- Reference: `globals.css` `.dark` tokens, confirmed in pixels. `--card`/`--popover` `#171717` (`plugins.pluginCard`, `dialog`), `--muted`/`--secondary` `#262626` (chips, tabs), `--muted-foreground` `#a1a1a1`, `--primary` `#e5e5e5`, borders 10% white, inputs 15% white. Shell teal-grey `#2c4447` → `#1c2b2d`.
- Current: `styles.css`: `#111b29` background, `#1b2a3c` header, `#1b2c40` cards, `#28415c` buttons, `#344e69`/`#687b94` borders; measured in S1/S4 · `img/solar-S1.webp`
- Hypothesis: H3 confirmed
- Fix (Motrix stack): replace every colour with the copied `.dark` token set; no hard-coded hex in TSX.
- Disposition: Redesign plan step 1

### F-008 [S2] Brand accent and amber focus ring
- Dimension · Pairs: D4, D11 · P1
- Reference: `button.tsx` / `input.tsx` 3px ring `oklch(.556 0 0)/50%` (source; no focus state in the captures); active nav 14% white (`sidebar.navItem.activeAlphaWhite`, `img/ref-07-trackers.webp`)
- Current: `:focus-visible` `3px solid rgb(255,206,115)` at 3px offset (`solar-interactions.json`), active nav teal `rgb(23,101,123)` with `rgb(112,210,214)` border
- Hypothesis: H6 confirmed
- Fix (Motrix stack): `focus-visible:ring-[3px] ring-ring/50`; active nav is the translucent white `bg-sidebar-active`.
- Disposition: Redesign plan steps 3 and 4

### D5 Typography

### F-009 [S1] System font instead of Google Sans
- Dimension · Pairs: D5 · all
- Reference: user decision, `@fontsource-variable/google-sans` 5.3.2, `font-optical-sizing: auto`. Motrix itself renders Inter Variable on Windows (55 of 61 measured strings fit Inter at whole-pixel sizes, `observations[1]`). Google Sans sets 0–6% narrower than Inter at the same size (`measure/font-width-ratio.json`).
- Current: `styles.css` L2–5 `15px/1.5 system-ui, Segoe UI, sans-serif`; no `@font-face` (measured `font-family: system-ui, "Segoe UI", sans-serif`, all roles)
- Hypothesis: H4 confirmed
- Fix (Motrix stack): bundle Google Sans Variable; stack from Reference values; ECharts `textStyle.fontFamily` set to the same stack; font-readiness gate before first render; Motrix sizes unchanged.
- Disposition: Redesign plan step 1

### F-010 [S2] Type scale (revised)
- Dimension · Pairs: D5, D6 · P1, P5, P6
- Reference: Windows pixels (`text.*`):
  - Title 24px/600, −0.025em.
  - Nav and body 14px (nav 400, row labels and buttons 500, group headings 600).
  - Secondary and helper 12px; table header 11px uppercase; tile label 10px/500 uppercase, 0.04em.
  - KPI 32px/600 with a 12px unit; "Ready" 22px/600; empty-state title 18px/500, −0.025em.
- Current: root 15px; title 25.5px/700; card label 12.6px/400 normal case; table header 13.35px/700 normal case; `.caption` 15px/630 (S1, S4, S5)
- Hypothesis: new
- Fix (Motrix stack): adopt Motrix's sizes and weights; weights limited to 400–700.
- Disposition: Redesign plan steps 1 and 7

### D6 Shape, radius & spacing

### F-011 [S2] Radii are not concentric and not Motrix's (revised)
- Dimension · Pairs: D6 · P1, P3
- Reference: pixel radii:
  - Panel 13.7–14.1; dashboard tiles 18.4–19.6.
  - Cards and table containers 9.6–10.7 (plugins, trackers); dialog 12.7–14.2.
  - Controls 7.3–8.4: nav pill, buttons, inputs, selects.
  - Pills full (chips 20px, toolbar 36px).
  - Source scale `--radius .625rem`: md 8, lg 10, xl 14, tile 18.
- Current: cards 10px, buttons 7px, inputs 6px, chips 5px, header and `main` 0 (S1, S4, S7)
- Hypothesis: H7 confirmed
- Fix (Motrix stack): radius scale from `globals.css`: sm 6, md 8 (controls), lg 10 (cards, table containers), xl 14 (panel, dialogs), tile 18; chips and toolbars `rounded-full`.
- Disposition: Redesign plan steps 1 and 3

### F-012 [S2] No panel header band, toolbar or footer
- Dimension · Pairs: D6, D2 · P1, P3
- Reference: `panel-shell.tsx` L45–48 (header `px-6 pt-8 pb-3`, 80px tall with the 36px action row); title cap top at y=48, x=224 in `img/ref-07-trackers.webp`; footer row with meta text and a 32px primary button (`trackers.footer`)
- Current: `h2` at 25.5px/700 as the first node of `main` (`styles.css` `h2` rule); range selects sit in a `.form-row` below it · `img/solar-S3.webp`
- Hypothesis: H8 confirmed
- Fix (Motrix stack): `PanelShell` per view with a title, a toolbar pill (F-029) holding the range controls, and a content area that scrolls.
- Disposition: Redesign plan step 4

### F-031 [S2] Spacing scale and control density (new)
- Dimension · Pairs: D6 · P1, P4, P5, P6, P7
- Reference (Windows pixels): a 4px grid.
  - Panel margins 8; panel padding 24 (title x=224); header top 32 (title cap y=48).
  - Card and tile padding 16; grid gaps 16.
  - Nav 38 + 4 (pitch 42); chips 20; table rows 32 + 1.
  - Controls are 32px (`sm`) in dialogs and panel footers, and 36px in toolbars, tabs and the page-level chip input (`ref-03`, `ref-01`, `ref-07`, `ref-08`).
- Current: em-based spacing at a 15px root: padding 6.75/8.25/9/12/15/18/22.5px; nav 41, buttons 41, selects 38, inputs 38–40, table rows 35 (header 34), chips 22 (`solar-S1.json`, `solar-S4.json`, `solar-S5.json`, `solar-S7.json`); grid gaps 10 (`solar-image-geometry.json`) · `img/solar-S4.webp`, `img/solar-S6.webp`
- Hypothesis: new
- Fix (Motrix stack): Tailwind's 4px spacing scale only. 32px controls inside dialogs, cards and footers: `Button size="sm"`, `NativeSelect size="sm"`, `Input className="h-8"` (Motrix's `Input` has no size variant; `network-dialog.tsx` L338 uses `h-8`). Default 36px in toolbars and panel headers. Table cells `px-3 py-2` with 12px text; gaps `gap-4`; card padding `p-4`.
- Disposition: Redesign plan steps 3, 7 and 8

### D7 Components

### F-013 [S1] Settings is a long form page, not a category grid with dialogs (revised)
- Dimension · Pairs: D7, D2 · P6
- Reference: `img/ref-05-settings-grid.webp`, `img/ref-03-settings-network.webp`, `img/ref-01-settings-advanced.webp` (`settingsGrid`, `dialog`):
  - Grid: eight categories in three columns (3+3+2). A full-width hairline under the header (y=88); row hairlines inset 24px (x 224–881, y 285 and 467); no vertical rules. Title 14px/600; description 12px in a cool grey matching `text-gray-400` `#99a1af` (`settings-card.tsx` L37), not `--muted-foreground`.
  - Dialog: 700×571 (85vh), r ~14, `#171717`, 10% ring over a black-20% overlay. Header `px-6 pt-6`: title 14px/500, description 14px `#a1a1a1`. Groups 14px/600 split by 10% separators. Rows: label 14px/500 with a 12px helper on the left, a 32px control on the right. 64px footer with `border-t` and 32px buttons.
  - Source: `routes/settings/settings-page.tsx` L20 (`px-6 py-4`), `cards/settings-card.tsx` L26–37, `general-dialog.tsx` L225–240, L414.
- Current: `Settings.tsx` stacks 16 `.card` sections in the captured admin state (seven read-only sections, Create tariff, tariff JSON editor, monthly rates, five JSON mutation editors, Delete entries); admin forms use raw JSON textareas · `img/solar-full-settings.webp`, `img/solar-S7.webp`, `img/solar-S8.webp`
- Hypothesis: H11 confirmed
- Fix (Motrix stack): category grid (Connection, Tariffs, Billing, Accounting, Exclusions, Meter readings) with Fluent Emoji 3D icons and the measured grid geometry. Each opens a dialog with grouped rows and `sm` controls. JSON editors stay available inside the dialogs (the contract for entering tariff JSON is unchanged).
- Disposition: Redesign plan step 8

### F-014 [S2] Choices and controls are native or button lists
- Dimension · Pairs: D7 · P4, P5, P6
- Reference: segmented tabs (`img/ref-07-trackers.webp`: 36px list `#262626`, active `#2f2f2f`), tile segmented control (`img/ref-09-dashboard.webp`: 24px track, 20px options), switches 32×18 (`ref-03`, `ref-07`), `Select` 32px (`ref-03`)
- Current: `.period-list button[aria-pressed]`, native `<select>`/`<input>` (S3, S4, S5), no switches
- Hypothesis: H9 confirmed
- Fix (Motrix stack): restyled native `select` (`NativeSelect`) for the data selectors, because three spec files assert on `<option>` elements (the open popup stays OS-drawn); selectable-row list for billing periods; `SegmentedControl` for fixed small option sets; `Switch` where a boolean exists.
- Disposition: Redesign plan steps 3, 6 and 7

### F-015 [S2] Buttons and inputs (revised)
- Dimension · Pairs: D7 · P4, P6
- Reference: Windows pixels: every visible text button (primary and outline) is **32px** (`size="sm"`), r ~8. Primary `#e5e5e5` with a `#171717` 14px/500 label (Sync Now, Save). Outline: `#212121` fill, 15% border (Cancel, Import from system, Open). Icon buttons differ: the round search button and toolbar pill are 36px, caption buttons 28px (source). Dialog inputs and selects 32px; the Trackers chip input 36px (`ref-07`, `ref-03`, `ref-01`, `ref-06`, `ref-08`). `button.tsx` keeps default h36 for toolbars.
- Current: a single blue 41px/7px button style for all actions; 38px/6px inputs (S4, S7)
- Hypothesis: H5 confirmed
- Fix (Motrix stack): copy `button.tsx` variants; primary for the single main action, outline for the rest; `size="sm"` inside dialogs, cards and footers (F-031).
- Disposition: Redesign plan steps 3, 7 and 8

### F-016 [S2] Chips and badges (revised)
- Dimension · Pairs: D7 · P1, P4
- Reference: `badge.tsx` 20px pill. Windows variants:
  - Secondary chips `#262626`, 12px/500 (`ref-08`).
  - Outline count pill (`0/0`): 20px, 8% border, no fill (`downloads.countPill`).
  - Tinted success pill `#dbfce7`/`#008236` (`ref-06`, F-033).
- Current: `.badge`/`.status-chip` 5px radius, 12.75px; 700 for the S1 status chip, 400 for the S4 detail badge, which reads 4.39:1 contrast (`solar-S1.json`, `solar-S4.json` `chip`)
- Hypothesis: new
- Fix (Motrix stack): `Badge` primitive; resolves the sub-4.5 contrast.
- Disposition: Redesign plan steps 3 and 5

### F-017 [S2] Tables (revised)
- Dimension · Pairs: D7 · P5
- Reference: `img/ref-07-trackers.webp` (`trackers.table`); `effective-tracker-panel.tsx` L128–182:
  - Container r ~10 with a 10%-white border.
  - Opaque `#0a0a0a` sticky header band, 33px, 11px uppercase `#a1a1a1`.
  - Rows 32px with 12px cells and a 1px `#2b3233` divider (pitch 33), no row hover.
- Current: `th` 13.35px/700, `td` 13.35px, `nowrap`, 1px `#3a5166` borders, rows 35px (S5)
- Hypothesis: new
- Fix (Motrix stack): rounded `border` container, sticky `bg-background` header row, dividers except the last.
- Disposition: Redesign plan step 7

### F-033 [S3] No semantic status colour (new)
- Dimension · Pairs: D7, D4 · P4, P5
- Reference: `img/ref-06-plugins.webp` "Looks safe" pill: 20px, `#dbfce7` fill, `#008236` 12px/500 text (`plugins.successBadge`). Health dots after the ms values in `img/ref-07-trackers.webp`; the engine dot `#00bc7d` in `img/ref-09-dashboard.webp`. Tone map `routes/plugins/lib/audience.ts` L35–40: green, amber and blue at 100/700, slate at 100/600.
- Current: states and verdicts are plain text or navy chips: "RUNNING · MODBUS" (S5), "INSUFFICIENT" (S6), "MEASURED_INTEGRATED · coverage 99.86 % · OK" (S4), `accountingStatus` in a `.status-chip` (Overview) · `img/solar-S5.webp`, `img/solar-S6.webp`
- Hypothesis: new
- Fix (Motrix stack): one `statusTone(value)` map in `Badge` usage, applied to the enums whose meaning is known.
  - `AccountingStatus`: `RECONCILED` green; `UNRECONCILED` and `MAPPING_PROVISIONAL` amber; `RECONCILIATION_FAILED` red.
  - `BillingStatus`: `COMPLETE` green, `ESTIMATED` amber, `UNAVAILABLE` slate.
  - Free-text verdicts stay `secondary`.
  - Contrast (`measure/tone-contrast.json`): Motrix's rendered pill (`#008236` on `#dbfce7`) is 4.4957:1, just under 4.5, and the green-700/100 token pair is 4.503:1. Solar uses 800-shade text for green and amber (6.49 and 6.36:1), red-700 (5.27:1) and slate-600 (6.92:1), so every badge clears 4.5:1 (F-026).
- Disposition: Redesign plan steps 5 and 7

### D8 Data visualization

### F-018 [S2] ECharts default theme and hardcoded colours
- Dimension · Pairs: D8 · P3
- Reference: `img/ref-09-dashboard.webp` sparklines draw exactly the chart tokens: upload `#7c76f9` (`--chart-2` 243 92% 72%), download `#2dc2eb` (`--chart-1` 193 83% 55%). 1px core stroke with tinted fills `#232232`/`#192b30`; heatmap ramp `#262626` → `#2dc2eb` (`dashboard.sparkline`, `dashboard.heatmap`).
- Current: `components/Chart.tsx` `echarts.init(node)` with no theme; `History.tsx` colours `#8dd6ff`, `#9be28a`, `#ffda91`, gap `rgba(225,110,86,.16)` · `img/solar-S3.webp` (white grid lines, default palette)
- Hypothesis: H10 confirmed
- Fix (Motrix stack): one registered ECharts theme from the tokens (muted gridlines, chart tokens, Google Sans `textStyle`); gap shading from a token.
- Disposition: Redesign plan step 6

### F-019 [S3] Energy-flow diagram palette
- Dimension · Pairs: D8 · P1
- Reference: tile styling (`img/ref-09-dashboard.webp`)
- Current: `.flow-node`/`.flow-edge` teal on navy (`styles.css` L266–317)
- Hypothesis: new
- Fix (Motrix stack): token colours, no outer border; keep the `flow-live` animation behaviour.
- Disposition: Redesign plan step 12

### D9 Motion & interaction

### F-020 [S3] Hover, active and transition states
- Dimension · Pairs: D9 · P1
- Reference: `sidebar.tsx` hover 6% / active 14% white (active confirmed at 14% in `img/ref-07-trackers.webp`); dialog 100ms, sidebar 200ms (source; stills show no motion)
- Current: nav hover `rgb(40,65,92)` → `rgb(54,88,116)`; no transitions
- Hypothesis: new
- Fix (Motrix stack): Motrix hover/active tokens, `transition-all` on controls, `motion-reduce` handling.
- Disposition: Redesign plan step 12

### D10 Empty/loading/error/stale states

### F-021 [S2] Bare first-run, auth and TLS screens
- Dimension · Pairs: D10 · P7
- Reference: `onboarding-surface.tsx` (`bg-[#161617]` dark; source only, no capture of the onboarding window); card surface as in `img/ref-03-settings-network.webp` (`#171717`, r ~14, 10% ring, 24px padding, 32px controls)
- Current: `App.tsx` L125–188, L268–300 plain `main` pages (`img/solar-S9.webp`, `S10`, `S11`; the native build shows the same first-run page)
- Hypothesis: H12 confirmed
- Fix (Motrix stack): an onboarding surface card with a stepper, a monospace fingerprint block and primary/outline buttons.
- Disposition: Redesign plan step 9

### F-022 [S2] Orange full-width reconnect banner and grey-out
- Dimension · Pairs: D10 · P2
- Reference: `downloads-page.tsx` L102 (`rounded-md border bg-muted/50 px-3 py-1.5 text-xs`). Source only: no capture shows the stale banner; the Windows status chips (`img/ref-08-downloads-empty.webp`) carry engine state instead.
- Current: `.notice` 914×50, 0 radius, `rgb(99,61,36)`, 15px/620; stale content gets `opacity .64` plus `grayscale(1)` · `img/solar-S2.webp`
- Hypothesis: H13 confirmed
- Fix (Motrix stack): muted banner with a retry action, plus the connection chip; keep the stale-data de-emphasis behaviour (the contract is "values greyed, no flow animation").
- Disposition: Redesign plan step 9

### F-023 [S2] Empty values as dashes without styling (revised)
- Dimension · Pairs: D10 · P8
- Reference: `img/ref-08-downloads-empty.webp`: centred `EmptyTitle` "No downloads yet" 18px/500, −0.025em, `#fafafa` (`empty.tsx` L57–62), with the hint "Press + to add one" 14px `#a1a1a1` below. `img/ref-02-settings-integration.webp`: inline empty state "No extensions connected yet." as 12px centred muted text in a dashed 10% box.
- Current: `—` tiles with no explanatory text beyond a title tooltip · `img/solar-S12.webp`
- Hypothesis: new
- Fix (Motrix stack): keep `—` with reason, shown in a styled `Tooltip`; a whole empty view gets the centred `EmptyTitle` + hint pair; an empty list inside a tile gets the dashed inline box.
- Disposition: Redesign plan step 10

### D11 Accessibility

### F-024 [S2] No reduced-transparency, contrast or forced-colors handling
- Dimension · Pairs: D11 · P0, P1
- Reference: `sidebar-color.css` L238–255 (`prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors`)
- Current: `styles.css` has only a `prefers-reduced-motion` rule and one `max-width: 800px` media query
- Hypothesis: H15 confirmed
- Fix (Motrix stack): solid fallbacks under `prefers-reduced-transparency` / `prefers-contrast: more` for the sidebar gradient (solid `hsl(186 24% 17%)`), the toolbar pill's 70% fill (solid `--background`, as Motrix `toolbar-glass.css` L61–66) and the tiles (`var(--card)`).
- Disposition: Redesign plan step 10

### F-025 [S2] Native `title` tooltips
- Dimension · Pairs: D11 · P1, P8
- Reference: `components/ui/tooltip.tsx` (inverted, 8px radius; source only, no tooltip in the captures)
- Current: reasons for `—` values and exact decimals use `title` attributes (e.g. `Display.tsx`, `History.tsx`)
- Hypothesis: H16 confirmed
- Fix (Motrix stack): `Tooltip` primitive; the exact value stays in the tooltip text.
- Disposition: Redesign plan step 10

### F-026 [S3] Accessibility strengths to keep
- Dimension · Pairs: D11 · P1
- Current: reduced-motion removes the flow animation (4 → 0 animations). In S1 the active navigation measures 6.19:1 and the chip 7.00:1; the S4 detail badge measures 4.39:1; the other numeric ratios in the token table exceed 7:1. S2 stale-content ratios are not computed.
- Hypothesis: new
- Fix (Motrix stack): retain `aria-current`, `role="img"` charts, labelled inputs, reduced-motion handling; keep every text role at least 4.5:1.
- Disposition: Redesign plan step 12

### Scope limitation

### F-027 [S2] Dark theme only; no light or system theme
- Dimension · Pairs: D4 · all
- Reference: Motrix follows the OS theme (`theme: "system"` in the user's settings)
- Current: dark only
- Hypothesis: new
- Fix (Motrix stack): none
- Disposition: accepted scope limitation — dark only

### Reference content with no solar counterpart (no finding)

Brand install cards and the "Trusted extensions" disclosure (`ref-02`), the activity heatmap and speed-limit mode icons (`ref-09`), the WebGL-style empty-state gradient (`ref-08`), and the RPC secret field with a reveal button (`ref-01`). These are Motrix content, not styling. Their primitives are covered by F-014, F-016, F-023 and F-032.

## 8. Apple HIG cross-check

On Windows, Motrix replaces translucent glass with a tinted gradient shell over an opaque window (F-006). The "glass" row is read as "tinted material only on the navigation layer".

| Principle (source) | Solar | Result |
|---|---|---|
| Glass only on the navigation/controls layer ([Materials](https://developer.apple.com/design/human-interface-guidelines/materials)) | No tinted or translucent layer anywhere (F-006) | fail |
| Inset floating sidebar ([Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)) | Top tab header, no sidebar (F-003) | fail |
| Concentric corners window → panel → card → control ([Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)) | 0 / 0 / 10 / 7 / 6 px vs Motrix 8 / 14 / 10 / 8 (F-011) | fail |
| Borderless toolbar symbols, ≤3 groups, one prominent trailing action | Bordered text buttons, no toolbar (F-029, F-032) | fail |
| No app-name window title | `h1` is the app name (F-004) | fail |
| Reduced-transparency / contrast fallbacks | None (F-024) | fail |
| Nothing critical at the sidebar bottom | No sidebar | n/a |

## 9. Stack & licensing notes

- Motrix code is MIT and may be copied with its notice. Not MIT, never copied: `routes/settings/icons/icon-*.webp`, `routes/dashboard/icons/speed-*.webp`, brand install icons, `extra/tray/SFNS-Regular.ttf` (`D:/Github/Motrix/THIRD_PARTY_NOTICES.md`). Replacement 3D icons: Microsoft Fluent Emoji `3D` PNGs (MIT).
- The `img/ref-*.webp` screenshots show those non-MIT icons; they are evidence only and are never cropped into app assets.
- Inter (from Motrix's `node_modules`) and the Google Sans tarball (`captures/local/ui-audit/fonts/`, gitignored) were loaded only into a scratch browser tab for measurement.
- Google Sans: `@fontsource-variable/google-sans` 5.3.2, OFL-1.1, family `'Google Sans Variable'`, weights 400–700, `opsz`/`GRAD` axes.
- **Unverified packaged-asset risk (not a defect):** the `app://` handler (`apps/desktop/src/main/security.ts` L33–45) forwards `net.fetch(file)` headers and overrides only `.js/.css/.html/.svg/.png`. The CSP's `default-src 'self'` covers fonts. This is verified in the redesign's packaging step.

## 10. Review log

### First audit

| Item | Reviewer | Resolution | Evidence |
|---|---|---|---|
| Summary finding IDs wrong (F-002…F-006) | EvidenceReviewer | Fixed: F-003, F-006, F-007, F-009, F-013 | Section 1 |
| F-026 overstated contrast (6.19, 7.00 omitted) | EvidenceReviewer | Fixed with the measured values | F-026 |
| F-004 fix kept the app name in the window title | EvidenceReviewer | Fixed: documented as an accepted exception (title not drawn, taskbar needs it) | F-004 |
| F-013 said eight cards; page has 16 | FidelityReviewer | Fixed to 16 with the breakdown | F-013 |
| S7 initially showed the page bottom, not holidays/rates | FidelityReviewer | S7/S8 recaptured from a fresh load and measurements rewritten; Gallery relabelled | `img/solar-S7.webp` |
| Independent visual mismatches, misses, severity | FidelityReviewer | No issues | — |
| P4, P5, P7 not visually reviewed | FidelityReviewer | Superseded: image-backed in this revision | Section 6.1 |
| Token and scorecard arithmetic, links, H1–H17, dispositions | EvidenceReviewer | Verified correct, no issues | — |

### Windows-reference revision

Reviewer outputs are retained in `captures/local/ui-audit/review/` (one JSON file per reviewer).

| Item | Reviewer | Resolution | Evidence |
|---|---|---|---|
| All nine capture → name mappings and screen labels | LabelReviewer | Confirmed correct | `reference/MAPPING.md` |
| `ref-04` is not a larger window; only the capture region is larger (window 914px in both) | LabelReviewer | Accepted; MAPPING and Method say so; assignment follows capture order | `reference/MAPPING.md` |
| Planned descriptions: grid is 8 cells (3+3+2) with horizontal rules only; Integration's fifth card says "Development"; second plugin is v1.0.0; RPC secret field is full-width | LabelReviewer | Recorded in MAPPING; grid facts used in F-013 | `reference/MAPPING.md` |
| Dashboard has no floating panel (contradicts the plan's "every reference" shell list) | LabelReviewer | Became F-030 and the panel discrepancy in 5.1 | F-030 |
| Panel fill sample at y=150 hit the switch (negative alpha) | PixelReviewer | Replaced with explicit `clientXY`/underlay pairs; alpha 0.61–0.65 | `panel.fillSamples` |
| "Looks safe" size 13.08 included the pill corner | PixelReviewer | Refit to 12.0px (x 321–381) | `text.plg.badge.Looks safe` |
| Trackers switch colours were AA edges; x off by 1 | PixelReviewer | Corrected to `#e5e5e5`/`#171717`, x 850–881 | `trackers.switch` |
| Segmented track end y 314 → 315 | PixelReviewer | Corrected (24px track) | `dashboard.segmented` |
| `ref-09` `panelEdge` lies outside the window | PixelReviewer | Relabelled as outside the window | `planSamples` |
| DWM border range too narrow; missing sample points across groups | PixelReviewer | Per-side samples and `sampleXY`/`radiusCorners` added throughout | `window.dwmBorder` |
| Nav label weight | PixelReviewer (source check) | `sidebar.tsx` L512/L521 has no `font-medium`; refit at 400 (14.05–14.17px) | `text.nav.*` |
| 25 re-sampled colours/geometries, 6 font sizes, 2 alphas, all source-vs-pixel verdicts | PixelReviewer | Matched except the items above | `captures/local/ui-audit/review/PixelReviewer.json` (`.explanation`), `motrix-source-vs-pixel.json` |
| Independent blind re-score of P0–P8 from the images | FidelityReviewer | Same value in every cell; means 0.77 / 25.7 confirmed | Section 6 |
| P4 D6 evidence used the generic `.card` (r10) for the KPI cards, which are `.metric` (r8, padding 12, `#1c3047`) | FidelityReviewer | Fixed in 6.1, F-030 and the token table; D6 = 2 kept as the same bordered-card family with deltas | `styles.css` L102–113 |
| F-031 gave `Input` a `size="sm"` prop it does not have | FidelityReviewer | Fixed: `Input className="h-8"` (plan Step 3 too) | F-031 |
| P5 "contrast ≥ 7" contradicted navActive 6.19 | FidelityReviewer | Reworded to the S5 table text (12.05:1) | 6.1 |
| F-024 said the toolbar has no translucency; F-029 specifies a 70% fill | FidelityReviewer | F-024 and plan Step 10 add a solid `--background` fallback for the pill | F-024 |
| Width check overgeneralised from 10 strings | FidelityReviewer | Method limits the claim to the measured strings; Step 11D still checks overflow | Method |
| F-016 called every solar chip 700 weight | FidelityReviewer | S1 chip 700, S4 badge 400 | F-016 |
| Green tone pair: rendered `ref-06` pill is 4.4957:1 | FidelityReviewer | Plan uses 800-shade text for green and amber (6.49, 6.36:1) | F-033, `tone-contrast.json` |
| No uncovered visible mismatch; no further S1 correction | FidelityReviewer | — | — |
| Every new number traced: 27 original pixels re-decoded, 4 Inter fits, all score means (×33.3), 29 image links, Method's macOS limit | EvidenceTraceReviewer | Verdict correct after the five fixes below | `captures/local/ui-audit/review/EvidenceTraceReviewer.json` |
| F-028 right border is `#383736`, not `#383838` | EvidenceTraceReviewer | Fixed (per-side colours) | `window.dwmBorder` |
| F-033 said slate is 100/700 | EvidenceTraceReviewer | Fixed: slate 100/600 (`audience.ts` L39) | F-033 |
| F-030 quoted "−1,600 W" (U+2212); `kpi-fit.json` measured "-1,600 W" | EvidenceTraceReviewer | Fixed to the measured string and 136.2 / 108.6px | F-030 |
| F-015 "every visible button is 32px" ignored icon buttons (36px search, 28px caption) | EvidenceTraceReviewer | Narrowed to text buttons; icon sizes listed | F-015 |
| F-032 icon box "x 20–38" is 19px | EvidenceTraceReviewer | Fixed: ink x 21–34 inside a 16px box at x 20–35 | `sidebar.navItem.icon` |
| Plan: duplicate `WindowChrome` in Step 4; Settings double padding; Step 7 `SegmentedControl` vs History.spec `fireEvent.change`; sidebar variable selectors needing `data-sidebar-color`; `statusTone` without `variant="secondary"`; `NativeSelect` `size` clashing with the native prop; card fields not 32px; tile fallback specificity | PlanReviewer | All fixed in the plan (Steps 1, 3, 4, 7, 8, 9, 10) | `captures/local/ui-audit/review/PlanReviewer.json` |
| Plan: banned words, licensing, stack, Step 11A coverage of the `Metric` unit split | PlanReviewer | No issue | — |
| Plan re-check: seven fixes confirmed; the tile fallback in `sidebar.css` would lose to the later `globals.css` gradient at equal specificity | PlanReviewer (second pass) | Fixed: the tile fallback media block moves to `globals.css` after the copied tile rule | Plan Step 10 item 1 |
