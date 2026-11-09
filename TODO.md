# Open decisions and remaining work

Status as of 2026-11-09, after commit `f7dc890`. Backend and deploy files are unchanged since `3a40537` (2026-10-25):
the contract fixes are done and verified locally on synthetic data only, and apart from line endings nothing in A-C is closed.
Next owner decision: C1, the cloud credential path (F). Acceptance wording: `SOLAR_MONITORING_PLAN.md`, `docs/operations.md`.

## A. Decisions needed from the owner

- [x] **Desktop redesign work.** Resolved: it was committed by a separate session as `c12d20c` and `d5471ae` (already on `origin/main`). The only leftover untracked `DESKTOP_UI_AUDIT_PLAN.md` was purged on 2026-10-25. The redesign commits themselves were not reviewed or tested by this contract-fix work; review them separately if needed.
- [x] **`PLAN_MODE_PROMPT.txt`.** Purged on 2026-10-25 (owner decision). A backup of both purged files is outside the repo at `D:/Github/_house-solar-purged-backup-2026-10-25/untracked.tar`; delete it when no longer wanted. No tracked doc referenced it; the plan and `docs/field-mapping.md` are now the record.
- [x] **Line endings.** Resolved 2026-11-09. Every tracked text blob was already LF; the CRLF files were `core.autocrlf=true`
  checkout artifacts. Root `.gitattributes` now sets `* text=auto eol=lf` (`*.png` and `*.webp` binary), the redundant
  `apps/backend/.gitattributes` is removed and the CRLF working-tree files were converted. Renormalizing changes no blob.
- [ ] **Billing after a policy change.** Migration 0006 does not invalidate stored `BillingPeriodResult` rows.
  If the accounting policy is switched to `METER_PER_PHASE`, request a recalculation so coverage and status
  follow the new per-phase coverage. Legacy ledger rows keep NULL `gridPhaseCoveredSec` and fall back to
  `gridCoveredSec` until recomputed.
- [ ] **Shared `GRID_GAP` flag.** It is raised by a gap in the total or any phase, so it can over-report a gap
  for the active candidate (never hides one). A per-candidate flag would need a new flag bit; decide only if
  this matters in practice.
- [ ] **`monitoringSince` is null until the first ledger pass.** After the first samples, `collectorStatus`
  reports `policyVersion` 0 and `monitoringSince` null for up to about 60 s until the worker seeds policy v1
  (the desktop shows a dash). Accept, or have the first ingest seed the policy.

## B. Needs site access or hardware (plan gates still open)

- [ ] **G0-G2 (wired Modbus track; deferred 2026-11-09, see F):** wired Ethernet path to the gateway stick (client bridge
  next to the stick, after consulting the installer), DHCP reservation, record the wired IP. Modbus collector stays disabled.
- [ ] **NAS deployment and runtime acceptance:** V10, V11, V12, V20 against real datasets and a natural 03:30
  backup. The scripted local variants (`verify-restore.sh`, `verify-v19.sh`, `verify-v20.sh`) passed on
  2026-10-25 but are not NAS acceptance.
- [ ] **G3 / G5 / G6:** confirm CT signs and placement, meter cadence, counter-versus-integration ratios, and
  run the at least 7-day EXIF-timed TNB meter-reading comparison (V16, V17). Until then `METER_NET` (register
  1814) versus `METER_PER_PHASE` is a software contract, not verified physical accuracy, and no policy
  promotion or `validated` flag may be set.
- [ ] **V18:** supply a real redacted TNB bill (see `docs/operations.md`, "Verifying a tariff against a bill");
  synthetic fixtures never satisfy it.
- [ ] **V13-V15:** live UI/API/gap comparison, packaged-desktop re-check of the current source, and an
  authorized NSIS build, install, restart, upgrade and uninstall.
- [ ] **V23-V25 gaps:** OS-kill boundary acceptance with a nonempty pre-outage buffer, a complete absent
  battery/meter reconnect variant, and the default 15 s lease / 18 s takeover scenario.

## C. Known non-blocking gaps

- [ ] `powerSeries` fallback grids (`bucketSeconds` a multiple of 300 s beyond 86400 s) render fractional-day
  labels in the desktop `bucketLabel`. Cosmetic.
- [ ] `energyTotals.monitoringSince` still falls back to the earliest retained Sample when no policy exists,
  while `collectorStatus.monitoringSince` is null in that state (intentional, documented).
- [ ] Test gaps noted in review, not defects: no pre-epoch case for the series grid; the `phase2-exit` null
  check relies on the 60 s ledger tick; the restore-drill fixture uses `METER_NET`, so it checks phase-column
  persistence rather than `METER_PER_PHASE` API semantics.
- [ ] If any hardware discovery contradicts the current mapping, update `docs/field-mapping.md` first, then the
  plan; do not recalibrate automatically.

## D. Hard boundaries to keep

Monitoring-only (no inverter, battery, gateway, router or account changes); no credentials in chat, files or
logs; the shipping Modbus collector stays disabled until G0-G2 pass (the cloud track has its own gates, section F);
`LEDGER_ALGO_VERSION` = 3 and `BILLING_CALC_VERSION` = 2 change only with an explicit decision and a recompute plan.

## E. Solar UI redesign (design finished, implementation not started)

Mockup batches 1-12, owner decisions D01-D23, 288 reviewed strings and the implementation plan are committed in
`docs/design/redesign/` and `SOLAR_UI_REDESIGN_PLAN.md`. Nothing in the implementation plan is built; each slice needs an
explicit "implement" from the owner.

- [ ] **Slices S0-S9** (`docs/design/redesign/IMPLEMENTATION-PLAN.md`: 49 sized work packages plus 3 verification packages,
  about 70 engineer-days, survey-grade). S0 (preflight) can start alone; the critical path is S0, S1, S2, S7. Start
  conditions (section 9 there): the verification driver (default: no new dependency, or approve `playwright-core`), the
  contract-fit audit (WP0.2), the owner's veto window on D23 (one extra `Tariffs` request per Usage & Cost mount) and a
  working reviewer (`reviewer-openai` is unusable here: its model is rejected by the Codex account; use `reviewer-claude`).
- [ ] **Accept the four safe fixes S1-S4** (plan Part C, commits `fad5754` and `e1fc0c6`; not the same as slices S1-S9).
  Rendered checks so far are partial (Chrome and Electron's Chromium against a synthetic harness). Still open: the
  packaged Windows app, 200% text and 914x672 reflow, scrolled-region focus stops, dialog focus restoration, forced colors,
  S3 invalid and disabled states, the stale-frame chart canvas, and the native date/month picker Tab stop, which shows no
  focus indicator.
- [ ] **Rebuild the installer.** The only built installer (`apps/desktop/release/House Solar Monitoring Setup 0.1.0.exe`,
  2026-10-25) predates S1-S4.
- [ ] **Gated, no work scheduled:** `requestRecalculation` (D06), brand packaging (D19), native icon export (D20), web and
  native clients (R-client), the cloud UI frames (A12.13; they follow the A1 backend contract, see F), and findings F1 (the
  window waits up to 10 s for the connection check), F2 (Forget can leave the token on disk) and F4 (the flow animation has
  no in-app pause; WCAG 2.2.2 is an open question). Trademark clearance of "Solar" (D18) is also open.

## F. Data-source track (owner decision 2026-11-09: cloud first)

Decided: the read-only cloud stopgap (plan Amendment A1) is built first. The wired Modbus path is deferred, not dropped, and
stays the target source. This changes the order set on 2026-10-17, not A1's binding limits. Nothing is implemented: A1 stays
plan-only until C1 and C2 pass and the owner says "implement".

- **Accepted consequences.** Cloud data is vendor-reported: about one snapshot per 5 minutes and no measurement timestamp.
  It never enters the ledger, reconciliation or billing (A1 limits 1-3), so real accounting, TNB cost and meter
  reconciliation stay unavailable until a wired path passes G0-G2. The endpoints are unofficial and undocumented, so they
  can break with an app update and carry terms-of-service risk. Still forbidden: any write or control call, any inverter,
  battery, gateway, router or account change, credentials in chat, files or logs, and (without a separate yes) TLS
  interception, rooting or ADB.
- [ ] **C1 credential path (first gate, owner decision).** Proposal, needs your yes: the S-Miles credential lives only in a
  NAS secret file that you enter on the NAS (the `db_password` pattern, `docs/operations.md` section 2), mounted read-only
  into the backend and never in chat, repo, compose file or logs; use a dedicated viewer account if S-Miles offers one
  (unverified).
- [ ] **C2 contract verification.** Proposal: a read-only probe, like the Modbus Phase 1.8 probe, that you run on your PC
  with your credential. It calls only allowlisted read routes and writes a redacted capture for review; I write it, you run
  it, I never log in. The field map and cadence come from that capture (plan A1, C2).
- [ ] **A1 implementation plan** (documentation first, as for the redesign). A1 touches the backend (migration
  `CloudSnapshot`, `CloudCollector`, allowlisted client, `COLLECTOR_SOURCE=CLOUD`, log redaction), the GraphQL contract
  (`vendorLive`, `vendorDaily`, `Freshness.SNAPSHOT`) and the desktop (A12.13 frames and a 60 s `vendorLive` poll, a new timer
  that the redesign's P1 invariant does not yet approve), with acceptance VC1-VC5.
- [ ] **NAS deployment** (common to both tracks; VC1 needs 24 h of NAS data). D0 passes; still needed: pool name, NAS LAN IP,
  free RAM and disk, and a GHCR `read:packages` token entered only in the TrueNAS registry sign-in (plan "User inputs" 2-3).
  The stack can be installed with collection disabled (`docs/operations.md` section 1).
- [ ] **Checkpoint 2026-12-07** (chosen: 4 weeks; a prompt to re-decide, not a deadline). If the wired path has not
  passed G0 by then, re-decide wired versus cloud, looking at where C1, C2, the A1 plan and the installer or bridge each stand.
- **Wired path meanwhile.** The first step costs nothing and changes nothing: match the stick's MAC to its label (the Wi-Fi
  refusal of 2026-10-17 was recorded against an unconfirmed device; plan Phase 0 step 1 and A1 Evidence). The installer
  questions are in the plan ("User inputs" 1 and 6, "Assumptions and contingencies"): may a client bridge be attached,
  does Modbus TCP on the Ethernet port need enabling, and where the CTs sit and which way they face.

## G. Housekeeping

- [ ] **Mockup frames are outside the repo.** Batches 1-12 (about 520 MB of PNG and HTML; the decision documents cite
  frame IDs such as B12-43) exist only in
  `%LOCALAPPDATA%/Temp/claude/D--Github-house-solar-monitoring/5dcbc0dc-0edb-442c-9d0f-8da73cadad4b/scratchpad/` and in the
  Claude Design canvases. Archive them somewhere durable, or accept losing them.
- [ ] **The rendered-verification harness is not versioned.** It lives in `captures/local/ui-audit/harness` (`captures/` is
  gitignored), so it exists only on this machine; the implementation plan's WP0.3 extends it.
