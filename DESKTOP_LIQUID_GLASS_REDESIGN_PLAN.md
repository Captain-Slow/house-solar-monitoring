# Desktop liquid-glass redesign

## Context

The desktop app (`apps/desktop`, Electron 44, React 19) renders as a flat navy web page: native OS frame and menu bar, a top header with tab buttons, plain CSS in `apps/desktop/src/renderer/styles.css`, system font. The audit (`docs/ui-audit/desktop-ui-audit.md`, 33 findings, scored against the user's nine Windows Motrix screenshots; image-backed score 0.77/3) shows it is a different design family from Motrix's look. The target is Motrix's dark Windows look as the user sees it: frameless window with custom caption buttons, a cyan gradient sidebar over an opaque window (no blur, no Mica), an inset panel at 65% black, Dashboard tiles directly on the shell, non-glass toolbar pills, Motrix primitives, dark only. Measured pixel targets below (coordinates, colours, sizes, alphas) come from `captures/local/ui-audit/measure/motrix-ref-pixels.json` and its sibling files (client CSS px, DPR 1), rounded to the nearest unit; class names and token values (for example the 18px tile radius) are Motrix source values that those measurements confirm. The typeface is **Google Sans** (bundled) on every surface.

Binding decisions:
- Adopt Motrix's stack: Tailwind v4, Base UI primitives, `class-variance-authority`, `tailwind-merge`, lucide icons. This overrides the "No UI kit" line in `SOLAR_MONITORING_PLAN.md` Phase 6.
- Typeface: Google Sans via `@fontsource-variable/google-sans` (OFL-1.1). Never import Inter.
- Dark only. Light/system theme is out of scope (audit F-027).
- Never copy non-MIT Motrix assets: `routes/settings/icons/icon-*.webp`, `routes/dashboard/icons/speed-*.webp`, brand install icons, `extra/tray/SFNS-Regular.ttf`.
- No behaviour change: every GraphQL operation, query interval, stale/greyed rule, role gating, pagination and accessible name stays as it is. This is a presentation change.

Motrix source root below is `D:/Github/Motrix/src/renderer/` (call it `M`). Motrix is MIT (`D:/Github/Motrix/LICENSE`); copied files keep behaviour but lose Motrix-specific imports (`@renderer/*` aliases, `react-i18next`, `components/icons`).

## Approach

Every step leaves the tree building (`npm run typecheck -w apps/desktop`) and `npm test -w apps/desktop` passing. **Each test change listed in Step 11A is made in the same step as the production change that needs it**; Step 11A is the table of those changes and the final regression gate. Steps are ordered by dependency: 1 → 2 → 3 → 4, then 5–10 in any order after 4, then 11, then 12.

### Step 1 — Foundations: dependencies, tokens, Google Sans (audit F-006, F-007, F-009, F-010, F-011)

1. **Dependencies.** In `apps/desktop/package.json` `dependencies` add exact pins (resolved with `npm view` on 2026-10-24):

   |Package|Version|
   |---|---|
   |`@base-ui/react`|`1.9.0`|
   |`@fontsource-variable/google-sans`|`5.3.2`|
   |`class-variance-authority`|`0.7.1`|
   |`clsx`|`2.1.1`|
   |`lucide-react`|`1.61.0`|
   |`tailwind-merge`|`3.7.0`|
   |`tw-animate-css`|`1.4.0`|

   `devDependencies`: `tailwindcss` `4.3.3`, `@tailwindcss/vite` `4.3.3`. Run `npm install` at the repo root. Do not add `shadcn`, `next-themes`, `react-router`.
2. **Build.** `apps/desktop/electron.vite.config.ts` renderer `plugins: [react(), tailwindcss()]` with `import tailwindcss from "@tailwindcss/vite"`.
3. **Utilities.** Create `apps/desktop/src/renderer/lib/utils.ts`: `export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }`.
4. **Stylesheet.** Create `apps/desktop/src/renderer/styles/globals.css` and delete `styles.css`. Contents, in order:
   - `@import "tailwindcss";` and `@import "tw-animate-css";`
   - `@custom-variant dark (&:is(.dark *));`
   - From `M/styles/globals.css`, copied verbatim: the `@theme inline` block, the `:root` custom properties for radius (`--radius`, `--dashboard-tile-radius`) only, the whole `.dark { … }` colour block, and the `.dashboard-tile` / `.dark .dashboard-tile` rules (L395–410).
   - Font: `:root { --app-font-sans: "Google Sans Variable", "Google Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"; font-optical-sizing: auto; }` and map `--font-sans` and `--font-heading` to it in the `@theme inline` block.
   - `body { margin: 0; background: #09090b; color: var(--foreground); font-family: var(--app-font-sans); }` and `@utility app-drag { -webkit-app-region: drag } @utility app-no-drag { -webkit-app-region: no-drag }`.
   - The flow-line animation from the old `styles.css` L266–317 (`.energy-flow`, `.flow-node`, `.flow-edge`, `.flow-strong`, `.flow-idle`, `.flow-live` rules, `@keyframes flow-dash`, the `prefers-reduced-motion` rule), with colours switched to tokens (`stroke: hsl(var(--chart-1))` for edges — `--chart-N` are bare `H S% L%` triplets; `fill: var(--card)`/`stroke: var(--border)` for nodes and `fill: var(--foreground)` for text — these are full colours) and no `font-family` declaration.
   - Structural rule kept until Step 6: `.chart { width: 100%; height: 360px; }`.
   - `code, pre, kbd, samp { font-family: var(--app-font-sans); }` after Tailwind's preflight, so no element falls back to a monospace stack.
   - Reduced-motion: copy `M/styles/globals.css`'s `motion-reduce` custom variant and the `html[data-reduced-motion="true"]` block.
5. **Sidebar gradient** (audit F-006). Create `apps/desktop/src/renderer/styles/sidebar.css`, imported from `globals.css`. Copy from `M/styles/sidebar-color.css`: L39–50 (variables, dark values), the cyan hue `--sidebar-hue: 186`, the `--sidebar: hsl(186 24% 17%)` rule (L74–79), the gradient rule L92–151 with its selector changed from `:root[data-sidebar-color] [data-slot="sidebar-wrapper"]` to `.app-sidebar-wrapper`, the `[data-slot="sidebar-inner"]` transparent rule with its selector changed to `.app-sidebar-inner`, and the media block L238–255 (reduced transparency, contrast, forced colours → solid `var(--sidebar)`), adapted to the new selectors. Rewrite the variable selectors too, because the app sets no `data-sidebar-color` attribute: `:root[data-sidebar-color="cyan"]` and `:root[data-sidebar-color]` become `:root`, `:root.dark[data-sidebar-color]` becomes `:root.dark`, and the `--sidebar` rule's `:root.dark[data-sidebar-color]:not(…)` becomes `:root.dark`. Drop all other hue presets, the swatch picker and the darwin rules. Over the `#09090b` body this renders `#2c4447` at y=1, `#25393c` at y=300 and `#1c2b2d` at y=671 (`sidebar.gradientSamples`, `ref-07`).
6. **Dark only.** `apps/desktop/src/renderer/index.html`: `<html lang="en" class="dark">`, inline `<style>html,body{background:#09090b;color-scheme:dark}</style>` in `<head>`.
7. **Font loading.** In `apps/desktop/src/renderer/main.tsx`:
   - `import "@fontsource-variable/google-sans/opsz.css";` then `import "./styles/globals.css";` (replacing `./styles.css`).
   - Before `createRoot(...).render(...)`, inside `try { … } catch (error) { console.error("Google Sans Variable failed to load", error); }`: `const faces = await Promise.all([document.fonts.load('400 14px "Google Sans Variable"', 'Solar 0123456789 kWh'), document.fonts.load('600 14px "Google Sans Variable"', 'Solar 0123456789 kWh')]); if (faces.some((f) => f.length === 0)) console.error("Google Sans Variable failed to load");`. Always continue to `createRoot(...).render(...)` afterwards; a font failure is a packaging acceptance failure (Step 11E), never a reason to blank the UI.
8. **Notices.** Create `apps/desktop/THIRD_PARTY_NOTICES.md` with three sections, each with copyright line and licence text: Motrix (MIT, copy `D:/Github/Motrix/LICENSE`), Microsoft Fluent Emoji (MIT, copy the licence from `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE`), Google Sans (OFL-1.1, copy `node_modules/@fontsource-variable/google-sans/LICENSE`).
9. **Cut over.** After steps 3–7 the app compiles but is unstyled where old classes remain; Steps 4–10 restyle each view. To keep the tree usable meanwhile, keep every existing `className` in views untouched until its step.

**Check:** `npm run typecheck -w apps/desktop`; `npm test -w apps/desktop`; `npm run build -w apps/desktop` emits `out/renderer/assets/*google-sans*.woff2`.

### Step 2 — Window chrome and bridge (audit F-001, F-002, F-028)

1. **Main window** (`apps/desktop/src/main/index.ts`): `width: 914, height: 672, minWidth: 914, minHeight: 672, titleBarStyle: "hidden", backgroundColor: "#09090b"`; after creation `window.setAutoHideMenuBar(false); window.setMenuBarVisibility(false);`. Add `nativeTheme.themeSource = "dark"` before windows are created (`import { nativeTheme } from "electron"`). Use `titleBarStyle: "hidden"`, never `frame: false` and never `backgroundMaterial`: Windows then keeps the 1px DWM border (`#383838` left, `#383736` right, `#363534` bottom in `ref-07`) and 8px rounded corners seen in every reference, over an opaque window (audit F-028, F-006).
   - If Step 11's width check finds a view needs more than 914px, set the size recorded there (the plan owner records it in Step 11); otherwise keep 914×672.
2. **Contract** (`packages/contracts/src/bridge.ts`): add to `SolarBridge`
   ```ts
   window: {
     minimize(): Promise<void>;
     toggleMaximize(): Promise<void>;
     close(): Promise<void>;
     onMaximizedChanged(cb: (maximized: boolean) => void): () => void;
   };
   ```
3. **Main IPC** (`apps/desktop/src/main/ipc.ts`): register exactly three `ipcMain.handle` channels `solar:window:minimize`, `solar:window:toggle-maximize`, `solar:window:close`. Each calls the existing `authorize(event)` first, then `const win = BrowserWindow.fromWebContents(event.sender)`; no window → return. Minimize: `win.minimize()`. Toggle: `win.isMaximized() ? win.unmaximize() : win.maximize()`. Close: `win.close()`. Add `export function bindWindowState(window: BrowserWindow): void` that sends `solar:window:maximized` with `window.isMaximized()` on the events `maximize`, `unmaximize`, `enter-full-screen` and `leave-full-screen`, and once on `did-finish-load`. Call it from `createWindow` in `main/index.ts` right after the window is created.
4. **Preload** (`apps/desktop/src/preload/index.ts`): add `window: { minimize: () => ipcRenderer.invoke("solar:window:minimize"), toggleMaximize: () => ipcRenderer.invoke("solar:window:toggle-maximize"), close: () => ipcRenderer.invoke("solar:window:close"), onMaximizedChanged }` where `onMaximizedChanged` follows the existing `onConnectionState` subscriber pattern on channel `solar:window:maximized`, replaying the latest value.
5. **Renderer chrome.** Create `apps/desktop/src/renderer/components/window-chrome.tsx` adapted from `M/components/window-chrome/window-chrome.tsx`:
   - Fixed overlay: `fixed top-0 right-0 left-0 z-30 flex h-10 items-center app-drag select-none`, `background: transparent`.
   - Leading slot (`app-no-drag`): the sidebar wordmark (Step 4).
   - Trailing `DesktopWindowControls`: `flex shrink-0 items-center gap-2 pe-3.5 pt-3.5`; three `size-7 rounded-md border-0 bg-transparent hover:bg-accent app-no-drag [&>svg]:opacity-65 hover:[&>svg]:opacity-90 focus-visible:[&>svg]:opacity-90` buttons; close `hover:bg-destructive hover:text-white hover:[&>svg]:opacity-100`; inline SVG icons `size-2.5`, viewBox `0 0 10 10`: minimize `M0 5h10v1H0z`, maximize a rect with `rx 1.5`, restore two offset rects, close `m0.5 0.5 9 9m0-9-9 9`. Labels `aria-label` "Minimize", "Maximize"/"Restore", "Close". Maximize icon switches on `window.solar.window.onMaximizedChanged`. Pixel target (audit F-028, `chrome.captionGlyphs`): 10×10 glyphs centred at x 813.5 / 849.5 / 885.5, y 26.5, colour `#abaeae` over the panel.

6. **Mount.** Render exactly one `WindowChrome` at the `App` root (inside `ConnectionScope`, above `Dashboard`), so drag and the caption buttons exist in every connection state at once: the `Dashboard`, loading, startup-error, first-run, auth-failed and TLS screens all render below it. Its leading slot shows the "Solar" wordmark only when the connected shell is showing (a boolean prop from `Dashboard`'s state is not needed: render the wordmark always). Steps 4 and 9 reuse this instance and never add another. The state screens (Step 9) reserve `pt-10` for the 40px strip; the shell (Step 4) does not, because its panel starts at y=8 under the transparent strip and the panel header's `pt-8` puts the title cap at y=48 (`ref-07`).
7. **Bridges.** `SolarBridge.window` is required, so in the same step: add `window` to `installBridge` in `apps/desktop/src/renderer/test-support.tsx` (`minimize`, `toggleMaximize`, `close` return `Promise.resolve()`; `onMaximizedChanged(cb)` calls `cb(false)` immediately and returns a no-op unsubscribe), and add the same `window` object to `captures/local/ui-audit/harness/bridge.ts`. Run `npm run typecheck -w apps/desktop` and the harness `tsc` before leaving this step.

**Check:** run `node node_modules/electron/install.js` once (the Electron binary is absent), then `npm run dev -w apps/desktop`; the window shows no title bar or menu, keeps its 1px border and rounded corners, the buttons minimise/maximise/close, drag works from the top strip.

### Step 3 — UI primitives (audit F-008, F-011, F-014, F-015, F-016, F-031, F-033)

Create `apps/desktop/src/renderer/components/ui/` by copying from `M/components/ui/` and removing Motrix imports. Files and exact changes:

|File|Source|Changes|
|---|---|---|
|`button.tsx`|`button.tsx`|`cn` import from `../../lib/utils`; keep all variants and sizes. Views use `size="sm"` (32px) inside dialogs, cards and footers and the default 36px only in toolbars and panel headers (audit F-015, F-031: every button in the Windows references is 32px)|
|`input.tsx`|`input.tsx`|import path only|
|`switch.tsx`|`switch.tsx`|import path only|
|`dialog.tsx`|`dialog.tsx`|replace `CloseIcon` with lucide `X`; replace `useTranslation` close label with the literal `"Close"`; import `Button` from `./button`|
|`tabs.tsx`|`tabs.tsx`|import path only|
|`badge.tsx`|`badge.tsx`|import path only|
|`tooltip.tsx`|`tooltip.tsx`|import path only|
|`separator.tsx`|`separator.tsx`|import path only|
|`card.tsx`|`card.tsx`|import path only|
|`segmented-control.tsx`|`routes/dashboard/components/tile-segmented-control.tsx`|rename to `SegmentedControl`; generic over `T extends string`; props `{ value: T; onChange(v: T): void; options: { value: T; label: string }[]; ariaLabel: string }`|

New file `data-table.tsx` (used by Steps 6 and 7): container `overflow-hidden rounded-lg border border-border`; `<table className="w-full text-xs">`; `th` `sticky top-0 border-b border-border bg-background px-3 py-2 text-start text-[11px] font-normal uppercase text-muted-foreground`; `td` `px-3 py-2 align-middle`; `tr` `border-b border-border last:border-b-0`; no row hover. Export `DataTable` (container + table), `Th`, `Td`; `caption` stays a real `<caption className="sr-only">`. Pixel target (`ref-07`, `trackers.table`): an opaque `#0a0a0a` 33px header band, 11px/400 uppercase `#a1a1a1`, 32px rows plus a 1px 10%-white divider (pitch 33), container r 10 (audit F-017).

New file `native-select.tsx`: a `<select>` wrapper `NativeSelect` with props `Omit<ComponentProps<"select">, "size"> & { size?: "default" | "sm" }`. It destructures `size` and `className`, and forwards every other prop to the `<select>`. It renders `<div className="relative inline-flex"><select className={cn("h-9 w-full appearance-none rounded-md border border-input bg-input/30 ps-3 pe-9 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", size === "sm" && "h-8", className)} …/><ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div>`. Reason: three spec files assert on native `<option>` elements and `change` events (`DataQuality.spec.tsx`, `History.spec.tsx`, `SettingsReadings.spec.tsx`), so the data selectors stay native. Accepted consequence: the open popup is drawn by the OS in the OS font; the closed control uses Google Sans.

`size="sm"` gives the 32px height of the dialog selects in `ref-03` (audit F-031). `Input` gets `className="h-8"` in the same places (Motrix's `network-dialog.tsx` L338 does the same).

New file `status-tone.ts` (audit F-033): `export function statusTone(value: string): string` returning tone classes for a `Badge` `className`, after Motrix's tone map (`routes/plugins/lib/audience.ts` L35–40, 100-shade fill) with the text one shade darker where Motrix's 700 text sits at the 4.5:1 limit:
   - `RECONCILED` and `COMPLETE` → `bg-green-100 text-green-800`.
   - `UNRECONCILED`, `MAPPING_PROVISIONAL` and `ESTIMATED` → `bg-amber-100 text-amber-800`.
   - `RECONCILIATION_FAILED` → `bg-red-100 text-red-700`.
   - `UNAVAILABLE` → `bg-slate-100 text-slate-600`.
   - Any other string → `""`. Every call site renders `<Badge variant="secondary" className={statusTone(value)}>`, so unknown values keep the neutral secondary chip and known values override its colours.
   - Pixel target: the `ref-06` "Looks safe" pill is `#dbfce7`, 20px tall, with 12px/500 text. Motrix's `#008236` text on it measures 4.4957:1, below 4.5. Green-800 and amber-800 on their 100 fills measure 6.49 and 6.36:1; red-700 5.27:1; slate-600 6.92:1 (`measure/tone-contrast.json`).

Create `apps/desktop/src/renderer/components/ui/reason.tsx`:
```tsx
export function Reason({ reason, children }: { reason: string | null | undefined; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span data-reason={reason} tabIndex={0} />}>{children}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
```
(import `Tooltip`, `TooltipTrigger`, `TooltipContent` from `./tooltip`; use the export names that file defines.)

**Check:** typecheck and tests pass. Import each primitive once in a scratch render to confirm no runtime error; Base UI in jsdom needs no polyfill for these.

### Step 4 — Shell: sidebar, panel, toolbar (audit F-003, F-004, F-005, F-012, F-029, F-030)

Rewrite `Dashboard` in `apps/desktop/src/renderer/App.tsx` (the logic above `return` is unchanged). Keep `Tab` state, `tabs`, `dashboardStaleness` and all data hooks.

1. **Layout**, replacing the `<header>`/`<main>` markup:
   ```tsx
   <div className="app-sidebar-wrapper flex h-svh overflow-hidden bg-sidebar">
     {/* no WindowChrome here: the single root instance from Step 2 item 6 overlays this layout */}
     <aside className="app-sidebar-inner flex w-[12.5rem] shrink-0 flex-col px-2.5 pt-[55px] pb-4">
       <nav aria-label="Dashboard tabs" className="flex flex-1 flex-col gap-1">{4 nav items}</nav>
       <div className="mb-1 h-px bg-sidebar-border" />
       {Settings item}
     </aside>
     <main data-transparent={tab === "Overview"} className="m-2 ms-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-sidebar-inset shadow-sm data-[transparent=true]:bg-transparent data-[transparent=true]:shadow-none …">
   ```
   - Pixel targets (`ref-07`, `ref-09`, `ref-05`; audit F-003):
     - Sidebar 200px; nav pills 180×38 at x 10–189, the first at y 55–92, pitch 42.
     - Footer: a 1px 10%-white hairline at y=613 spanning x 10–189, 4px above the Settings pill (y 618–655, 16px above the window bottom).
     - Panel x 200–905, y 8–663 (no left margin; 8px top/right/bottom), r 14, `#0a0a0a` at 65% over the gradient (`#161e1f` at y=30).
     - On Overview the panel is transparent: the Motrix Dashboard has no panel (`router.tsx` L21 `transparentInset`; audit F-030).
   - Keep `aria-label="Dashboard tabs"` on `nav`, `aria-current="page"` on the active item, and each item a `<button type="button">` with the exact visible label (tests use `getByRole("navigation", { name: "Dashboard tabs" })` and `getByRole("button", { name: "Settings" })`). The Settings item sits after the hairline, outside the `nav`, so the navigation landmark holds the four view items; this satisfies `getByRole("button", { name: "Settings" })`.
   - Nav item classes (Motrix `SidebarMenuButton`): `flex h-[38px] w-full items-center gap-2 rounded-md px-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-active data-[active=true]:bg-sidebar-active` (label 14px/400 `#fafafa`; active fill = 14% white, `#475b5d` over `#294043` in `ref-07`). Icons (lucide, `size-4`): Overview `LayoutDashboard`, History `ChartLine`, Usage & Cost `ReceiptText`, Data Quality `ShieldCheck`, Settings `Settings`. Confirm each name is exported by the installed `lucide-react`; where one is not, use `Activity` for History and `ClipboardCheck` for Data Quality.
   - The sidebar wordmark slot (inside `WindowChrome` leading): text "Solar" in `text-sm font-semibold` with a lucide `Sun` icon `size-4`, centred on y≈27 like the Motrix wordmark row (x 18–61, y 22–31 in `ref-07`). The app name is not an `h1` (audit F-004).
2. **Panel.** Create `components/panel-shell.tsx` adapted from `M/components/desktop-kit/panel/panel-shell.tsx`.
   - Props: `{ title: string; actions?: ReactNode; headerClassName?: string; contentClassName?: string; children }`.
   - Header `flex shrink-0 items-center justify-between gap-4 px-6 pt-8 pb-3` merged with `headerClassName`; `h1` with `select-none text-2xl font-semibold tracking-tight`.
   - Actions slot `relative z-40 flex min-h-9 items-center gap-2 app-no-drag`.
   - Content `flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6` merged with `contentClassName`.
   - Each view renders inside `PanelShell` with its title (Overview, History, Usage & Cost, Data Quality, Settings). The existing `section aria-labelledby` + `h2` inside each view is replaced by the `PanelShell` `h1`; give the `h1` `id` `${slug}-title` so the `aria-labelledby` links remain.
   - Overview passes `headerClassName="px-2"` and `contentClassName="ps-2.5 pe-2 pt-4"` (Motrix `dashboard-page.tsx` L182–184: title at x=209, first tile row at y=104).
   - Pixel target for every other view: title 24px/600 at x=224 with its cap top at y=48 (`ref-07`).
3. **Toolbar pill** (audit F-029). Create `components/toolbar-group.tsx` adapted from `M/components/desktop-kit/toolbar/toolbar-group.tsx`: a `div` `toolbar-group app-no-drag flex h-9 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 p-0.5` with no `ToolbarGlass` child. Copy no `toolbar-glass.tsx`, `toolbar-glass.css` or `displacement-map.ts`, and no `backdrop-filter` anywhere.
   - Reason: the user's Motrix runs with `liquidGlassEffect: false`, so the references show this surface: `#0e1010` fill and `#1e2021` rim over the panel, 36px tall (`ref-08`, `downloads.toolbarPill`).
   - A separate round icon button sits 8px to the right where one exists (36px, same surface).
   - Use `ToolbarGroup` for the range/tariff controls in History and Usage & Cost (Steps 6 and 7).
4. **Connection chip.** In the panel header actions on every tab: `Badge variant="secondary"` (20px pill, `#262626`, 12px/500 as the `ref-08` status chips) with an 8px dot (`size-2 rounded-full me-2`; `bg-emerald-500` connected, `bg-amber-500` reconnecting, `bg-muted-foreground` connecting) and text exactly as today: `Connected · ${role}`, `Reconnecting`, `Connecting…` (the strings are unchanged), wrapped in `<span role="status">`.
5. **Stale behaviour.** `display.greyed && tab !== "Settings"` still applies `data-stale` to the content container (the `PanelShell` content div), with `data-stale:opacity-[.64] data-stale:grayscale`.
6. **State screens** that render instead of `Dashboard` (loading, startup error, first-run, auth failed, TLS mismatch) are restyled in Step 9; they render inside no shell.

**Check:** `npm test -w apps/desktop` (`connection.spec.tsx` uses the nav role and the Settings button); harness shows the sidebar, the transparent Overview panel, the 65% panel on the other views, and the chip.

### Step 5 — Overview and energy flow (audit F-016, F-019, F-010, F-030, F-033)

1. `components/Display.tsx` `Metric`: render a tile — `<div className="dashboard-tile flex min-h-0 flex-col gap-0 p-4 shadow-md/5 border-none">` containing `<dt className="text-[10px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase">`, `<dd className="text-[32px] leading-none font-semibold tabular-nums">`, detail `text-xs text-muted-foreground`. Keep the `dl > div > dt + dd` structure. The `title={reason}` on `dd` becomes `<Reason reason={reason}>{text}</Reason>` inside `dd`.
   - **Unit split** (audit F-030). When `text` contains a space and its last token has no digit, render `{head}{" "}<span className="text-xs font-normal">{unit}</span>`; otherwise render `text` whole. `textContent` stays identical ("−1,600 W", "64%", "—").
   - Motrix sets the number at 32px and the unit at 12px (`ref-09` "0 B/s"). At 32px Google Sans, "−1,600 W" is 136px as one string, wider than a 160px tile's 128px content box, and 109px split (`measure/kpi-fit.json`).
   - In this step change `components/EnergyFlow.spec.tsx`'s `expect(zero).toContain("0 W")` to `expect(zero.replace(/<[^>]+>/g, "")).toContain("0 W")`; the visible text contract is unchanged.
   - Pixel target (`ref-09`, `dashboard.tiles`): tile r 18, opaque `#1e1e1e` → `#161616` (the `.dashboard-tile` gradient over `var(--card)`), no border, label 10px/500 uppercase 0.04em `#a1a1a1` at 16px inset, number 32px/600.
2. `views/Overview.tsx` (inside the transparent panel from Step 4):
   - Grid `grid grid-cols-4 auto-rows-[160px] gap-4`; at 914×672 the cells are 160×160 with 16px gaps, x 210–897, first row at y=104, matching `ref-09`.
   - The flow diagram is a tile `col-span-2 row-span-2`; Solar, Home, Grid, Battery and Battery SOC are 1×1 `Metric` tiles; "Operating mode" is a tile `col-span-3` with its heading in the tile-label style; "Today's local-day energy" is a tile `col-span-4 row-span-2` holding its metrics in an inner `grid grid-cols-3 gap-4`.
   - Coverage `title=` spans become `<Reason reason={coverage}>`. Keep every visible string (`Coverage 0.04 %`, "last known", "at last response", `LIVE … server age`).
3. `components/EnergyFlow.tsx`: keep every class name (`flow-edge`, `flow-live`, `flow-strong`, `flow-normal`, `flow-idle`, `flow-node`) and the SVG structure. Remove the `energy-flow` outer border (tile provides it).
4. `Badge` replaces `.badge` / `.status-chip` spans anywhere they occur (Overview "Operating mode", Usage & Cost provenance). Badge text colour must reach 4.5:1 (audit S4 badge was 4.39:1): use `variant="secondary"` and the token colours; verify in Step 11C. The Overview `accountingStatus` badge is `<Badge variant="secondary" className={statusTone(data.accountingStatus)}>` (Step 3; audit F-033). Update the specs for `title=` → `data-reason` (Step 11A rows) in this step.

### Step 6 — Charts and History (audit F-018, F-012)

1. `components/Chart.tsx`: build and register the theme lazily — a module-level `let themeReady = false;` and a function `ensureTheme()` called inside the existing `useEffect` immediately before `echarts.init(node, "solar-dark")`. No `document`, `window` or `getComputedStyle` access at module evaluation (`DateEndpoints.spec.tsx` server-renders `History` in a Node environment). `ensureTheme()` resolves every colour to an explicit `rgb()`/`rgba()` string with a helper `resolve(css: string): string` that paints the value into a 1×1 canvas (`ctx.fillStyle = css; ctx.fillRect(0,0,1,1); getImageData`) and returns `rgba(r,g,b,a)`; ECharts/zrender parse only legacy comma-separated colours and cannot resolve `var()`. Inputs: palette `resolve("hsl(" + token("--chart-4") + ")")` for `--chart-4`, `--chart-2`, `--chart-1`, `--chart-3`, `--chart-5` (those tokens are bare `H S% L%` triplets), and `resolve(token("--foreground"))`, `--muted-foreground`, `--border`, `--destructive` (full colours) where `token(n) = getComputedStyle(document.documentElement).getPropertyValue(n).trim()`. Theme: `{ color: palette, backgroundColor: "transparent", textStyle: { fontFamily: token("--app-font-sans"), color: mutedForeground }, categoryAxis/valueAxis: axisLine, splitLine and axisLabel in border/mutedForeground, line: { lineStyle: { width: 1.5 } }, legend/tooltip textStyle: foreground }`. Replace the host `div` class `chart` with `className="h-[360px] w-full shrink-0"` and delete the `.chart` rule from `globals.css`.
2. `views/History.spec.tsx` mocks `../components/Chart` with only `Chart`; in this step extend that mock with `chartColor: (name: string) => "rgb(1, 2, 3)"` (valid, deterministic) and keep every series/data assertion. `views/History.tsx`: replace `#8dd6ff`, `#9be28a`, `#ffda91` with the resolved palette entries for `--chart-1`, `--chart-3`, `--chart-4` (SOC avg, min, max), exported from `Chart.tsx` as `chartColor(name)` (it calls `ensureTheme()` and returns the resolved string; `History.tsx` calls it inside its `useMemo`s, which run only in the browser — server-rendered tests receive the empty string `""` because `chartColor` returns `""` when `typeof document === "undefined"`); the gap `markArea` colour is `--destructive` resolved at alpha 0.16 through the same helper; legend colour comes from the theme. Series order and names unchanged.
3. Layout: each chart in a tile with the existing `h3` text as the tile label. Range, tariff and date inputs: `ToolbarGroup` in the `PanelShell` actions slot, using `NativeSelect` and styled date inputs (`Input`). Keep the label text ("Range", "Grid window tariff", "From", "Through") as `<label>` elements so `getByLabelText(/Range/)` still works.
4. The grid-by-window table uses the Step 7 table styling.

### Step 7 — Usage & Cost and Data Quality (audit F-010, F-014, F-017, F-031, F-033)

1. **Table pattern.** Use `components/ui/data-table.tsx` (created in Step 3). Replace every bare `<table>` in `History.tsx`, `UsageCost.tsx` (`BillingLineItems`, NEM lots), `DataQuality.tsx`, `Settings.tsx`. Keep `<caption>` elements (visually hidden `sr-only`) so table names remain.
2. **Billing periods** (`UsageCost.tsx`): the `.period-list` of `button[aria-pressed]` stays a list of buttons with `aria-pressed`, restyled as selectable rows (`rounded-md border px-3 py-2 text-start data-[pressed=true]:bg-accent`), not a `SegmentedControl`. Every selector a spec drives with `fireEvent.change` (Range and Grid window tariff in History, the Usage & Cost range, From/To reading in Data Quality) stays a `NativeSelect` (History.spec.tsx L119–121 changes Range through its `<select>`); `SegmentedControl` is not used in this step.
3. **Buttons.** All `<button>` in views become `Button` (`variant="outline"` unless the action is the main one in its form, then default) with `size="sm"` (32px, the size of every button in the Windows references; audit F-031). Keep every button's accessible name ("Load more readings", "Loading readings…", "More events", "More runs", "More periods").
4. **Lists** (`devices`, `policies`, `runs`) become `divide-y rounded-lg border` rows in tiles.
5. **Energy metrics** (`UsageCost.tsx`): the metric grid is `grid grid-cols-2 gap-4`. A kWh value such as "570.002 kWh" needs 147px even with the unit split (`measure/kpi-fit.json`), so these tiles are 2 cells wide, like the `ref-09` TRANSFER tile (336px).
6. **Status colour** (audit F-033): each `BillingStatus` value in the billing period rows and the collector `state` in Data Quality render as `<Badge variant="secondary" className={statusTone(value)}>`; reconciliation verdict strings render in a `Badge variant="secondary"`. The text of every value is unchanged.
7. **Labels and fields** (`.form-row`): `<label>` elements keep their text and nesting (tests use `getByLabelText("From local day")`, `"Through local day"`, `"From reading"`, `"To reading"`); controls inside use `Input` / `NativeSelect`. Fields inside tiles and cards are 32px (`NativeSelect size="sm"`, `Input className="h-8"`; audit F-031); controls inside a `ToolbarGroup` keep the default 36px.
8. **Copy.** Do not change any visible string.

### Step 8 — Settings as a category grid with dialogs (audit F-013, F-031)

1. Rewrite `views/Settings.tsx` return into `PanelShell title="Settings" contentClassName="px-0 pb-0"` (Motrix's `PanelShell` content has no horizontal padding, so the grid's own `px-6` gives the measured x positions) with a 3-column hairline grid, adapted from `M/routes/settings/settings-page.tsx` L20 and `cards/settings-card.tsx` L22–40:
   - Grid `grid h-full grid-cols-2 items-stretch border-t-[0.5px] px-6 py-4 min-[914px]:grid-cols-3`; cells `border-b-[0.5px] border-border` except the last row.
   - Cell `group flex h-full min-h-33 flex-col items-start px-5 py-3 text-start min-[914px]:min-h-[170px] min-[914px]:px-6 min-[914px]:py-4`; text block `pt-3 ps-1 min-[914px]:pt-6`.
   - Title `text-sm font-semibold text-foreground`; description `line-clamp-2 pt-1.5 text-xs text-gray-400 min-[914px]:pt-2`. The description is `#99a1af` grey, not `--muted-foreground`.
   - Icon `max-h-16`.
   - Pixel target (`ref-05`, `settingsGrid`): the top hairline spans the panel at y=88; row hairlines are inset 24px (x 224–881) at y=285 and y=467 with no vertical rules; titles 14px/600 at x 252 / 471 / 690.
2. **Tiles** (always rendered; `Dialog` opens on click; dialog content mounts only while open):

   |Tile title|Description|Fluent Emoji 3D icon|Content (existing cards moved intact)|
   |---|---|---|---|
   |Connection|Backend URL, pinned fingerprint|`Electric plug`|card "Connection" (including the forget-connection action)|
   |Tariffs|Tariffs, holidays and monthly rates|`Money bag`|every card whose `h3` contains "tariff", "holiday" or "rate" (read-only cards for all roles; Create tariff, tariff JSON editor, monthly-rate and holiday editors for ADMIN)|
   |Billing|Billing periods|`Receipt`|cards with "Billing" in the `h3` (the list and its ADMIN editor)|
   |Accounting|Accounting policy|`Abacus`|cards with "policy" in the `h3`|
   |Exclusions|Data exclusions|`No entry`|cards with "exclusion" in the `h3`, including the ADMIN create action, plus the **exclusion half** of the "Delete entries" card (Data exclusion ID field and "Delete exclusion" button)|
   |Meter readings|Utility readings|`Bar chart`|cards with "reading" or "Meter" in the `h3`, including save, plus the **reading half** of the "Delete entries" card (Meter reading ID field and "Delete reading" button)|

   Check each emoji exists in `microsoft/fluentui-emoji` (`assets/<Name>/3D/<snake_name>_3d.png`); if one does not, use `Gear` for it.
   Admin gating is unchanged: `isAdmin(role)` still controls every mutating form. The role text "VIEWER access" and "Role could not be verified" keep rendering in the panel header actions (as a `Badge`).
3. **Icons.** Download the six PNGs into `apps/desktop/src/renderer/assets/settings-icons/<tile-slug>.png` (display size 52px; use `Electric plug`, … at the 3D `.png` resolution available; no scaling beyond `width={52} height={52}`). Import them with Vite `import url from "./x.png"` (the CSP `img-src 'self' data:` already allows them).
4. **Dialog.** Adapt `M/routes/settings/cards/general-dialog.tsx`: `DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[700px]"`, header `shrink-0 px-6 pt-6` (title + description), scroll body, `Separator my-4` between groups, rows `flex items-start justify-between gap-4`, footer `shrink-0 border-t border-border px-6 py-4` with a single outline "Close" `Button size="sm"` (the existing actions save through their own form buttons, so there is no Cancel/Save pair). Controls inside rows are 32px: `Button size="sm"`, `NativeSelect size="sm"`, `Input className="h-8"` (audit F-031). Pixel target (`ref-03`, `dialog`): 700×571 at 914×672, r 14, `#171717` with a 10%-white ring over a black-20% overlay; title 14px/500; description 14px `#a1a1a1`; group heading 14px/600; row label 14px/500; helper 12px `#a1a1a1`; footer 64px.
5. The JSON editors (`<textarea>`) keep their labels ("… JSON"), validation (`validateTariffJson`) and `mutate()` calls unchanged; textarea styled like `Input` (`font-sans text-xs tabular-nums`).
6. `MeterReadingsPager` ("Load more readings") unchanged in behaviour and name.
7. **Feedback placement.** The shared `message` state and its `Message` render (old `Settings.tsx` L176–183, L660) move into the scroll body of whichever dialog is open (top of the body); keep a copy rendered on the grid only while no dialog is open. `MutationEditor` keeps its own message inside its form. The "Delete entries" card is split as listed in the tile table, keeping its handlers (`setDeleteReading`, `setDeleteExclusion`, `window.confirm` calls) and state; the `Select #N for deletion` buttons in the readings list keep working because both live in the Meter readings dialog.

### Step 9 — State screens and banners (audit F-021, F-022)

1. Create `components/onboarding-surface.tsx`: a full-window `div` `relative flex h-svh flex-col items-center justify-center overflow-hidden bg-[#161617] p-6 pt-10` (dark value from `M/components/onboarding/onboarding-surface.tsx`; `pt-10` keeps the 40px drag strip of Step 2 item 6 clear) containing a `Card` `w-full max-w-[560px] gap-4 p-6`, (no second `WindowChrome`: the root instance from Step 2 provides the caption controls).
2. Use it for: loading, startup error, `FirstRun` (3-step list as numbered `Badge`s, "Probe certificate" primary `Button`, fingerprint block `rounded-md border bg-muted/50 p-3 font-sans text-xs tabular-nums break-all`), `TokenEntry`, AUTH_FAILED and TLS_MISMATCH screens. Keep every heading, label, button name and message string. The Forget-connection button is `variant="outline"`.
3. `ConnectionNotice` (`components/Display.tsx`): replace the orange full-width `.notice` with `role="status"` `flex shrink-0 items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground`, placed above the panel content, text unchanged ("6 min ago", "Collection runs on the NAS independently of this app."). Give it `data-slot="connection-notice"`.
4. `Message` (`Display.tsx`): same muted style with a `border-s-2 border-amber-500` accent instead of `.message`.

### Step 10 — Accessibility fallbacks, tooltips, empty states (audit F-023, F-024, F-025)

1. Solid fallbacks: confirm `sidebar.css` carries the `@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)` and `@media (forced-colors: active)` blocks, and add `.toolbar-group { background: var(--background); }` to the first block there: the pill's 70% fill becomes solid, as Motrix `toolbar-glass.css` L61–66 does for its surface (audit F-024). In `globals.css`, after the copied `.dark .dashboard-tile` rule, add `@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .dark .dashboard-tile { background: var(--card); } }`: equal specificity and later source order, so the tiles lose their gradient.
2. Replace every remaining `title={…}` attribute used as a hint (`History.tsx` coverage and window cells, `UsageCost.tsx`, `SettingsReadings` export-not-provided cell, `Display.tsx` `Metric`, `DataQuality.tsx` `numericReason` cells) with `<Reason reason={…}>`. `Reason` keeps the text reachable: it renders `data-reason`, `tabIndex={0}` and the tooltip content.
3. Empty states (audit F-023):
   - A whole empty view renders a centred title `text-lg font-medium tracking-tight` (18px/500, as "No downloads yet" in `ref-08`) with a hint `text-sm text-muted-foreground` (14px `#a1a1a1`) below it.
   - An empty list inside a tile (no tariffs, no events, no periods) renders `rounded border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground` (the `ref-02` "No extensions connected yet." box; Motrix `browser-extensions-section.tsx` L109).
   - Reuse the existing empty strings where present.
4. Keep: `aria-current`, chart `role="img"` + `aria-label`, labelled inputs, `prefers-reduced-motion` (flow lines stop).

### Step 11 — Tests, harness migration, packaged verification (all)

**A. Existing tests.** Each row is changed in the same step as its production change (Steps 5, 8, 9, 10); this table is the final gate. Keep the observable contract; update only what the redesign changes. All `title=` expectations become `data-reason=` expectations without coupling to neighbouring markup (no `</td>`).

|Spec|Change|
|---|---|
|`views/Overview.spec.tsx`|`toContain('title="0.0003531947983836499"')` → `toContain('data-reason="0.0003531947983836499"')`; `flow-live`, `Coverage 0.04 %`, `last known` assertions unchanged|
|`components/EnergyFlow.spec.tsx`|`title="METER_LINK_DOWN"` → `data-reason="METER_LINK_DOWN"` (positive and the `not.toContain` assertion); `expect(zero).toContain("0 W")` → `expect(zero.replace(/<[^>]+>/g, "")).toContain("0 W")` because `Metric` puts the unit in its own span (Step 5); `flow-*` classes, `2,000 W`, `role="status"`, `6 min ago` unchanged|
|`views/UsageCost.spec.tsx`|every `title="X"` → `data-reason="X"` (`MISSING_GRID_DATA`, `0`, `MONTHLY_RATE_MISSING:AFA · billing month 2026-10`, `Not applicable`); negative assertions `not.toContain('title="2026-10">—')` → `not.toContain('data-reason="2026-10"')` and `not.toContain('title="OK">—</td>')` → `not.toContain('data-reason="OK"')`; `coverage 0 %` unchanged|
|`views/SettingsReadings.spec.tsx`|every test first clicks the "Meter readings" tile (`fireEvent.click(await screen.findByRole("button", { name: /Meter readings/ }))`) before querying "Meter reading ID", "Delete reading", "Save meter reading", "Load more readings" or the VIEWER row; `within(row).getByTitle("Export reading not provided")` → `const exported = row.querySelector('[data-reason="Export reading not provided"]'); expect(exported).not.toBeNull(); expect(exported?.textContent).toBe("—");`|
|`views/Settings.spec.tsx`|add `// @vitest-environment jsdom`, `installBridge` and `cleanup` (the file currently server-renders); VIEWER: closed grid contains `VIEWER access`; open "Tariffs" and assert `Tariff holidays` present and the `TNB RP4 ToU + NEM template` and `Create tariff` text absent; open "Meter readings" / "Exclusions" and assert `Save meter reading` / `Delete exclusion` absent. UNKNOWN: `Role could not be verified` shown, `Create tariff` absent after opening "Tariffs". ADMIN: open "Tariffs" → `TNB RP4 ToU + NEM template` present; "Meter readings" → `Save meter reading` present; "Exclusions" → `Delete exclusion` present|
|`connection.spec.tsx`|`openSettings` also clicks the dialog needed by each test ("Tariffs" for the tariff tests, "Meter readings" for the reading tests); after the `NOT_CONFIGURED` remount in the reading and tariff tests, re-open the same dialog before asserting. All cache, epoch and call-count assertions stay|
|`views/History.spec.tsx`|only the `../components/Chart` mock gains `chartColor: () => "rgb(1, 2, 3)"` (Step 6); series/data assertions unchanged|
|`views/DataQuality.spec.tsx`, `views/DateEndpoints.spec.tsx`, `api.spec.tsx`|unchanged (native selects, labels, roles, `History` stays server-renderable because `Chart` touches the DOM only in an effect)|

Delete no test.

**B. Harness migration** (`captures/local/ui-audit/harness`):
- `index.html`: `<html lang="en" class="dark">`.
- `vite.config.ts`: add `import tailwindcss from "@tailwindcss/vite"` and `plugins: [react(), tailwindcss()]`.
- `bridge.ts`: `window.solar.window` was added in Step 2; keep it.
- New role map in `captures/local/ui-audit/roles.json`: windowBg `body`; navContainer `.app-sidebar-wrapper`; navActive `nav [aria-current="page"]`; navInactive `nav button:not([aria-current])`; panel `main`; pageTitle `main h1`; card `.dashboard-tile`; cardLabel `.dashboard-tile dt`; kpi `.dashboard-tile dd`; mutedText `main .text-muted-foreground`; segmented `[role="radiogroup"]`; primaryButton `[data-slot="button"][data-variant="default"]`; outlineButton `[data-slot="button"][data-variant="outline"]`; input `[data-slot="input"]`; select `select`; switch `[data-slot="switch"]`; tableHeader `th`; tableCell `td`; chip `[data-slot="badge"]`; dialogGroupHeader `[data-slot="dialog-content"] h3`; rowLabel `[data-slot="dialog-content"] label`; helperText `[data-slot="dialog-content"] p`; banner `[data-slot="connection-notice"]`. Dialog controls and tables are measured with the document-wide selectors above (dialogs portal outside `main`); measure each screen with the dialog open where the screen definition below says so.
- Re-run `node node_modules/typescript/bin/tsc --noEmit -p captures/local/ui-audit/harness/tsconfig.json`.

**C. Re-capture and re-score.** Repeat the audit captures at 914×672 with the harness, saving to `docs/ui-audit/img/redesign/` and `captures/local/ui-audit/measure/redesign/`. Same scenarios and waits as the audit except:
- S1, S2, S3, S5, S9–S12: same actions (S4's period click targets the first selectable row, the `button[aria-pressed]` inside the billing list; S2 waits for `[data-slot="connection-notice"]`).
- S6: same (From reading `1`, To reading `12`; the `NativeSelect` `select` elements keep their labels).
- S7: the closed Settings grid.
- S8: the open "Tariffs" dialog with tariff #1 selected in "Inspect tariff", scrolled to the "Holidays in" heading.
- Interaction records: hover on a nav item, the first `[data-slot="button"]`, and the first `tbody tr` of the Data Quality tab; focus via Tab on S1; reduced-motion and reduced-transparency emulation (the sidebar must switch to its solid fallback).
- Re-score all pairs with the audit's rubric and matrix against the Windows references (`docs/ui-audit/img/ref-01` … `ref-09`, pairs as in audit Section 3).
- Pixel spot checks against `measure/motrix-ref-pixels.json` (±2 levels per channel, ±1px; read pixels from the capture with the same PNG decode):
  - Sidebar at (195, 300) `#25393c`.
  - Panel at (500, 30) `#161e1f` on History.
  - Overview first tile row at y=104 with 160px cells.
  - Active nav pill 180×38 at x=10.
  - Caption glyph colour `#abaeae`.
  - Dialog 700px wide, `#171717`.

**D. Typeface check** (914×672): every measured text role's `font-family` starts with `"Google Sans Variable"` (including the JSON editors, the fingerprint block and `code`/`pre` elements); `await document.fonts.load('14px "Google Sans Variable"')` returns at least one face; no text role has `scrollWidth > clientWidth`. Overflow fixed by widening the container (Motrix's type sizes stay unchanged). If a view cannot fit 914px width without horizontal scrolling, record the width needed and set the Step 2 window size to it.

**E. Packaged build** (separate prerequisite from the harness):
1. `npm run package -w apps/desktop` rebuilds `apps/desktop/release/win-unpacked`.
2. Launch that exe with `--user-data-dir=D:\Github\house-solar-monitoring\captures\local\ui-audit\solar-profile-redesign` and `--remote-debugging-port=9334` through `hub` op `start`; confirm the CDP listener's owner is the started PID.
3. In the renderer: `await document.fonts.load('16px "Google Sans Variable"', 'Solar')` returns at least one face; `getComputedStyle(document.querySelector("h1")).fontFamily` starts with `"Google Sans Variable"`; each settings icon `img.decode()` resolves.
4. Only if a request for the font or a PNG demonstrably fails: extend the `types` map in `apps/desktop/src/main/security.ts` with `".woff2": "font/woff2"` and `".png"` stays, `".webp": "image/webp"`. Diagnose the failing request first.
5. Capture the first-run screen (window chrome visible) into `docs/ui-audit/img/redesign/solar-S13-native.webp`; confirm outer minus inner height is 0 (hidden title bar), and that the OS capture shows the 1px DWM border and 8px rounded corners (`window.dwmBorder`, `window.corners`).
6. Stop the hub process afterwards.

### Step 12 — Polish (audit F-019, F-020, F-026, and any S3 left by Step 11 re-scoring)

- Hover/active/transition tokens on nav items, buttons and tiles (`transition-all`, Motrix durations: dialog 100ms, sidebar 200ms linear), `motion-reduce` honoured.
- Confirm every text role ≥ 4.5:1 (the S4 detail badge was 4.39:1).
- Remove `apps/desktop/src/renderer/styles.css` references (deleted in Step 1) and any unused class names left behind in TSX.

## Critical files & anchors

- `apps/desktop/src/renderer/App.tsx` — `Dashboard` return (header/main markup) is replaced; state screens L125–188, L252–300 restyled.
- `apps/desktop/src/main/index.ts` — `createWindow` options L18–29; `apps/desktop/src/main/ipc.ts` — add the window channels beside `authorize`.
- `apps/desktop/src/renderer/views/Settings.tsx` (663 lines) — the largest restructure; admin-gated forms and `mutate()` stay.
- `apps/desktop/src/renderer/components/Display.tsx` and `Chart.tsx` — `Metric`/`ConnectionNotice`/`Message` and the ECharts theme.
- `D:/Github/Motrix/src/renderer/styles/globals.css` (`.dark`, `.dashboard-tile` L395–410) and `styles/sidebar-color.css` (L39–151, L238–255) — copied token and sidebar gradient sources.
- `captures/local/ui-audit/measure/motrix-ref-pixels.json` and `docs/ui-audit/img/ref-*.webp` — the Windows pixel targets quoted in Steps 1–11.

## Verification

1. **Static.** From the repo root: `npm run typecheck -w apps/desktop`, `npm test -w apps/desktop` (84 tests at the last recorded run, all passing after Step 11A), `npm run build -w apps/desktop`.
2. **Harness visual.** Step 11C:
   - S1 shows the sidebar and the Overview tiles directly on the shell gradient (no panel); the other views show the 65% panel.
   - S3 shows the themed chart with the shaded gap; S7 opens as a category grid; S9 shows the onboarding card.
   - The pixel spot checks pass.
   - Re-score: the image-backed pair mean must reach ≥ 2.5/3 (≥ 83/100), no scored dimension below 2 on any image-backed pair, every S1 finding resolved.
3. **Typeface.** Step 11D checks pass.
4. **Packaged.** Step 11E: the redesign `solar-S13-native.webp` shows no OS title bar or menu; outer − inner height = 0; Google Sans loads from the packaged `app://` origin.
5. **Behaviour.** In the harness: reconnecting scenario shows the muted banner and the greyed content with no flow animation; wrong-role scenario (change `ViewerRole`/CONNECTED role to VIEWER in `bridge.ts`) hides admin forms; Settings dialogs save through the same `mutate` calls (harness answers "harness: read-only", shown as the existing error message).
6. **Licences.** `apps/desktop/THIRD_PARTY_NOTICES.md` contains Motrix MIT, Fluent Emoji MIT and Google Sans OFL texts; no file from the "never copy" list exists in the repo (`glob` for `icon-*.webp`, `speed-*.webp`, `SFNS-Regular.ttf` returns nothing under `apps/desktop`).

## Assumptions & contingencies

- **Reference images.** The nine Windows captures are in `captures/local/ui-audit/reference/` (mapping in `MAPPING.md`) with lossless copies in `docs/ui-audit/img/ref-*.webp`; the macOS screenshots are supplementary only. The onboarding window has no capture, so Step 9's surface follows Motrix source (`onboarding-surface.tsx`) and the `ref-03` dialog card styling.
- **Toolbar material.** The references show Motrix with `liquidGlassEffect: false` (the user's settings), so the toolbar uses the non-glass fallback surface: 70% `--background`, no blur, no glass child (Step 4). Glass would contradict what the user sees on Windows.
- **`NativeSelect` instead of Base UI `Select`.** Three spec files assert on native `<option>` elements; swapping to Base UI `Select` would require rewriting them. The open native popup uses the OS font. If you want Base UI `Select` everywhere, rewrite `DataQuality.spec.tsx`, `History.spec.tsx` and `SettingsReadings.spec.tsx` to drive it and replace `NativeSelect` usages.
- **Base UI in jsdom.** If a primitive throws in a spec (for example a missing `ResizeObserver`), add `globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }` to the spec's setup file; do not mock Base UI.
- **Missing lucide export or Fluent Emoji asset.** Use the stated fallback (`Activity`, `ClipboardCheck`, `Gear`); record the substitution in the commit message.
- **914px width.** If Step 11D finds horizontal overflow at 914px, raise the window default and minimum width to the measured need (Step 2 values), not the type scale.
