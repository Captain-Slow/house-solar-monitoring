# Open decisions and remaining work

Status as of 2026-10-25, after commits `f4b8dff` and `3a40537`. The software-side contract fixes are done and
verified locally (synthetic data only). Nothing below is closed by that work. Acceptance wording lives in
`SOLAR_MONITORING_PLAN.md` (recorded acceptance snapshot) and `docs/operations.md`.

## A. Decisions needed from the owner

- [ ] **Uncommitted desktop redesign.** The working tree holds work that is not part of the contract fixes:
  modified `apps/desktop/**`, `package-lock.json`, `packages/contracts/src/bridge.ts`, new components
  (`components/ui/`, `lib/`, `styles/`, `assets/`, window chrome and panels), `DESKTOP_LIQUID_GLASS_REDESIGN_PLAN.md`,
  `DESKTOP_UI_AUDIT_PLAN.md`, `docs/ui-audit/`, `apps/desktop/THIRD_PARTY_NOTICES.md`. Decide: review and commit,
  stash, or discard. It changes dependencies (lockfile), so review before committing.
- [ ] **`PLAN_MODE_PROMPT.txt`** (untracked; the plan cites it as the original requirements and hardware ground
  truth). Decide: commit it as the requirements record, or add it to `.gitignore`.
- [ ] **Line endings.** Git warns "LF will be replaced by CRLF" (local `core.autocrlf`). Decide whether to add
  `.gitattributes` rules. Current convention: `SOLAR_MONITORING_PLAN.md` and `docs/operations.md` are CRLF,
  `docs/field-mapping.md` is LF-only.
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

- [ ] **G0-G2:** wired Ethernet path to the gateway stick (client bridge next to the stick, after consulting the
  installer), DHCP reservation, record the wired IP. Collector stays disabled until then.
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
logs; shipping collector stays disabled until G0-G2 pass; `LEDGER_ALGO_VERSION` = 3 and
`BILLING_CALC_VERSION` = 2 change only with an explicit decision and a recompute plan.
