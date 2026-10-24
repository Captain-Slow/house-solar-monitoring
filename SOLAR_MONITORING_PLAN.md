# House Solar Monitoring: Implementation Plan

## Context

Build a monitoring-only system for the user's Hoymiles hybrid installation: inverter HIT-10L-G3 (firmware V01.05.02), battery LB-16D-G3 (V03.00.01.03), and gateway DTS-WL-G3 (V03.00.19).
- **Backend.** NestJS + Prisma + GraphQL + PostgreSQL, intended to run 24/7 in Docker on TrueNAS. The implemented backend owns collection and independent household-usage/TNB-cost calculation; NAS deployment and autonomy acceptance remain pending.
- **Why independent totals.** The installing technician says the S-Miles app's **grid import/export totals** are inaccurate. The app's numbers are therefore never the source of truth.
- **Dashboard.** A Windows Electron app using only the backend API, including authorized administration of monitoring data and tariff/accounting configuration. It never owns collection or the database and never controls the inverter, battery or gateway.
- **Repository state.** The repository now has commits (user-reported). The Modbus collector, persistence, accounting, billing, shared contracts, Electron dashboard and deployment/verification scripts exist. `docs/operations.md` §9 records local software work through 2026-10-23; this is not NAS, hardware, installer or real-bill acceptance. The original M1-only/no-commits snapshot is obsolete; the remote remains `https://github.com/Captain-Slow/house-solar-monitoring.git`.
- **Hard limits.** No writes to the inverter, battery, or gateway. No control, firmware, account, or tariff-provider changes. No cloud login, **except the read-only stopgap adapter defined in Amendment A1** (cloud login by the user, never by me). No Android UI scraping and no ADB use.

### User decisions (binding)
- **Gateway Ethernet wiring:** **none (checked 2026-10-17).** The stick is on Wi-Fi only; the user says it is outdoors and a long cable is impractical. A single-address test of its Wi-Fi IP, port 502, was refused. A client bridge next to the stick is possible later, after consulting the installer.
- **Other local Modbus clients:** none.
- **Cloud fallback:** **stopgap only, from Amendment A1 (2026-10-17).** Local Modbus stays the target source. Until the stick has a verified wired Modbus path, a read-only cloud adapter may feed lower-confidence data. The original "none" is superseded by A1; its limits are binding.
- **Tariff:** **TNB Peninsular Malaysia, NEM 3.0 (NEM Rakyat/NOVA), domestic Time-of-Use.** Currency `MYR`. Site timezone `Asia/Kuala_Lumpur` (UTC+8, no DST); the PC locale is en-MY.
- **Trusted reference:** manual readings of the TNB meter's import/export registers.
- **Image distribution:** private GHCR image `ghcr.io/captain-slow/house-solar-backend` (lowercase, as GHCR requires), pulled using a TrueNAS registry login.

## Recommendation

- **Target data source: local, read-only Modbus TCP** on the DTS-WL-G3's **Ethernet** port. Until a wired path exists, Amendment A1 defines a separate, non-ledger cloud stopgap track.
- **Collector lives in the NestJS backend.** It ports the needed subset of the MIT-licensed `hoymiles-g3-modbus-tcp` register map to TypeScript (pinned commit `78c620dfe01849e7610d84b64823dd958c901476`, tag 0.3.0) and uses `modbus-serial`.
  - No Python service runs in production. Decoding is just big-endian U16/I16/U32/I32 with fixed scales, so the Python library adds nothing beyond its register catalog.
  - The Python library is used once, during Phase 1, as an independent reference decoder.
- **Accounting:** grid import/export is integrated by us from the **external grid meter's instantaneous power**: `METER_NET` uses the meter's own total (register 1814) and `METER_PER_PHASE` uses its three per-phase readings (1808/1810/1812), each split directionally per integration interval. The inverter's own lifetime counters are kept as cross-checks. Everything is reconciled against TNB meter readings.
- **Cost:** a small, effective-dated tariff engine that must reproduce the user's real TNB bill.
- **Sequencing:** the original recommendation was to deploy collection before accounting/UI work. Implementation instead progressed locally through accounting and the dashboard while the wired-path gates remained blocked. This does not waive the gates: keep the shipping collector disabled until G0–G2 pass; physical accuracy, NAS autonomy and real-bill sign-off still require their separate evidence.

```mermaid
flowchart LR
  INV["HIT-10L-G3 + LB-16D-G3 + RS485 grid meter"] --- DTS["DTS-WL-G3 Ethernet<br/>Modbus TCP :502 unit 1"]
  subgraph NAS["TrueNAS Apps: one Compose app 'house-solar'"]
    MG["migrate (one-shot)<br/>prisma migrate deploy"]
    BE["backend (NestJS)<br/>collector → normalize → ingest<br/>ledger · reconciliation · tariff<br/>GraphQL over HTTPS :8443"]
    DB[("PostgreSQL 18.6<br/>internal network only")]
    BK["db-backup<br/>nightly pg_dump"]
  end
  BE -- "FC04/FC03 reads only<br/>one TCP connection" --> DTS
  MG --> DB
  BE --> DB
  BK --> DB
  PC["Windows PC: Electron<br/>main = API client (token + pinned cert)<br/>renderer = sandboxed UI"] -- "HTTPS + Bearer token" --> BE
  TNB["TNB meter (manual readings)<br/>TNB bills"] -. "entered via dashboard" .-> BE
```

## Evidence and unknowns

| # | Fact | Class | Source | Plan impact |
|---|---|---|---|---|
| 1 | HIT-10L-G3 V01.05.02 / LB-16D-G3 V03.00.01.03 / DTS-WL-G3 V03.00.19; app shows Self-Consumption Mode | Verified (read-only app inventory) | discovery handoff | G1 identity check |
| 2 | App grid import/export totals are inaccurate | User report | technician via user | Grid is the primary verification target |
| 3 | Modbus TCP is exposed only on the DTS **Ethernet** port, 502/unit 1, one client at a time | Community claim | RifkiSalim/homeassistant-hoymiles-g3 README; library README | G0 |
| 4 | Modbus/TCP needs DTS firmware ≥ V03.00.13 (user has V03.00.19) | Community claim | zhongfu/ha-hoymiles-g3-modbus-tcp README | Satisfied if the claim holds |
| 5 | Register map tested only on HIT-15L-G3 + 2×LB-16D-G3 + DTS-WL-G3 | Library statement | PyPI 0.3.0 README | G1–G5 verify on HIT-10L-G3 |
| 6 | Library is read-only (FC03/FC04 only; no write calls) | Verified by reading source | `client.py`, `inverter.py` @78c620d | Safe to use as a reference probe |
| 7 | Grid-meter block 1800–1827 holds instantaneous P/V/I/PF only; **no kWh counters** | Verified in source | `registers.py` @78c620d | Grid energy comes from our integration, or from inverter counters 2040/2048 |
| 8 | `grid_buy_energy` 2040 / `grid_sell_energy` 2048 (U32, 0.1 kWh, plus per-phase 2042–2054) are in the inverter energy block; their underlying instrument is **unknown** | Source + unknown | `registers.py` | G5 decides |
| 9 | Several grid-power candidates exist: meter 1814 (I32), "Grid Active Power" 2165 (I16; the library says inverter grid port), overview 30011 (I32) | Community | `registers.py`, README | M1 classifies each |
| 10 | No RTC/clock, no serial-number, and no DTS-firmware register exists | Verified absence | `registers.py`, `config.py` | Timestamps are collector-observed. Device identity is the **configured** `DEVICE_KEY` plus a model-string match; `detect` features (MPPT count, battery and meter presence, capacity) are changing observations, never identity (Phase 2.5) |
| 11 | Battery current "+ = discharging" (claim); grid and inverter signs undocumented | Community / unknown | README | G3 |
| 12 | Junk registers: 2151 `pv_power` (always 0), `load_energy_total` (always 0), 112 and 153–156 (constant 5) | Community (HIT-15L) | README | Never mapped, decoded or used; bulk read ranges can contain these words |
| 13 | `arm_system_faults` 30029 bit 2 = "Persistently negative load power"; `arm_periph_faults` 30028 bit 2 = "Grid meter comm lost" | Source | `registers.py` | CT-direction and meter-health signals |
| 14 | Physical facts: Ethernet cabling, IP, port, CT placement/direction, how the utility meter nets phases | Unknown | none | G0, G3, G6 |
| 15 | Official API (`wapi.hoymiles.com`, key by email/OAuth) documents only `production_stats`, `consumption_stats`, `status`, `mi_data_day`; no battery/grid/load telemetry | Verified docs (JS-rendered, partially readable) | developer.hoymiles.com | Not used |
| 16 | Unofficial cloud: snapshot data, ~5-min refresh, no sample timestamps, two counter families (`mb_*` vs `grid_*`, issue #80 for HIT-10L-G3, open). Exposes the control write endpoint `/pvm-ctl/api/0/dev/setting/write` | Community | Philra94 `const.py`, `hoymiles_api.py`, issue #80 | Stopgap only under Amendment A1; reads only, never these write endpoints |
| 17 | NEM Rakyat: net credit rolls over for at most 12 months, then is forfeited | Primary | SEDA "Guideline for NEM Rakyat and NEM Gomen" (2024-09-20) | Credit-bank logic |
| 18 | TNB RP4 domestic ToU components (peak Mon–Fri 14:00–22:00; capacity, network, retail, AFA) and NEM offset scope | Secondary sources that disagree | soyacincau, paultan, solaroo, negaraku | Encoded from the user's bill; bill-reproduction gate |
| 19 | TrueNAS ≥ 24.10 runs apps as Docker Compose ("Install via YAML"); Docker registry sign-in is supported; apps UID/GID 568; postgres volumes UID 999 | Docs + user report | apps.truenas.com; user reports 25.04.2.6 | Version part of D0 passes; pool, LAN IP and resources remain unknown |
| 20 | PostgreSQL 18.6 is current (19 is RC 1 today). The PG18 image mounts at `/var/lib/postgresql` | Verified docs | postgresql.org, Docker Hub | Pin 18.6 |
| 21 | Workstation has Node 22.21.1, Python 3.13.15, Docker Desktop, git, adb; the corepack pnpm shim is broken | Verified locally | `which`, `--version` | npm workspaces; Node 24 via nvm |
| 22 | HIT-5-20L-G3 datasheet (V1.0, HIT-10L-G3 column): PV max input 1000 V, rated 720 V, start-up 150 V, MPPT range 150–900 V, 4 MPPTs; battery 40–60 V; AC 380/400 V (266–480 V). The pinned `validation.py` bounds AC/EPS/meter voltages at 0–600 V and battery voltage at 0–150 V and has **no** PV-voltage bound | Verified docs + source | Hoymiles datasheet; `validation.py` @78c620d | Register-specific bounds (Phase 1.6); no blanket 600 V rule |
| 23 | `detect_config` derives `pv_mppt_count` from live PV voltages (raw > 10, i.e. > 1.0 V, at registers 27/30/33/36) and `has_battery`/`has_grid_meter` from live link/current/SOC values | Verified in source | `config.py` @78c620d | These are observations that can change at night or on a link drop; never identity or a counter boundary |

## Data-source decision and gates

| Criterion | **Local Modbus TCP (chosen)** | Unofficial S-Miles cloud | Official Open API |
|---|---|---|---|
| Fields | PV per string, battery P/SOC/state, external-meter per-phase P/V/I, inverter AC, EPS, vendor load, lifetime counters, mode, faults | PV/load/grid/SOC snapshot; battery magnitude only; aggregate counters in 2 families | Plant status/power, production/consumption aggregates |
| Independent accounting | Yes: meter power at the grid CTs, integrated by us | No: vendor aggregates | No: vendor aggregates |
| Freshness | 10 s polling (device cadence measured in G4) | ~5 min, no sample timestamp | Daily/monthly aggregates |
| Historical backfill | **None** (history starts when monitoring starts) | Day/month/year aggregates | Aggregates |
| Authentication | None (LAN protocol) | Password-derived hash + token | Emailed key / OAuth (details unknown) |
| Maintenance / operational risk | Small unofficial map; single-client limit; unauthenticated protocol | Breaks with app updates; ToS risk; control endpoints present | Approval unknown; insufficient fields |
| Decision | **Build** (target) | Stopgap only, non-ledger (Amendment A1) | Not built |

Gates. **G0–G6 belong to the Modbus track.** Real-site Modbus collection is enabled only after G0–G2 pass. The API, accounting worker and synthetic/local verification do not require a live source; their execution is not hardware acceptance. D0 and deployment gates are common to both tracks. Deferred A1 has its own C1–C3/VC1–VC5 gates and never satisfies or bypasses G0–G6.

| Gate | Pass criterion | On failure |
|---|---|---|
| **D0** TrueNAS | Version ≥ 24.10 (Docker Compose apps) | Phase 3 blocked until the user upgrades; continue Phases 1–2 and 4–6 locally with dev compose |
| **G0** Reachability | Stick has a wired DHCP lease; `Test-NetConnection <ip> -Port 502` → `TcpTestSucceeded: True` from the PC; FC04 read of (0,123) returns 123 words in ≤ 3 s | Stop the Modbus track. User fixes cabling (or adds a client bridge after consulting the installer). No stick/app setting changes, no scanning. The cloud stopgap (A1) may run meanwhile; it is not a G0 pass. |
| **G1** Identity | Model string from 1000–1004 = `HIT-10L-G3`; `has_battery` true; `has_grid_meter` true and 1800 = 1 (Online); `ems_mode` 4300 = 0 while the app shows Self-Consumption; battery capacity (1907) recorded and compared with the LB-16D-G3 label; firmware words 1/201 recorded | Stop collector work; keep raw captures; re-plan the register map |
| **G2** Decode parity | Run back-to-back, never concurrently. TS decode equals Python 0.3.0 decode for: model string; lifetime counters ±0.1 kWh; SOC ±1; meter voltages ±2 V | Fix the TS port before Phase 2 |
| **G3** Signs | Battery: sign(power 50) agrees with 1904 status on ≥ 99% of samples with \|P\| > 100 W. Grid: during PV < 20 W, \|battery\| < 50 W, load > 200 W windows (≥ 30 min total), meter total and each phase read **import**. Otherwise the residual test (below) separates hypotheses by ≥ 3×. Inverter AC: from the residual test | Deploy anyway with `mappingVersion 1` marked provisional (`MAPPING_PROVISIONAL`); raw data allows re-normalization later |
| **G4** Cadence | `--cadence` run: median interval between changes of the 1800–1827 words recorded; 10-s vs 2-s integration differ < 1% over the window | Record. `maxRepeatSpanSec = max(30, 2 × observed meter update period)` |
| **G5** Counter semantics (≥ 24 h, NAS data) | Ratios recorded: Δ`grid_buy/sell` vs meter-net integration vs 2165 integration; PV counter vs PV-power integration; battery counters vs battery-power integration; reset local time of `*_today` | Sets the AccountingPolicy defaults (see Accounting); never blocks |
| **G6** Reconciliation (≥ 7 days) | Active grid source within tolerance of TNB meter deltas (see Reconciliation) | Status `RECONCILIATION_FAILED` plus the investigation path; never auto-calibrate |

The residual test pairs each sample's meter total (s_g), inverter AC sum 74–76 (s_i) and EPS sum 92–94 with vendor `load_power` (2170–2172). For each of the 4 sign hypotheses (s_g, s_i ∈ {+1, −1}), compute median \|load_vendor − (s_g·meter + s_i·inv + eps)\| over samples with load > 300 W. Pick the hypothesis with the minimum.

## Field mapping and provenance seed (Milestone M1 → `docs/field-mapping.md`)

`docs/field-mapping.md` has one row per quantity with these columns:
- quantity
- register(s)
- FC/type/scale
- unit
- canonical sign and raw-sign evidence
- physical measurement point
- timestamp basis (always collector `observedAt`, the midpoint of the poll; no device clock exists)
- observed update cadence
- reset/wrap behaviour
- uncertainty
- plausibility bounds, with the evidence for each (datasheet, library `validation.py`, or capture)
- verification method and result
- status: `VERIFIED` | `PROVISIONAL` | `REJECTED`

Seed rows are below. Every cell marked "verify" is filled from Phase 1/4 data.

| Quantity | Primary register(s) | Cross-checks | Canonical sign | Point (verify) | Notes |
|---|---|---|---|---|---|
| Grid net power | `meter_active_total` 1814 I32 W is the `METER_NET` input (the meter's own total, never recomputed from the phases); phases 1808/1810/1812 I32 W are the separate `METER_PER_PHASE` inputs | 2165 I16; 30011 I32 | + import | External RS485 meter CTs | Valid only if 1800 = 1 and 30028 bit 2 = 0 |
| Grid import/export energy | Our integration: `METER_NET` splits the 1814 meter total directionally per interval; `METER_PER_PHASE` splits each normalized phase directionally per interval and sums the results | `grid_buy_energy` 2040 / `grid_sell_energy` 2048 U32 ÷10 kWh; per-phase 2042–2046 / 2050–2054 | directional | Meter / counter instrument unknown | Counters have 0.1 kWh resolution |
| PV power | Σ `pv1..4_power` 29/32/35/38 U16 W | `pv_total_power_eb` 2150; 30001 H32 | ≥ 0 | DC MPPT inputs | 2151 is junk |
| PV string voltage | `pv1..4_voltage` 27/30/33/36 U16 ÷10 V | — | ≥ 0 | DC MPPT inputs | Datasheet: max input 1000 V, rated 720 V, MPPT 150–900 V. Bound 0–1100 V (1000 V + 10% margin, a design choice); 600–1000 V is a valid reading |
| AC / EPS / meter voltage | 62–64, 67–69, 81–83, 1801–1803, 1851–1853 U16 ÷10 V | — | ≥ 0 | AC ports and meter | Library bound 0–600 V |
| Battery voltage | `bat1_voltage` 46, `batt_voltage_bms` 1911 U16 ÷10 V | — | ≥ 0 | Battery | Datasheet 40–60 V; library bound 0–150 V |
| PV energy | `pv_total_energy` 2000 U32 ÷10 kWh | PV-power integration | ≥ 0 | DC side | — |
| Battery power | `bat1_power_g3` 50 I32 W | `batt_power_bms` 1914 I32; 2162 I16; 30009 I32 | + discharge | Inverter battery port vs BMS | Sign check against 1904 |
| Battery energy | `bat_charge_energy` 2028 / `bat_discharge_energy` 2030 U32 ÷10 kWh | Integration of power 50 | — | — | — |
| SOC / state | `battery_soc` 1909 U16 %; `bat_work_status` 1904 | 30020, 30019 | — | BMS | Bound 0–100 |
| Inverter AC power | Σ `inv_active_power_a/b/c` 74–76 I16 W | 30007 I32 | + output to house | Inverter AC port | — |
| EPS power | Σ `backup_active_a/b/c` 92–94 I16 W | — | + output | EPS port | Probably 0 if no backup loads are wired |
| Household load | **Derived** = grid + inverter AC + EPS | `load_power` Σ 2170–2172; `load_power_total` 2169 (includes inverter self-use); `load_energy_use` 2056 | ≥ 0 | Derived | `load_energy_total` is junk |
| Operating mode | `ems_mode` 4300 (FC03) | `system_workstatus` 30000 | — | — | Read-only display |
| Faults | 30021, 30023, 30025, 30027–30029; 1905 | — | — | — | Bitmap labels ported |
| Vendor daily summaries | `*_today` 2100–2134 U16 ÷10 kWh | — | — | — | Comparison only; record the reset local time |
| Identity | Configured `DEVICE_KEY` + `EXPECTED_MODEL`; ASCII 1000–1004 (byte-swapped, longest printable run) must equal `EXPECTED_MODEL`; words 1 and 201 recorded as firmware | detect features (`hasBattery`, `hasGridMeter`, MPPT count, capacity) stored as *observed capabilities* | — | — | No serial register; replacement is an explicit workflow (Phase 2.5) |

## Approach

### Phase 0: Site prerequisites (user-performed; gates G0, D0)
1. **Find the stick's wired address.** The user checks whether the DTS-WL-G3 Ethernet port has a cable. In the router's DHCP client list, find the stick's **wired** lease (match the MAC on the stick label), create a DHCP reservation, and record the IP.
   - If there is no cable: run Ethernet (or attach a Wi-Fi-to-Ethernet bridge) to the stick's Ethernet port.
   - If the stick gets no lease when cabled: stop (see Contingencies).
2. **Check the port.** From the PC: `Test-NetConnection <stick-ip> -Port 502`. Test only this IP; never scan.
3. **Record TrueNAS facts** in `docs/operations.md` § "Site facts": the user-reported version **25.04.2.6** satisfies D0 (≥ 24.10). Pool name, trusted NAS LAN IP, free RAM and free disk remain unprovided; no NAS inspection or deployment is implied.

### Phase 1: Scaffold, read-only Modbus layer, probe, M1 (Modbus track; depends on Phase 0; gates G1–G4; the code and replay tests need no hardware, the probe sessions do)
1. **Monorepo with npm workspaces.**
   - Root `package.json`: `{"private": true, "workspaces": ["apps/*", "packages/*"], "engines": {"node": ">=24.11 <25"}}`.
   - `.nvmrc` = `24`.
   - `.gitignore`: `node_modules/`, `dist/`, `out/`, `.env*`, `captures/local/`.
   - `tsconfig.base.json`.
   - Prerequisite: `nvm install 24 && nvm use 24`. Don't use pnpm; its corepack shim is broken on this PC.
   - Scaffold the backend with `npx @nestjs/cli@12.0.8 new backend --directory apps/backend --package-manager npm --skip-git --strict`. Keep the generated ESM/tsconfig settings.
   - Pin dependencies exactly as in the stack table under Deployment.
2. **`apps/backend/src/modbus/register-map.ts`.**
   - Port from the library @78c620d: every register named in the M1 table, the detect fields, faults 30021–30029 with bitmap labels, 1905, holding ranges and enums (4300, 30000, 1904, 1800).
   - Each entry: `{ key, addr, fc: 3 | 4, dtype: 'U16'|'I16'|'U32'|'I32'|'H32'|'I32R', scale, unit, enum?, bitmap? }`.
   - Header: the MIT copyright notice from the library LICENSE and the source commit.
   - Never include 2151, `load_energy_total`, 112, or 153–156.
   - This file defines mapped register fields, types and scales; `read-plan.ts` separately owns bulk-range boundaries and DETECT reads.
3. **`src/modbus/decode.ts`.** Port `decode_words` (big-endian, high word first; `I32R` is low word first; value ÷ scale) and `decode_ascii_string` (byte-swapped, longest printable run).
4. **`src/modbus/read-plan.ts`.** `buildReadPlan(ranges, maxBlock = 123)` is a direct port of the library's `build_read_plan` (each `[lo, hi)` chunked from `lo`). Tier constants:
   - `FAST` = `[(0,123), (1800,1924), (2000,2246), (30000,30030)]` → 6 FC04 requests (starts 0, 1800, 1923, 2000, 2123, 30000). The library's default ranges are `(0,369), (1800,1924), (2000,2246), (30000,30030)`; the plan splits its first range into FAST `(0,123)` and SLOW `(123,246)` and never reads `246–369` (no mapped register lives there). The library reads 30000 to 30030 as well, so fault bitmaps come every poll.
   - `SLOW` = `[(123,246)]`.
   - `DETECT` = reads `(0,123), (1000,123), (1900,24), (1800,7)` exactly as `detect_config`.
   - `SETTINGS` (FC03) = `(258,260), (303,312), (323,325), (3001,3002), (3016,3017), (4100,4103), (4300,4307), (6048,6050)`.
   - Never start a read inside `[1101, 1800)`.
5. **`src/modbus/readonly-modbus-client.ts`.**
   - Wraps `modbus-serial` `ModbusRTU`: `connectTCP(host, {port})`, `setID(unit)`, `setTimeout(ms)`, `readInputRegisters`, `readHoldingRegisters`, `close`.
   - Exposes only `connect()`, `readInput(addr, len)`, `readHolding(addr, len)`, `close()`. `len` ≤ 123 is asserted. Calls are serialized through a promise-chain mutex.
   - The linter (`apps/backend/.oxlintrc.json`, rule `no-restricted-imports`; oxlint, not ESLint) forbids importing `modbus-serial` anywhere except this file and `src/cli/replay-server.ts`.
6. **`src/modbus/hoymiles-g3.ts`.**
   - `detect(): Promise<DetectedInfo>` uses the same rules as `detect_config` and returns `{ model, firmware, observed: { hasBattery, hasGridMeter, mpptCount, batteryCapacityKwh } }`. Only `model` takes part in identity checks; `observed` values are live observations (the pinned library derives `mpptCount` from PV voltages > 1.0 V, so it can be 0 at night). `readTier(tier): Promise<RawPoll>` returns `{ tier, requestedAt, receivedAt, blocks: { fc, start, count, words: number[] | null, error?: string }[] }`.
   - Plausibility retry uses **per-register bounds stored in `register-map.ts`** (`bounds?: [lo, hi]` plus an evidence tag), never a blanket limit: `battery_soc` 0–100; `battery_soh` 0–150; battery voltages (46, 1911) 0–150 V (datasheet 40–60 V); AC/EPS/meter voltages (62–64, 67–69, 81–83, 1801–1803, 1851–1853) 0–600 V (pinned `validation.py`); **PV string voltages (27/30/33/36) 0–1100 V** (datasheet: max input 1000 V, rated 720 V, MPPT 150–900 V, so 600–900 V is normal; the 10% margin is a design choice); frequencies 40–70 Hz when non-zero; temperatures −40–150 °C. Power, current, and energy registers are unbounded. If a bounded register in a block is out of range, re-read that block up to 2 times, 50 ms apart; if it is still out of range, mark the block invalid. A legitimate PV reading in 600–1100 V never triggers a retry and never invalidates the block (V22).
7. **`src/cli/probe.ts`.**
   - Usage: `npm run probe -w apps/backend -- --host <ip> [--minutes 120] [--interval 10] [--cadence] --out captures/local/<ts>.jsonl`.
   - Runs detect, then FAST every `--interval` s, SLOW every 300 s, and SETTINGS once.
   - Writes one JSONL line per poll: `{observedAt, tier, blocks, decoded}`.
   - `--cadence` reads only the (1800,123) block every 2 s for 10 min.
   - (M1 builds `src/collector/collector-lock.ts` and `src/config/database-url.ts` now, because the probe needs them; Phase 2 consumes and extends them.) If `DATABASE_URL` is set, it first takes advisory lock `727001` and exits 3 if the lock is held. It runs the same ownership heartbeat as the collector (Phase 2.4) and exits 3 if the lock session is lost.
8. **Probe sessions on the PC, strictly sequential:**
   - a. Python reference in a throwaway venv outside the repo:
     - `python -m venv %TEMP%\hm-ref`
     - `%TEMP%\hm-ref\Scripts\pip install hoymiles-g3-modbus-tcp==0.3.0`
     - `%TEMP%\hm-ref\Scripts\python -m hoymiles_g3_modbus_tcp --host <ip>` (one run) → save to `captures/local/python-ref-<ts>.txt`.
   - b. TS probe, one cycle → G2.
   - c. `--cadence` → G4.
   - d. 120 min covering PV production plus ≥ 30 min after sunset → G1, initial G3.
   - e. During (d), the user switches a kettle on for 3 min and notes the times. This is a sanity check that the load delta appears in both derived and vendor load.
9. **`src/cli/analyze-capture.ts`.** Input is JSONL; output is markdown fragments for:
   - the sign tests (G3) and cadence/repeat statistics (G4)
   - counter-vs-integration ratios and the `*_today` reset time (G5)
   - the daily balance residual

   `src/cli/export-samples.ts` exports retained DB raw polls to diagnostic JSONL wire captures for analysis. It does not export Sample history, run/sequence identities or acquisition timing. Replaying it creates a new synthetic acquisition, not original coverage/clock-validity evidence. Use `RENORMALIZE` on retained database rows for historical reconstruction and `pg_dump`/restore for lossless preservation.
10. **Write `docs/field-mapping.md` (M1)** and the `MappingConfig` v1 values:

    ```ts
    {
      gridMeterSign: 1 | -1,
      gridMeterPhaseSign: [s, s, s],
      inverterAcSign: 1 | -1,
      batterySign: 1 | -1,
      batteryPowerSource: 'BAT1_POWER_G3_50' | 'BMS_1914',
      maxRepeatSpanSec: number,
    }
    ```

    Copy one 30-min day capture and one 30-min night capture to `apps/backend/test/fixtures/captures/{day,night}.jsonl`. Modbus data contains no secrets.
    These files are hardware-gated and are not shipped as invented captures. Until G0–G2 pass, the runnable synthetic/replay check is `DATABASE_URL=postgresql://solar:solar@127.0.0.1:55433/solar_test npx vitest run --config vitest.config.int.ts test/phase2-exit.int-spec.ts` from `apps/backend` (dev DB required). Its fixtures come from `test/support/synthetic.ts`; it does not establish hardware decoder parity.

**Exit (Modbus track):** G1 and G2 pass. G3 and G4 results recorded (pass, or provisional). Every M1 row has a status.

### Phase 2: Persistence, collector, ingestion, auth/TLS, minimal API (persistence/auth/API/deployment depend only on the M1 code; the Modbus collector's real-hardware exit depends on G0–G2)
1. **Prisma 7.10.1.**
   - **One configuration/build layout.** `apps/backend/prisma.config.ts` imports only `./src/config/database-url`, a dependency-free module (`node:fs` only; it must never import anything else). `buildDatabaseUrl(env)` returns `DATABASE_URL` unchanged when `DATABASE_PASSWORD_FILE` is unset (dev/tests). Otherwise it reads the file, strips trailing whitespace, and returns the URL with the URL-encoded password inserted (`DATABASE_URL` carries the user but no password, e.g. `postgresql://solar@db:5432/solar`). The migrate service and the backend's `pg.Pool` both call it, so they share one secret file. Generator `prisma-client` with output `src/generated/prisma`.
   - The runtime image (`WORKDIR /app`) contains exactly: `dist/`, separately installed hoisted production `node_modules/` (including `prisma`, `@prisma/*`, and the schema-engine binary downloaded during `npm ci --omit=dev` in the dependency stage, so `migrate` needs no egress), `prisma/` (schema and `migrations/`), `prisma.config.ts`, `src/config/database-url.ts`, and `package.json`, plus the OS package `openssl` (Prisma's schema engine links libssl; it must also be installed in the stage that runs `npm ci`, or Prisma downloads the OpenSSL 1.1 engine and fails on the OpenSSL 3 runtime). `prisma migrate deploy` needs nothing else; V19 verifies this with `internal` networking only (`deploy/dev/verify-v19.sh`, built in M3).
   - `@prisma/adapter-pg` with `new pg.Pool({ max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000 })`. pg has no default connect timeout, so this must be set explicitly.
   - Migration `0001_core`: the core models from the Data model section, **including `LedgerDirtyRange` and `DirtyReason`**, because Phase 2 ingest writes dirty ranges (Phase 2.6) and the Phase 4 worker only consumes them. Later phases add `0002_accounting` and `0003_tariff`. The current chain also includes additive `0004_raw_poll_monotonic` (nullable acquisition timing facts plus acquisition-order index) and `0005_soc_coverage` (nullable independent SOC coverage) and `0006_grid_phase_coverage` (nullable `EnergyInterval.gridPhaseCoveredSec`, the `METER_PER_PHASE` coverage; NULL = unknown historical coverage). Current constants are `LEDGER_ALGO_VERSION = 3` and `BILLING_CALC_VERSION = 2`.
2. **`src/config/env.ts`.** A zod schema for: `SITE_TIMEZONE`, `DATABASE_URL` (no password), `DATABASE_PASSWORD_FILE`, `MODBUS_HOST`, `MODBUS_PORT=502`, `MODBUS_UNIT_ID=1`, `MODBUS_TIMEOUT_MS=3000`, `DEVICE_KEY=inverter-1`, `EXPECTED_MODEL=HIT-10L-G3`, `OWNERSHIP_LEASE_SEC=15`, `POLL_FAST_MS=10000`, `POLL_SLOW_MS=300000`, `POLL_SETTINGS_MS=900000`, `COLLECTOR_ENABLED=true`, `COLLECTOR_SOURCE=MODBUS` (`MODBUS | NONE` only until A1 is implemented), `HTTPS_PORT=8443`, `TLS_DIR=/data/tls`, `TLS_SUBJECT_ALT_NAMES`, `RAW_RETENTION_DAYS=400`, `SAMPLE_RETENTION_DAYS=400`, `BACKUP_DIR=/backups`, `LOG_LEVEL=info`. On an invalid value, log the field name and `process.exit(78)`. Shipping TrueNAS compose overrides `COLLECTOR_ENABLED=false`, disabling acquisition regardless of source.
3. **`src/collector/normalize.ts` (pure).** `normalizeFast({blocks, observedAt, monotonicMs, mapping, mappingVersion, state, recordedMeterRepeatSec?}) → {sample, state, events}`.
   - Applies canonical signs and computes `meterRepeatSec` from the collector monotonic midpoint: elapsed seconds since the SHA-256 of words 1800–1827 changed, comparable only within one collector run. Wall-clock changes never reset a frozen reading's age.
   - Sets `Sample.flags` bits:

     | Bit | Flag | Condition |
     |---|---|---|
     | 0 | `METER_LINK_DOWN` | 1800 ≠ 1 |
     | 1 | `METER_COMM_FAULT` | 30028 bit 2 |
     | 2 | `METER_STALE` | repeat span > `maxRepeatSpanSec` |
     | 3–6 | `BLOCK_INVALID_0/1800/2000/30000` | block invalid |
     | 7 | `CLOCK_STEP` | backward wall time or \|Δwall − Δmonotonic\| > 2 s within a run |
     | 8 | `NEGATIVE_DERIVED_LOAD` | derived load < −50 W |
     | 9 | `BATTERY_SIGN_CONFLICT` | \|P\| > 100 W and sign disagrees with 1904 |

   - Counters are stored in Wh (raw ×100) as BigInt. A field from an invalid block is `null`, never 0.
4. **`src/collector/collector-lock.ts`.**
   - A dedicated `pg.Client` (TCP keep-alive on, `connectionTimeoutMillis` 5000, `query_timeout` 3000) runs `SELECT pg_try_advisory_lock(727001)`. If it returns false: state `LOCK_NOT_HELD`, retry every 30 s. A session-level advisory lock is held only until it is released or its session ends (PostgreSQL explicit-locking docs), so it is a lease on that session, not a permanent claim.
   - **Fail closed.** Ownership is valid only while the lock session is alive *and* a heartbeat `SELECT 1` on it (every `min(5 s, OWNERSHIP_LEASE_SEC/3)`, so several heartbeats always fit in one lease) has succeeded within `OWNERSHIP_LEASE_SEC` (15 s). The collector checks this before every Modbus request. On client `error`/`end`, a failed heartbeat, or an expired lease it immediately stops issuing requests, closes the Modbus socket, sets `LOCK_NOT_HELD`, and records a `CONNECTION_LOST` gap event. It resumes only after the old session is disposed (next bullet), a new `pg_try_advisory_lock` succeeds on a new session, **and** a takeover delay of `OWNERSHIP_LEASE_SEC + MODBUS_TIMEOUT_MS` (18 s) has elapsed before the first Modbus connect. This makes overlap unlikely under its assumptions (bounded clock drift; the process is not paused longer than the lease between a lease check and a Modbus write). It is **not** a proof of exclusive ownership under arbitrary failures such as a stalled process or a clock jump; the gateway's one-client advice is the last line of defence (how it treats a second client is unverified). No separate coordination service is added.
   - **Dispose before retry.** Each lock session has a generation id; event and heartbeat callbacks from an older generation are ignored. On loss the old `pg.Client` is disposed first: remove its listeners, `client.end()` with a 2-s timeout, then destroy its socket. Only then is a new client created. A `query_timeout` alone does not end a server session, so without this step the old session could keep the advisory lock and block its own replacement indefinitely. If the old session still lingers server-side (for example a network partition), the new `pg_try_advisory_lock` returns false (`LOCK_NOT_HELD`, retry every 30 s), which preserves exclusion until PostgreSQL ends it; the `db` service sets `tcp_keepalives_idle=30`, `tcp_keepalives_interval=10`, `tcp_keepalives_count=3` so a dead peer is reaped in about a minute.
   - Samples already collected stay in the in-memory buffer and are flushed idempotently (unique `(deviceId, observedAt)`) whenever the DB is reachable, whether or not the lock is held. Collection itself does **not** continue through a DB outage longer than the lease.
5. **`src/collector/collector.service.ts`.**
   - Starts in `onApplicationBootstrap`; stops in `beforeApplicationShutdown` (finish the in-flight poll ≤ 5 s, flush, close the socket, release the lock).
   - One self-scheduling loop: the next FAST poll runs at the next multiple of `POLL_FAST_MS` on the wall clock. An overrun skips missed ticks and never bursts to catch up. SLOW and SETTINGS run right after a FAST poll when due. There are no parallel requests.
   - `observedAt` is the midpoint of the first request and the last response.
   - Reconnect backoff: 5, 10, 20, 40, 80, 160, 300 s (capped), ±10% jitter.
   - States: `RUNNING | DEGRADED_UPSTREAM | LOCK_NOT_HELD | IDENTITY_MISMATCH | DISABLED | STOPPING`.
   - Re-run detect after every connect and compare **only** `model` with `EXPECTED_MODEL`. A mismatch enters `IDENTITY_MISMATCH`: no samples are written, an `IDENTITY_MISMATCH` event is recorded, and the collector retries on the reconnect backoff. Observed capabilities (battery/meter presence, MPPT count, capacity) and firmware are written in place to `Device.observedCapabilities`/`firmware`; a change emits `CAPABILITY_CHANGED` and never retires or creates a device, never changes `deviceId`, and never creates a counter boundary.
   - **Device identity** = `DataSource` + the configured `DEVICE_KEY`: exactly one non-retired `Device` row per key. Because no serial register exists, replacement is explicit: `node dist/cli/device.js replace --key <DEVICE_KEY> --effective-at <ISO> --reason <text>` (admin CLI, run in the backend container) retires the current row at `effectiveAt`, creates a new row with the same key, and emits `DEVICE_REPLACED`. The counter state machines start a new segment at that boundary. A same-model hardware swap that nobody records is detectable only through `COUNTER_RESET`/`COUNTER_DISCONTINUITY` events and reconciliation, not from registers.
   - Upstream failures never exit the process.
6. **`src/collector/ingest.service.ts`.**
   - Writes `RawPoll` + `Sample` + dirty-range rows in one transaction. Raw polls deduplicate by `(runId, seq)`; Samples use `INSERT … ON CONFLICT (deviceId, observedAt) DO NOTHING RETURNING observedAt`, keeping the first acquisition at a collided wall timestamp. New samples dirty the ledger; a new raw-only FAST collision can also prove a stale run and dirty affected existing samples even when it inserts no Sample.
   - **Dirty marking.** For the newly inserted samples with earliest time `t_min` and latest `t_max`, insert one `LedgerDirtyRange(reason = INGEST)` with `fromBucket = floor5(t_prev)` and `toBucket = ceil5(t_next)` (exclusive), where `t_prev` is the latest existing sample before `t_min` (else `t_min`) and `t_next` the earliest existing sample after `t_max` (else `t_max`, rounded up to the next bucket boundary). This covers every interval a late or buffered sample can change, however old.
   - DB unavailable or writes failing: the queue reserves 360 already-collected FAST polls (1 h at 10 s) and a separate 64 SLOW/SETTINGS polls; pending writes count toward those capacities. It protects **collected** data from flush failures only; it does not mean collection continues for an hour, because collection stops when ownership is lost (Phase 2.4). Flush with backoff 5 → 60 s. On overflow, drop the oldest and record a `DB_UNAVAILABLE` gap event once the DB is back.
   - After `maxRepeatSpanSec` is exceeded, retroactively set `METER_STALE` on the run of repeated samples (one `UPDATE`). **In the same transaction** insert a `LedgerDirtyRange(reason = INGEST)` covering the entire modified run plus its bounding samples (`floor5` of the sample before the run's first modified sample to `ceil5` of the sample after its last), so buckets already computed from those samples are recomputed even though no new sample was inserted there.
   - Persist immutable FAST `monotonicMs`, `acquisitionClockStep` and `acquisitionMeterRepeatSec` in RawPoll. Rebuild in `(deviceId, runId, seq)` acquisition order, resetting state per run; other tiers explain intervening sequence numbers, but missing acquisitions are unknown boundaries. Preserve recorded clock invalidity and retained stale evidence; an explicitly higher repeat threshold may loosen stale status as a mapping-policy change. Legacy NULL timing is never reconstructed from wall time: retain a surviving Sample's timing; without one, mark reconstructed timing clock-invalid. Full boundary/collision rules: `docs/operations.md` §7 historical re-normalization and acquisition timing.
   - SLOW/SETTINGS polls → `RawPoll` + `Device.latestStatus` (decoded `ems_mode`, `workstatus`, firmware, SOH, active fault labels, `observedAt`).
7. **Retention.** A daily 03:00 `SITE_TIMEZONE` job prunes in batches of 10,000. Sample pruning protects pending dirty ranges and RUNNING `RENORMALIZE` windows and nonblockingly takes replay reservation 716071/7, deferring Sample pruning if busy. Raw pruning independently protects the dirty-range pin and never deletes a poll referenced by a surviving Sample. Defaults remain 400 days each; the complete horizon contract is Phase 4.4, not a guarantee that deleted evidence can be recovered.
8. **`src/main.ts` (HTTPS).**
   - Load `TLS_DIR/cert.pem` and `key.pem`. If missing, generate a self-signed ECDSA P-256 certificate (package `selfsigned`) with SANs from `TLS_SUBJECT_ALT_NAMES`, valid 3650 days.
   - Log `TLS certificate fingerprint sha256/<base64 SHA-256 of DER>`.
   - Call `enableShutdownHooks()`.
9. **Auth.**
   - `src/cli/token.ts`:
     - `create --name <n> --role ADMIN|VIEWER` prints the token once, plus the TLS fingerprint.
     - `list`
     - `revoke --id <id>`
   - Token format: `hsm_` + 32 random bytes as base64url. Only the SHA-256 is stored.
   - `src/auth/token.middleware.ts` guards `/graphql`, including introspection: missing or invalid token → 401. 10 failures/min per IP → 429 for 5 min. `lastUsedAt` is updated at most once a minute.
   - `src/auth/roles.guard.ts` allows mutations only for ADMIN.
   - CORS is disabled, since no browser origin is ever served.
10. **GraphQL (code-first).**
    - `autoSchemaFile: 'schema.gql'`, `sortSchema: true`. Commit `schema.gql`.
    - Scalars: `DateTime` and `LocalDate` from graphql-scalars; custom `Decimal` in `src/graphql/scalars/decimal.scalar.ts`. It serializes `Prisma.Decimal`/decimal.js via `toFixed()` and parses only strings matching `^-?\d{1,12}(\.\d{1,6})?$`; JSON numbers are rejected.
    - Depth limit 8: a custom fragment-aware `ValidationRule` (`src/graphql/depth-rule.ts`). The `graphql-depth-limit` package did not reject a nine-deep selection with graphql 16.14, so the contingency below was taken and the package removed.
    - `includeStacktraceInErrorResponses: false`.
    - Queries now: `liveStatus`, `collectorStatus`, `devices`, `dataQualityEvents`.
11. **Health.**
    - `GET /healthz` (no auth): 200 whenever the event loop responds. Liveness only.
    - `GET /readyz` (no auth): 200 if `SELECT 1` succeeds within 2 s and the latest migration is applied; otherwise 503.
    - `src/cli/healthcheck.ts` calls `/healthz`.
    - Modbus state never affects either endpoint.
12. **Logging.** `nestjs-pino` with `redact: ['req.headers.authorization', '*.token', '*.password', '*.DATABASE_URL']`.
13. **`src/cli/replay-server.ts`.** A `modbus-serial` `ServerTCP` with single/multiple input/holding read handlers and no write handlers. New clients are expected to issue the four DETECT reads in order, served from DETECT independently of failed FAST blocks. FAST records advance on the read at 30000; captured failures return ILLEGAL DATA ADDRESS. A client skipping DETECT has an ambiguous first block-0 read served from DETECT (the collector always detects first). Replay is synthetic acquisition, not a timing-history restore.
14. **Docker.**
    - `apps/backend/Dockerfile` has build, production-dependency and runtime stages using pinned `node:24-bookworm-slim`. Build runs `npm ci -w apps/backend`, `prisma generate` and `nest build`; the separate dependency stage runs `npm ci -w apps/backend --omit=dev`, not `npm prune`, and removes the workspace symlink. Both install stages include OpenSSL. Root `allowScripts` approves `prisma@7.10.1` and `@prisma/engines@7.10.1`; keep these exact approvals aligned with the three Prisma pins on future bumps and rerun offline V19.
    - Runtime stage (`WORKDIR /app`) copies exactly the file set listed in item 1: `dist`, production-dependency-stage hoisted `node_modules`, `prisma/`, `prisma.config.ts`, `src/config/database-url.ts`, `package.json`. `prisma` is a production dependency so the migrate service can run. `USER 568:568`, `CMD ["node", "dist/main.js"]`. The backend never runs migrations itself; only the `migrate` service does, so "migrations disabled" during a restore simply means that service is not started.
    - `deploy/dev/compose.dev.yaml`: `postgres:18.6-bookworm` on `127.0.0.1:${DEV_DB_PORT:-55432}` for dev and tests (override `DEV_DB_PORT` when 55432 is taken; the compose file ships in M1 because the probe's lock tests need it).

**Exit:** run against the replay server with `day.jsonl`:
- 1 h of replay produces 360 `Sample` rows; re-ingesting the same polls leaves 360.
- `liveStatus` returns `freshness: LIVE`.
- Killing the replay server → `DEGRADED_UPSTREAM` with backoff; the process keeps running.
- A second backend instance reports `LOCK_NOT_HELD`.
- Terminating the lock session (`pg_terminate_backend`) stops Modbus requests within one heartbeat interval, closes the socket, and collection resumes only after re-acquisition plus the takeover delay (V25).
- The runtime image runs `prisma migrate deploy` against an empty database with only the `internal` network and the `db_password` secret (V19).

### Phase 3: TrueNAS deployment and backups (depends on Phase 2; parallel with Phase 4)
1. **Datasets** under `<pool>/apps/house-solar`:

   | Dataset | Owner | Mode |
   |---|---|---|
   | `pgdata` | 999:999 | 0700; `recordsize=16K`; a ZFS dataset: replaced with `zfs rename` + recreate (Restore step 2), never `mv` |
   | `backups` | 999:568 | 0750 |
   | `tls` | 568:568 | 0700 |
   | `secrets` | — | — |
   | `scripts` | root:root | 0755; holds `backup.sh` copied from `deploy/truenas/backup.sh`, mounted read-only into `db-backup` |

   - File `secrets/db_password`: owner 999, group 568, mode 0440, containing 32 random bytes as base64.
   - Create directories with `storage filesystem mkdir path=...` and set ownership in the TrueNAS shell (the docs recommend this before installing).
2. **Image.**
   - On the PC: `docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t ghcr.io/captain-slow/house-solar-backend:0.1.0 --push .`
   - On TrueNAS, the user signs in under Apps → Configuration → "Sign-in to a Docker registry" (`ghcr.io`, username, PAT with only `read:packages`). The PAT is never typed into chat or the repo.
3. **App.** Install `deploy/truenas/compose.yaml` via Apps → Discover → ⋮ → Install via YAML, with placeholders substituted.
4. **Tokens.** From the backend container shell: `node dist/cli/token.js create --name desktop --role ADMIN`, and the same with `--name viewer --role VIEWER`.
   - Copy `/mnt/<pool>/apps/house-solar/tls/cert.pem` to the PC.
   - Verify authenticated `collectorStatus` using the hidden-prompt/stdin curl procedure in `docs/operations.md` §3: never put a bearer token in shell history or process arguments. The initial shipping state is `DISABLED`. Expect `RUNNING` only after G0–G2 pass, `MODBUS_HOST` names the verified wired address, and collection is explicitly enabled.
5. **Backups and a restore drill** per the Operations section, including the restore-only app file `deploy/truenas/compose.restore.yaml`.
6. **Runbook.** Write `docs/operations.md`: site facts, install, tokens, upgrade/rollback, backup, restore, restore-drill log.

**Exit (staged).** *Stage 3a (after Phase 2):* 72 h of continuous collection with ≥ 99% of expected FAST samples (Modbus) or the A1 cloud cadence (cloud), excluding documented restarts; nightly dumps produced unattended with no `PGPASSWORD` in environment or logs (V20); the production-path restore completes against the core schema and the collector resumes; `Sample`/`RawPoll` counts (Modbus) or `CloudSnapshot` payloads with `firstFetchedAt`/`lastFetchedAt`/`fetchCount` (cloud) match up to the dump time. *Stage 3b (after Phases 4 and 5):* the `energyTotals` equality check and the older-schema restore (V21, dump at `0002`, then apply exactly all pending migrations to the current schema (currently `0003_tariff`, `0004_raw_poll_monotonic`, `0005_soc_coverage`)). Phase 3 is signed off only when 3b passes.

### Phase 4: Accounting ledger, totals, reconciliation API (depends on Phase 2; uses NAS data once Phase 3 runs)
1. `src/accounting/integrate.ts`: pure; algorithm in the Accounting section.
2. `src/accounting/counters.ts`: pure state machine; Accounting section.
3. **Migration `0002_accounting`:** `EnergyInterval`, `AccountingPolicy`, `DataExclusion`, `CalculationRun`, `MeterReading`. `LedgerDirtyRange` and `DirtyReason` already exist (`0001_core`) and have been filled by Phase 2 ingest since the first sample, so no backfill insert is needed; the worker in item 4 consumes the pending rows.
4. **`src/accounting/ledger.service.ts`.**
   - **Dirty-range worker (every 60 s and at startup).** Work is defined by `LedgerDirtyRange` rows (`fromBucket`, `toBucket`, `reason`), not by a wall-clock lookback. Ingest (Phase 2.6, including retroactive `METER_STALE`), `createDataExclusion`/`deleteDataExclusion`, `RENORMALIZE`, `requestRecalculation`, and calculation-parameter policy changes insert dirty ranges in the same transaction as the change. `RENORMALIZE` inserts dirt with reason `RENORMALIZE`, which the worker bounds by `RAW_RETENTION_DAYS`; every other reason is bounded by `SAMPLE_RETENTION_DAYS`, and ranges of the two horizons are never merged. The worker merges overlapping same-horizon ranges and processes each merged range oldest-first in chunks of ≤ 1 local day. One chunk is one transaction: it upserts the `EnergyInterval` rows and updates the dirty row as described under Propagation (the row is never deleted before counter-state convergence). A crash rolls the chunk back and the range is re-processed; recomputation is a pure function of stored `Sample`s, exclusions, and policy, so re-running is idempotent (V5, V23). Only rows claimed by `id` are modified, so a range inserted while a chunk runs is picked up on the next pass. A second worker would be harmless (same results; claimed with `FOR UPDATE SKIP LOCKED`).
   - **Seeding.** Integration seeds from the single latest valid sample before the range start (an indexed lookup, however old; an interval integrates only if its gap ≤ `maxGapSec`). Counter processing seeds from the **preceding accepted baseline**: each `EnergyInterval` stores `counterState` (per counter: last accepted value and time, segment, pending confirmation candidates) at its end, and the worker loads the latest row with `bucketStart < fromBucket` regardless of age. A counter transition that begins before `fromBucket` (a long gap between that baseline and the first accepted reading in the range) widens the write range back to the baseline's bucket so gap-allocated energy is redistributed over the whole span.
   - **Lookahead.** A counter transition that STARTS inside a chunk but is resolved by a reading after the chunk end (including readings that are rejected as spikes first) still allocates its share of energy to the chunk's buckets: `computeRange` keeps stepping a copy of each counter's state through the samples at/after the range end until that transition resolves, and reports `lookaheadUnresolved` when the supplied samples ran out; the worker then loads more samples (growing batches) so a chunk is always identical to the same buckets of a whole-range pass. A range that is re-queued more than 20 times in one pass without progress is left pending with a warning (a correct ledger never hits this). That cap counts only chunks that commit; a transaction that throws or times out commits nothing and is not counted, so it does not bound work. Work is bounded structurally instead: a chunk writes at most one local day and never leaves one writable interval, verification never reaches below the writable interval start (under a raw horizon: the rebuilt window) and the 120 s transaction timeout is unchanged. Verification may still read several earlier local days, and counter lookahead may read samples beyond the written day, inside the same transaction; those reads are bounded by the counter anchor and the interval start, not by one day.
   - **Durable monitoring start.** `monitoringSince` is the earliest `AccountingPolicy.effectiveFrom`. The seeded v1 takes the earliest sample seen; if an earlier sample arrives later (out-of-order ingest), the earliest segment's `effectiveFrom` moves backwards to it (never forward), in the same transaction as the ledger pass, so it survives sample retention.
   - **`collectorStatus` accounting metadata.** `policyVersion` is the `version` of the non-superseded `AccountingPolicy` in force at server time, chosen by `selectSegment` (largest `effectiveFrom` ≤ now; on an equal `effectiveFrom` the higher version). Superseded and future-dated versions are ignored. `0` is the sentinel for "no policy in force" (nothing seeded yet, or every active version starts later); the field stays a non-null `Int`. `calcVersion` is the running ledger algorithm version, `LEDGER_ALGO_VERSION` (currently 3). It is not `BILLING_CALC_VERSION`, and it does not claim that every stored bucket was recomputed under it (buckets outside retention keep their stored `calcVersion`). `monitoringSince` is the same durable accounting start as above (earliest `AccountingPolicy.effectiveFrom`; Sample retention never moves it, delayed earlier data moves it backward) and is `null` while no accounting policy exists. `collectorStatus` is read-only and never creates or seeds a policy. If no policy has been created explicitly, it reports `policyVersion` 0 and `monitoringSince` null after the first samples arrive until the next ledger pass seeds policy v1; an ADMIN-created policy is reflected immediately according to the same selection and accounting-start rules. `energyTotals.monitoringSince` is unchanged and still falls back to the earliest retained Sample while no policy exists.
   - **Propagation (persisted continuation).** Inside each chunk transaction the worker compares the newly computed end-of-chunk `counterState` with the value stored for that bucket *before* overwriting it. If the chunk is not the end of the dirty range, the row's `fromBucket` advances to the chunk end. If it is the end and the states differ while later `EnergyInterval` rows exist, the row is **not** deleted: in the same transaction it becomes the continuation `[chunkEnd, min(chunkEnd + 1 day, frontier))`, where `frontier` is the end of the latest existing bucket (`max(bucketStart) + 300 s`), so the final stored bucket is itself recomputed when its predecessor's end state changed. The row is deleted only in the transaction whose end state equals the stored one (convergence) or that reaches the frontier. A crash at any point therefore leaves either the old row or the continuation row, never neither.
   - **Retention.** Ordinary recomputation needs `Sample`s, so it covers only buckets within `SAMPLE_RETENTION_DAYS`. A dirty range older than the cutoff is truncated there; older `EnergyInterval`s keep their stored values (flagged `OUTSIDE_RETENTION`, or `STALE_CALC_PARAMS` for a calculation-parameter change) and the originating mutation reports `outsideRetentionBefore`. The one exception is explicit `RENORMALIZE` dirt (reason `RENORMALIZE`, never merged with other reasons), bounded by `RAW_RETENTION_DAYS` because it first rebuilds `Sample`s from `RawPoll`. When raw retention exceeds sample retention: the *rebuilt window* is the requested range of a RUNNING `RENORMALIZE` run and that range never grows; below the sample cutoff the worker writes only inside a rebuilt window and never deletes a stored row; rows outside every window are authoritative (not rewritten, not re-verified, the nearest supplies the starting counter state, propagation stops there, at most the adjacent row after the window gets `OUTSIDE_RETENTION`); the request clamps its dirt to the window below the sample cutoff. The retention job never deletes a `Sample` at or after the earliest pending dirty `fromBucket`, nor one inside a RUNNING rebuilt window, and takes the same advisory reservation as `requestRecalculation` (lock 716071/7) without waiting, deferring Sample pruning to the next run when it is busy, so an uncommitted replay is never raced. Reconstruction from already-deleted data is never claimed.
   - If code constant `LEDGER_ALGO_VERSION` > a bucket's stored `calcVersion`, buckets within retention are marked dirty (`CalculationRun.kind = ALGO_UPGRADE`); older buckets keep their `calcVersion` and are flagged. Version 3 repairs supported retained acquisition validity before computation while preserving each Sample's historical mapping and decoded values; explicit RENORMALIZE instead uses the current mapping. Repair covers interpolation predecessors and grown counter lookahead. Corrections, dirty work, billing invalidation and the chunk commit are atomic; unsupported historical energy/version/NULL SOC evidence is retained, never fabricated.
   - Mutation `requestRecalculation(kind, from, to, reason)` inserts a dirty range clamped to retention and returns the `CalculationRun`; an overlapping concurrent request returns `RECALC_IN_PROGRESS`. `RENORMALIZE` rebuilds `Sample` rows from `RawPoll` with the current `MappingVersion` (within raw retention), then marks the same range dirty with reason `RENORMALIZE`, clamped to the requested range below the sample cutoff (see Retention).
5. **`src/accounting/policy.ts`.**
   - Policy segments: creating a version with `effectiveFrom = T` supersedes all active segments with `effectiveFrom ≥ T` (sets `supersededByVersion`). A bucket uses the active segment with the largest `effectiveFrom` ≤ bucket.
   - A seeded v1 has `effectiveFrom` = first sample.
   - **Two kinds of change, two contracts.** (a) *Source selection* (`gridSource`, `pvSource`, `batterySource`, `loadSource`, `validated`): every candidate is already stored per bucket, so there is no ledger recompute and no `CalculationRun`; only billing results of overlapping periods are invalidated (their stored `policyVersions` no longer match). (b) *Calculation parameters* (`maxGapSec`): they change integration validity, covered seconds, and counter gap-allocation flags, so `createAccountingPolicy` inserts a `CALC_PARAMS` dirty range over every bucket whose stored `maxGapSecUsed` differs from the effective segment's `maxGapSec` (clamped to sample retention), then invalidates billing. A bucket is current iff `(calcVersion, maxGapSecUsed)` equals `(LEDGER_ALGO_VERSION, effective maxGapSec)`.
   - The mutation returns `AccountingPolicyChange { policy, calculationRun?, billingPeriodsInvalidated, outsideRetentionBefore? }`. Buckets older than retention keep their old `maxGapSecUsed`; totals over them carry `STALE_CALC_PARAMS` and billing results carry `CALC_PARAMS_PARTIAL_RECOMPUTE`. Example: `maxGapSec` 30 → 60 s turns a 45-s interval at 1 kW from excluded to 12.5 Wh (V27).
6. **`src/accounting/totals.service.ts`.** Local-date ranges are converted to UTC bucket ranges with luxon. Weeks are ISO, starting Monday 00:00 local.
7. **`src/reconciliation/reconciliation.service.ts`.** Reconciliation section.
8. **GraphQL additions:**
   - queries `energyTotals`, `powerSeries`, `meterReadings`, `reconciliation`, `accountingPolicies`, `calculationRuns`
   - mutations `addMeterReading`, `deleteMeterReading`, `createAccountingPolicy`, `createDataExclusion`, `deleteDataExclusion`, `requestRecalculation`
9. **G5 on ≥ 24 h of NAS data** (`export-samples` → `analyze-capture`). Set AccountingPolicy v1 and update `docs/field-mapping.md`.

**Exit:**
- The unit scenarios V1–V7, V23, and V27 pass.
- On ≥ 24 h of NAS data: every completed day has a balance residual in [0%, 15%] or a `BALANCE_ANOMALY` event.
- `energyTotals` returns coverage and provenance for each quantity.

### Phase 5: Tariff and billing (depends on Phase 4 totals; parallel with Phase 6)
1. **Migration `0003_tariff`:** `Tariff`, `TariffVersion`, `TariffHoliday`, `TariffMonthlyRate`, `BillingPeriod`, `BillingPeriodResult`.
2. `src/tariff/rules.schema.ts`: zod `TariffRulesV1`; Pricing section.
3. `src/tariff/tou.ts`: `windowFor(bucketStartUtc, rules, holidays) → windowCode`. Window times must be multiples of 5 min (zod refine).
4. `src/tariff/engine.ts`: pure. `(quantities, rules, monthlyRates, nemOpeningState) → { lineItems, nem, subtotal, total, status, isLowerBound, reasons }`.
5. `src/tariff/billing.service.ts`: builds window quantities from the ledger and runs the engine.
   - Stores the latest `BillingPeriodResult` per period, replacing the previous one, with `calcVersion`, `mappingVersion`, `policyVersions`, `tariffVersionIds`, `computedAt`.
   - Recomputes when an overlapping tariff version, holiday, monthly rate, accounting-policy version (source selection or `maxGapSec`), or recalculation changes, when the reconciliation state it was computed with (`ACCOUNTING_UNRECONCILED` present or absent) no longer matches the current one (meter readings added or deleted), and hourly for the open period.
   - **NEM cascade.** After recomputing period A, compare the new `nem.closingLots` with the stored ones. If they differ, recompute the next chronological period of the same tariff (it consumes A's lots), then the next, and so on, stopping when a period's recomputed closing lots equal its stored ones or the next period has an independent `openingCreditLots` anchor from a bill. A missing intermediate `BillingPeriod` row breaks the chain (`NEM_CHAIN_GAP`) unless an anchor follows.
6. **GraphQL.**
   - Queries: `tariffs`, `billingPeriods`, `billingPeriod`.
   - Mutations: `createTariff`, `createTariffVersion(rules: String!)`, `setTariffHolidays`, `setMonthlyRate`, `upsertBillingPeriod`.
   - The rules JSON is validated by zod; issues come back as `BAD_USER_INPUT` with paths.
7. **Bill reproduction.**
   - For each user-provided bill, store a redacted `apps/backend/test/fixtures/bills/<YYYY-MM>.json`: period, printed import peak/off-peak kWh, export kWh, every line amount, NEM credit balances; no account number or address.
   - Test: engine(bill quantities) reproduces each line within RM 0.01 and the total within RM 0.01.
   - Set `TariffVersion.billVerified = true` only when this test passes. The only path is `node dist/cli/verify-bill.js --version <id> --fixture <path> --attest-real-bill`: the operator attests the fixture was transcribed from a REAL redacted bill; fixtures marked or located as synthetic are refused even with the flag; the fixture must carry the monthly and export-window splits the tariff needs (otherwise the reproduction refuses rather than inventing a distribution) and any explicit split must agree with the printed totals. Changing holidays, monthly rates or versions of a tariff revokes `billVerified` for its versions automatically. No GraphQL mutation can set it. Tests exercise this mechanism only, with synthetic rules in a disposable database; V18 itself requires a real bill and is unrun.

**Exit:** synthetic-tariff tests pass (V8). The bill reproduction passes when a bill has been provided; until then, results carry the reason `TARIFF_NOT_BILL_VERIFIED`.

### Phase 6: Electron dashboard (depends on Phase 4 GraphQL; cost views on Phase 5)
1. **Scaffold** `apps/desktop` from electron-vite's official `react-ts` template. Electron 44.7.2, electron-vite 6.0.0, React 19.3.1, TanStack Query 5.104.3, ECharts 6.1.0 via `echarts/core` with explicit chart/component imports. No UI kit, no router (tab state).
2. **`packages/contracts`.**
   - `src/operations/*.graphql` holds every operation the app uses.
   - `codegen.ts`: `@graphql-codegen/cli` with `typescript`, `typescript-operations`, and `typed-document-node`, reading `../../apps/backend/schema.gql`.
   - `src/index.ts` exports `OPERATIONS: Record<OperationName, TypedDocumentNode>` through the `@solar/contracts/operations` subpath. Runtime operations are imported only by main; the renderer imports types only.
3. **Security** (`src/main/security.ts`).
   - `BrowserWindow` `webPreferences`: `{ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }`. No `webviewTag`.
   - `setWindowOpenHandler(() => ({ action: 'deny' }))`. `will-navigate` → `preventDefault()` unless the URL starts with `app://renderer/` (or the dev-server URL in development).
   - `session.setPermissionRequestHandler((_, __, cb) => cb(false))`.
   - Production renderer is served through `protocol.handle('app', …)` (registered privileged `standard` + `secure`) with the header `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
   - Development uses the Vite dev server without CSP.
4. **API client in main** (`src/main/api-client.ts`).
   - For each trusted backend configuration, retire/close the previous transport and create a fresh UUID-named non-persistent Electron session with `cache: false`; do not reuse Chromium's cached certificate verdicts.
   - Accept only the configured hostname and matching canonical `sha256/<base64 SHA-256 of DER>` fingerprint; hash certificate DER when available, otherwise normalize Chromium's SHA-256 fingerprint. Reject other hosts, mismatches and retired callbacks with `-2`. Probing uses a temporary rejecting session, and re-pinning re-probes before accepting the user-confirmed fingerprint.
   - Requests: `ses.fetch(`${url}/graphql`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) })`.
   - Error classes: `TLS` (`net::ERR_CERT_*`), `NETWORK` (refused, unreachable, timeout), `AUTH` (401/403), `RATE_LIMITED` (429), `SERVER` (5xx), `GRAPHQL` (`errors[]`).
   - Connection-state machine: `NOT_CONFIGURED | CONNECTED | RECONNECTING{nextRetryAt} | AUTH_FAILED | TLS_MISMATCH`. Retry backoff 5, 10, 30, 60 s.
5. **Settings** (`src/main/settings-store.ts`).
   - `userData/settings.json`: `{ backendUrl, pinnedFingerprint }`.
   - `userData/token.bin` is an OS-encrypted JSON credential `{backendUrl, pinnedFingerprint, token}` bound to both settings values, not an unbound token string. Re-pinning deletes the old credential; without `safeStorage.isEncryptionAvailable()`, saving is refused.
6. **IPC** (`src/main/ipc.ts`, `src/preload/index.ts`).
   - The preload exposes `window.solar = { query(op, vars), settings: { get, probeCertificate, pinCertificate, saveToken, clear }, onConnectionState(cb) }`.
   - Each handler checks `event.senderFrame.url` (`app://renderer/` or the dev URL) and validates its payload with zod: `op` must be in `OPERATIONS`; `vars` must be JSON ≤ 64 KB; the URL must be `https://` with an IP or hostname. Unknown channels don't exist.
7. **First-run flow:**
   1. The user enters the URL.
   2. `probeCertificate` records the presented fingerprint (the connection is rejected while probing).
   3. The UI shows the fingerprint next to the instruction "compare with the `TLS certificate fingerprint` line in the TrueNAS app log or `token.js create` output".
   4. Confirm → pin.
   5. Paste the token → test `collectorStatus` → save.
8. **Views.** Renderer is in `src/renderer/views/*`. Every numeric value renders `—` with a reason tooltip when `null`, and a real `0 W` / `0.000 kWh` when zero.
   - **Overview.**
     - `EnergyFlow` SVG: Solar, Grid, Battery, and Home nodes around an Inverter hub, with arrows in the actual direction and labels in W. Line width has 3 tiers (< 100 W dashed grey; < 2 kW; ≥ 2 kW). A subtle CSS dash animation runs only when `freshness = LIVE` and `prefers-reduced-motion` is not set. No house artwork.
     - Cards: Solar W (with strings), Home W (derived, with the vendor figure in a tooltip), Grid W (import/export label plus per-phase), Battery W, SOC %, and charging/discharging/idle state.
     - Operating mode (read-only, with its age). Today's local-day energy with coverage. Accounting status chip: `UNRECONCILED | RECONCILED | RECONCILIATION_FAILED | MAPPING_PROVISIONAL`.
   - **History.**
     - Power chart from `powerSeries`, with nulls as gaps (`connectNulls: false`) and `markArea` shading for `gaps`.
     - Day/week/month/year energy bars from `energyTotals`.
     - SOC curve.
   - **Usage & Cost.**
     - Range picker (day/week/month/year/custom) with totals per quantity, a provenance badge, coverage, and `monitoringSince`.
     - A billing-period list with line items, the NEM credit lots (origin and remaining kWh), status and reasons. A "≥" marker appears only when `isLowerBound` is true (never for the NEM tariff, where missing export can omit credits); otherwise an estimated cost shows an "estimate: may be higher or lower" chip with its reasons.
     - Fixed caption: "Calculated from measured grid import/export under your configured tariff; not your TNB bill."
   - **Data Quality.**
     - Collector status, device identity, mapping/policy/calc versions, last backup, and TLS expiry.
     - Gaps and events list; daily comparison of our totals against inverter counters and inverter `*_today` registers (labelled `VENDOR_SUMMARY`).
     - Reconciliation table.
   - **Settings.**
     - Connection, and tariff editor: a JSON textarea plus a "TNB RP4 ToU + NEM template" button that inserts the structure with empty rates, which must be filled from the bill before save.
     - Holidays, monthly rates, billing periods, meter readings, accounting policy, and exclusions. Mutating controls are hidden for VIEWER tokens.
9. **Polling and staleness.**
   - Polling: `liveStatus` every 10 s, `collectorStatus` every 30 s, everything else on demand.
   - When unreachable, keep the last data and grey it out, showing the banner "Backend unreachable since HH:MM — last data HH:MM:SS (X min ago). Collection runs on the NAS independently of this app."
   - Freshness uses the server-computed `ageSeconds`, so the PC clock doesn't matter.
   - Ordinary and infinite query keys include a credential-free connection epoch. Forgetting/replacing a backend cancels/removes old cache before the new epoch reads data. Meter-reading pagination follows `endCursor`/`hasNextPage`; load-more is disabled during fetch, and failed next pages preserve loaded rows and the retry cursor.
   - Saving a replacement token immediately publishes `CONNECTED(UNKNOWN)` after authenticated status succeeds; ADMIN controls stay hidden until the role of that token is verified. Role retries after ordinary query success are detached and generation/token-fenced; old-token completions cannot grant controls.
   - **Added by M7 (implementation record).** The backend gained read-only queries `viewerRole: String!` (so the app can hide mutating controls for VIEWER tokens), `tariffHolidays(tariffId, year)`, `tariffMonthlyRates(tariffId)`, `dataExclusions(first)` (so Settings can show current values) and `collectorStatus.siteTimezone` (so day ranges follow the site zone, not the PC zone). The preload is built as CommonJS (`preload/index.cjs`): a sandboxed preload cannot be an ES module. The token is stored in one encrypted blob bound to the backend URL and certificate fingerprint; re-pinning deletes the token first. DevTools are off and Electron fuses (`runAsNode`, `NODE_OPTIONS`, `--inspect` off; asar-only) are set in the packaged build; `ELECTRON_RENDERER_URL` is honoured only in unpackaged development. `win.signAndEditExecutable: false` avoids a Windows symlink-privilege failure while extracting `winCodeSign` (the installer is unsigned anyway, so the executable carries default Electron metadata and icon).
10. **Packaging.** `electron-builder.yml`: `appId: com.captainslow.housesolar`; `win.target: nsis` (x64); `nsis.oneClick: false`, `perMachine: false`; `asar: true`; no auto-update. The installer is unsigned, so SmartScreen will warn (this is documented).

**Exit:** V12–V15.

### Phase 7: End-to-end verification and reconciliation (G6 starts when Phase 3 runs; final sign-off after Phases 4–6)
1. **Meter reading protocol.** The user photographs the TNB meter's import and export registers, plus any ToU registers it shows, at day 0 and day 7, then on each bill date. Enter each reading with the photo's EXIF time via `addMeterReading`.
2. Run the verification scenarios.
3. Apply the reconciliation decision rule. Any policy change is an explicit admin `createAccountingPolicy` call.

## Data model (Prisma outline; `@db.Timestamptz(3)` for every instant)

```prisma
enum DeviceRole { INVERTER }
enum PollTier { DETECT FAST SLOW SETTINGS }
enum QualityEventKind { GAP DB_UNAVAILABLE CONNECTION_LOST METER_LINK_DOWN METER_STALE BLOCK_INVALID COUNTER_RESET COUNTER_JUMP_REJECTED COUNTER_DISCONTINUITY CLOCK_STEP DEVICE_REPLACED CAPABILITY_CHANGED IDENTITY_MISMATCH NEGATIVE_DERIVED_LOAD BALANCE_ANOMALY FAULT_ACTIVE ACQUISITION_SOURCE_CHANGED CLOUD_AUTH_FAILED }
enum CalcKind { LEDGER_RECOMPUTE RENORMALIZE ALGO_UPGRADE CALC_PARAMS_CHANGE BILLING }
enum DirtyReason { INGEST EXCLUSION RENORMALIZE RECALC_REQUEST CALC_PARAMS ALGO_UPGRADE }
enum TokenRole { VIEWER ADMIN }
enum MeterReadingSource { UTILITY_METER_MANUAL HOYMILES_METER_LCD }
enum BillingStatus { COMPLETE ESTIMATED UNAVAILABLE }

model DataSource   { id Int @id @default(autoincrement())  kind String /* "MODBUS_TCP" */  endpoint String /* "<ip>:502#1" */  createdAt DateTime }
model Device       { id Int @id  dataSourceId Int  deviceKey String /* configured DEVICE_KEY */  role DeviceRole  model String
                     observedCapabilities Json /* hasBattery, hasGridMeter, mpptCount, batteryCapacityKwh: live observations, never identity */  capabilitiesObservedAt DateTime
                     firmware Json  latestStatus Json?  firstSeenAt DateTime  lastSeenAt DateTime  retiredAt DateTime?  replacementReason String?
                     @@index([dataSourceId, retiredAt]) /* the migration SQL adds a partial unique index on (dataSourceId, deviceKey) WHERE retiredAt IS NULL */ }
model CollectorRun { id Int @id  startedAt DateTime  endedAt DateTime?  appVersion String  registerMapVersion String /* "hoymiles-g3-modbus-tcp@78c620d+N" */  endReason String? }
model MappingVersion { version Int @id  config Json  provisional Boolean  note String  createdAt DateTime }
model RawPoll      { id BigInt @id @default(autoincrement())  runId Int  seq Int  deviceId Int  tier PollTier
                     requestedAt DateTime  receivedAt DateTime  observedAt DateTime
                     monotonicMs Float?  acquisitionClockStep Boolean?  acquisitionMeterRepeatSec Int? /* immutable FAST facts; NULL = legacy/non-FAST, not inferred timing */
                     blocks Bytes /* per block: fc u8, start u16, count u16, ok u8, words u16[] */  contentHash Bytes
                     @@unique([runId, seq])  @@index([deviceId, observedAt])  @@index([deviceId, runId, seq]) }
model Sample       { id BigInt @id @default(autoincrement())  rawPollId BigInt @unique  deviceId Int  observedAt DateTime  mappingVersion Int
                     meterLink Int?  gridW Int?  gridAW Int?  gridBW Int?  gridCW Int?  gridVoltA Decimal? @db.Decimal(5,1) /* B, C likewise */
                     gridPortW Int? /* 2165 as read */  inverterAcW Int?  epsW Int?  pvW Int?  pvStringW Int[]
                     batteryW Int?  batteryBmsW Int?  batterySoc Int?  batteryState Int?  loadVendorW Int?  loadVendorTotalW Int?
                     pvWh BigInt?  gridBuyWh BigInt?  gridSellWh BigInt?  gridBuyPhaseWh BigInt[]  gridSellPhaseWh BigInt[]
                     batChargeWh BigInt?  batDischargeWh BigInt?  loadUseWh BigInt?  vendorToday Json? /* Wh */
                     meterRepeatSec Int  flags Int
                     @@unique([deviceId, observedAt])  @@index([observedAt]) }
model DataQualityEvent { id BigInt @id  deviceId Int?  kind QualityEventKind  startedAt DateTime  endedAt DateTime?  details Json  createdAt DateTime  @@index([kind, startedAt]) }
model DataExclusion    { id Int @id  from DateTime  to DateTime  families String[] /* GRID PV BATTERY LOAD ALL */  reason String  createdBy String  createdAt DateTime }
model AccountingPolicy { version Int @id  effectiveFrom DateTime  supersededByVersion Int?
                         /* source selection: changing these never recomputes the ledger */
                         gridSource String /* METER_NET | METER_PER_PHASE | INVERTER_COUNTER */  pvSource String /* COUNTER | INTEGRATED */
                         batterySource String /* COUNTER | INTEGRATED */  loadSource String /* DERIVED | VENDOR_COUNTER */
                         /* calculation parameter: changing it recomputes integrations, coverage and counter allocation */
                         maxGapSec Int  validated Json /* {grid: bool, pv: bool, ...} from G5/G6 */  note String  createdAt DateTime }
model EnergyInterval { bucketStart DateTime @id @db.Timestamptz(0) /* UTC, 300 s */  calcVersion Int  maxGapSecUsed Int  mappingVersion Int  computedAt DateTime
                       gridImportNetWh Decimal? @db.Decimal(12,3)  /* likewise: */ gridExportNetWh gridImportPhaseWh gridExportPhaseWh gridImportCounterWh gridExportCounterWh
                       pvIntWh pvCounterWh batChargeIntWh batDischargeIntWh batChargeCounterWh batDischargeCounterWh loadDerivedWh loadCounterWh
                       gridCoveredSec Int  pvCoveredSec Int  batCoveredSec Int  loadCoveredSec Int   /* 0..300 */
                       socCoveredSec Int? /* independent valid occupied 10-s SOC slots; NULL = unreconstructed historical evidence */
                       gridPhaseCoveredSec Int? /* seconds where all three normalized phases were valid = METER_PER_PHASE coverage; NULL = stored before 0006, readers fall back to gridCoveredSec */
                       counterUnknownSec Int[] /* 6 entries, CounterKey order PV,GRID_BUY,GRID_SELL,BAT_CHARGE,BAT_DISCHARGE,LOAD_USE */
                       counterGapAllocMask Int  flags Int  counterState Json? /* end-of-bucket per-counter state: last accepted value/time, segment, pending candidates; seeds recovery */
                       gridAvgW Int? gridMinW Int? gridMaxW Int? pvAvgW Int? pvMaxW Int? batAvgW Int? loadAvgW Int? loadMaxW Int? socMin Int? socMax Int? socLast Int? }
model CalculationRun { id Int @id  kind CalcKind  reason String  rangeStart DateTime  rangeEnd DateTime  calcVersion Int  mappingVersion Int
                       startedAt DateTime  finishedAt DateTime?  status String /* RUNNING|DONE|FAILED */  error String? }
model LedgerDirtyRange { id BigInt @id @default(autoincrement())  fromBucket DateTime @db.Timestamptz(0)  toBucket DateTime @db.Timestamptz(0) /* exclusive */  reason DirtyReason  createdAt DateTime  @@index([fromBucket]) }
model MeterReading { id Int @id  readAt DateTime  importKwh Decimal @db.Decimal(12,3)  exportKwh Decimal? @db.Decimal(12,3)
                     importPeakKwh Decimal? @db.Decimal(12,3)  importOffpeakKwh Decimal? @db.Decimal(12,3)  resolutionKwh Decimal @db.Decimal(6,3) @default(1)
                     source MeterReadingSource  note String?  createdAt DateTime  @@unique([readAt, source]) }
model Tariff            { id Int @id  name String  currency String @db.Char(3)  timezone String }
model TariffVersion     { id Int @id  tariffId Int  effectiveFrom DateTime @db.Date  effectiveTo DateTime? @db.Date  rulesSchemaVersion Int  rules Json
                          sourceNote String  billVerified Boolean @default(false)  createdAt DateTime  @@index([tariffId, effectiveFrom]) }
model TariffHoliday     { tariffId Int  date DateTime @db.Date  name String  @@id([tariffId, date]) }
model TariffMonthlyRate { tariffId Int  componentCode String  month String @db.Char(7)  ratePerKwh Decimal @db.Decimal(12,6)  sourceNote String  @@id([tariffId, componentCode, month]) }
model BillingPeriod     { id Int @id  tariffId Int  startDate DateTime @db.Date  endDate DateTime @db.Date /* inclusive */
                          openingCreditLots Json? /* independent anchor from a bill: [{originStart:"YYYY-MM-DD", kwh:"12.000"}]; null = chain from the previous period's closing lots */  bill Json? /* printed quantities + lines */  note String?  @@unique([tariffId, startDate]) }
model BillingPeriodResult { billingPeriodId Int @id  computedAt DateTime  calcVersion Int  mappingVersion Int  policyVersions Int[]  tariffVersionIds Int[]
                            quantities Json  lineItems Json  nem Json /* openingLots, expiredLots, consumedLots, closingLots; each lot keeps its originStart */  subtotal Decimal? @db.Decimal(12,2)  total Decimal? @db.Decimal(12,2)
                            status BillingStatus  reasons String[]  isLowerBound Boolean /* true only under the Pricing step 6 conditions */  coverage Decimal @db.Decimal(5,4) }
model ApiToken { id Int @id  name String @unique  role TokenRole  tokenHash Bytes @unique  createdAt DateTime  lastUsedAt DateTime?  revokedAt DateTime? }
```

Data-model rules:
- **Null vs zero.** A null Wh or W means unknown. `0` means a measured zero.
- **Units.** All W values are Int. Energies are Wh `Decimal(12,3)` internally and kWh `Decimal` strings (3 dp) in GraphQL. Money is `Decimal(12,2)`. Rates are `Decimal(12,6)`, stored as strings inside the rules JSON.
- **Precision.** Integrate exact millisecond intervals; round each stored bucket Wh to `Decimal(12,3)`. Sum persisted fractional Wh as Decimal and round final `energyTotals` kWh once to three decimals. Whole covered seconds are separately floored after millisecond-noise snapping; this never truncates energy. Individually rounded counter allocations need not conserve an unrounded delta exactly.
- **Bucket mapping provenance.** `EnergyInterval.mappingVersion` represents the last original observation strictly before the bucket end (including the seed), falling back to the first future observation only without a predecessor. Each Sample retains its own mapping for validity; a mixed-mapping bucket is not reinterpreted under a single representative mapping.
- **Deduplication.**
  - `Sample` is unique on `(deviceId, observedAt)` and `RawPoll` on `(runId, seq)`, never on timestamp alone.
  - A repeated device sample (unchanged 1800–1827 words) is still stored as a new observation. It is distinguished by `meterRepeatSec` and becomes `METER_STALE` beyond `maxRepeatSpanSec`.
  - `MeterReading` is unique on `(readAt, source)`.
- **Restart progress.** Ledger progress is the set of pending `LedgerDirtyRange` rows, written in the same transaction as the change that dirtied them and removed only with the chunk that recomputed them. Ingest needs no watermark, because each run gets a new `runId` and has a unique `seq`.
- **Retention.**
  - `RawPoll` and `Sample` are kept 400 days. That covers a full year plus one billing cycle, which is the re-normalization horizon.
  - `EnergyInterval`, billing tables, readings, and events are kept forever.
  - The original 5–6 GB estimate is superseded by a historical synthetic measurement: the 400-day mixed-tier fixture occupied **10,165,166,607 bytes before ledger generation**, with **3,772,340,636 encoded payload bytes** (`docs/operations.md:369`). This is not a measured NAS steady-state size; allow separate headroom for WAL/growth, durable intervals/events, backups and retained pre-upgrade archives, and size from actual site measurements.
- **Recompute horizon.** Ordinary recomputation and algorithm upgrades use `SAMPLE_RETENTION_DAYS`; explicit RENORMALIZE rebuilds Samples within `RAW_RETENTION_DAYS`. Below the sample cutoff, only requested RUNNING rebuilt windows are writable when raw retention is longer; other history stays authoritative. Use the complete Phase 4.4 retention/propagation rules, including fixed raw-horizon run ranges versus normal following-propagation ranges under equal retention. Deleted evidence is not reconstructible; unsupported historical buckets retain their values and provenance.

## GraphQL contract outline

The checked-in current code-first SDL is `apps/backend/schema.gql`, consumed by `packages/contracts/codegen.ts`. The A1-only `SNAPSHOT`, `VendorLive`, `VendorDay`, `vendorLive` and `vendorDaily` entries below are deferred design, not implemented API or acceptance. Recorded M7 read-only additions are included below. The 2026-10-24 contract decisions (defaulted arguments, `powerSeries` cap, `collectorStatus` metadata, meter-total `METER_NET`) are recorded in the rules below; an outline is not proof of runtime behaviour.

```graphql
scalar DateTime    # ISO-8601 UTC
scalar LocalDate   # YYYY-MM-DD in SITE_TIMEZONE
scalar Decimal     # string, e.g. "12.345"; never a JSON number

enum Provenance { MEASURED_INTEGRATED DEVICE_COUNTER DERIVED ESTIMATED VENDOR_SUMMARY }
enum ValueStatus { OK PARTIAL STALE UNAVAILABLE }
enum Freshness { LIVE STALE NO_DATA SNAPSHOT }   # LIVE iff known measurement age <= 30 s (server-side); SNAPSHOT = cloud snapshot with unknown measurement time (Amendment A1)
enum Granularity { DAY WEEK MONTH YEAR }
enum PowerMetric { PV LOAD LOAD_VENDOR GRID GRID_A GRID_B GRID_C BATTERY SOC INVERTER_AC }
enum AccountingStatus { MAPPING_PROVISIONAL UNRECONCILED RECONCILED RECONCILIATION_FAILED }

type PowerValue  { watts: Int  status: ValueStatus!  reason: String }
type LiveStatus  { serverTime: DateTime!  observedAt: DateTime  ageSeconds: Int  freshness: Freshness!
                   pv: PowerValue!  pvStrings: [PowerValue!]!  load: PowerValue!  loadVendor: PowerValue!
                   grid: PowerValue!  gridPhases: [PowerValue!]!  battery: PowerValue!  batterySoc: Int  batteryState: String
                   operatingMode: OperatingMode  meterLink: String  activeFaults: [String!]!  accountingStatus: AccountingStatus! }
type VendorLive { source: String! provenance: Provenance! fetchedAt: DateTime!  /* = lastFetchedAt */ measuredAt: DateTime  snapshotAgeSeconds: Int!  freshness: Freshness!  pvW: Int  loadW: Int  gridW: Int  batteryW: Int  batterySoc: Int  mode: String }
type VendorDay  { date: LocalDate!  provenance: Provenance!  solarKwh: Decimal  consumptionKwh: Decimal  gridImportKwh: Decimal  gridExportKwh: Decimal  batteryChargeKwh: Decimal  batteryDischargeKwh: Decimal  counterFamily: String }
type OperatingMode { code: Int!  label: String!  observedAt: DateTime! }
type CollectorStatus { acquisitionSource: String! /* MODBUS|CLOUD|NONE */  state: String!  lastSuccessAt: DateTime  lastErrorAt: DateTime  lastError: String  consecutiveFailures: Int!  nextRetryAt: DateTime
                       device: Device  mappingVersion: Int!  policyVersion: Int!  calcVersion: Int!  monitoringSince: DateTime
                       siteTimezone: String!  lastBackupAt: DateTime  tlsCertExpiresAt: DateTime! }
type EnergyValue { kwh: Decimal  provenance: Provenance!  source: String!  validated: Boolean!  coverage: Decimal!  status: ValueStatus!  flags: [String!]! }
type WindowEnergy { window: String!  importKwh: EnergyValue!  exportKwh: EnergyValue! }
type EnergyRow   { periodStart: LocalDate!  periodEnd: LocalDate!
                   solar: EnergyValue!  consumption: EnergyValue!  gridImport: EnergyValue!  gridExport: EnergyValue!
                   batteryCharge: EnergyValue!  batteryDischarge: EnergyValue!  gridByWindow: [WindowEnergy!]!
                   vendor: VendorComparison! }   # inverter counters + *_today registers, provenance DEVICE_COUNTER / VENDOR_SUMMARY
type EnergyTotals { monitoringSince: DateTime  preMonitoringExcluded: Boolean!  lastSourceUpdate: DateTime  rows: [EnergyRow!]!  total: EnergyRow! }
type SeriesPoint { t: DateTime!  avg: Int  min: Int  max: Int  coverage: Decimal! }
type PowerSeries { bucketSeconds: Int!  series: [MetricSeries!]!  gaps: [TimeRange!]! }
type BillingPeriodResult { status: BillingStatus!  total: Decimal  subtotal: Decimal  reasons: [String!]!  coverage: Decimal!
                           isLowerBound: Boolean!   # true ONLY for the closed list of provably monotone tariff shapes in Pricing step 6 (no NEM, flat non-negative rates, only import missing). Otherwise false: missing grid data may omit export credits or imports, and tiers can make cost fall as import rises, so an ESTIMATED total can be above or below the complete bill.
                           nem: NemState  lineItems: [LineItem!]! }
type NemState { openingLots: [CreditLot!]!  expiredLots: [CreditLot!]!  closingLots: [CreditLot!]! }
type CreditLot { originStart: LocalDate!  kwh: Decimal! }

type Query {
  liveStatus: LiveStatus!
  vendorLive: VendorLive            # cloud track only (Amendment A1); null unless acquisitionSource = CLOUD
  vendorDaily(fromDate: LocalDate!, toDate: LocalDate!): [VendorDay!]!   # <= 366 days
  collectorStatus: CollectorStatus!
  viewerRole: String!
  tariffHolidays(tariffId: Int!, year: Int!): [TariffHoliday!]!
  tariffMonthlyRates(tariffId: Int!): [TariffMonthlyRate!]!
  dataExclusions(first: Int! = 100): [DataExclusion!]!   # <= 200; bounded list, not a Relay connection
  powerSeries(from: DateTime!, to: DateTime!, metrics: [PowerMetric!]!, maxPoints: Int! = 1000): PowerSeries!   # to-from <= 366 d; 1 <= maxPoints <= 2000
  energyTotals(fromDate: LocalDate!, toDate: LocalDate!, granularity: Granularity!, tariffId: Int): EnergyTotals! # inclusive LocalDate endpoints; <= 1000 rows; explicit tariff enables gridByWindow, no implicit selection
  billingPeriods(first: Int! = 24, after: String): BillingPeriodConnection!                                   # 1 <= first <= 100
  billingPeriod(id: Int!): BillingPeriod
  meterReadings(first: Int! = 50, after: String): MeterReadingConnection!                                     # 1 <= first <= 100
  reconciliation(fromReadingId: Int!, toReadingId: Int!): Reconciliation!   # one row per candidate source
  dataQualityEvents(from: DateTime!, to: DateTime!, kinds: [String!], first: Int = 100, after: String): DataQualityEventConnection!
  tariffs: [Tariff!]!
  accountingPolicies: [AccountingPolicy!]!
  calculationRuns(first: Int! = 20, after: String): CalculationRunConnection!                                 # 1 <= first <= 100
  devices: [Device!]!
}
type Mutation {   # ADMIN only; none touch the device
  addMeterReading(input: MeterReadingInput!): MeterReading!        deleteMeterReading(id: Int!): Boolean!
  createAccountingPolicy(input: AccountingPolicyInput!): AccountingPolicyChange!   # ledger recompute only if maxGapSec changes; source-only changes invalidate billing only
  createDataExclusion(input: DataExclusionInput!): DataExclusion!  deleteDataExclusion(id: Int!): Boolean!
  requestRecalculation(kind: String!, from: DateTime!, to: DateTime!, reason: String!): CalculationRun!
  createTariff(input: TariffInput!): Tariff!
  createTariffVersion(tariffId: Int!, effectiveFrom: LocalDate!, effectiveTo: LocalDate, rules: String!, sourceNote: String!): TariffVersion!
  setTariffHolidays(tariffId: Int!, year: Int!, holidays: [HolidayInput!]!): [TariffHoliday!]!
  setMonthlyRate(tariffId: Int!, componentCode: String!, month: String!, ratePerKwh: Decimal!, sourceNote: String!): TariffMonthlyRate!
  upsertBillingPeriod(input: BillingPeriodInput!): BillingPeriod!
}
```

Contract rules:
- **Pagination.** Relay connections with an opaque base64 cursor of `id`.
- **Defaulted arguments.** `powerSeries.maxPoints`, `billingPeriods.first`, `meterReadings.first` and `calculationRuns.first` are non-null with a schema default (`Int! = 1000/24/50/20`): omitting the argument uses the default, while an explicit `null` is invalid: a literal `null` fails GraphQL query validation, and a `null` variable fails variable coercion (`Argument "maxPoints" must not be null`) before the resolver runs, though the error code can differ between the two paths. `dataQualityEvents.first` is the deliberate exception: it stays nullable (`Int = 100`), so omission and an explicit `null` both mean 100.
- **`powerSeries` downsampling.** `maxPoints` is a hard maximum on points per metric; every supported request (0 < to − from ≤ 366 d, integer 1 ≤ maxPoints ≤ 2000) is answered, covering the whole `[from, to)` with epoch-aligned or ledger-aligned buckets, never truncated. Bucket width is the smallest of [10 s, 30 s, 60 s, 300 s, 900 s, 3600 s, 10800 s, 86400 s] whose epoch-aligned bucket count `ceil((to − floor(from/width)·width)/width)` is ≤ maxPoints (an unaligned `from` can add one bucket over (to − from)/width). If no table width fits (for example an epoch-unaligned 366-day span with maxPoints below 367, or maxPoints = 1 with a window crossing a boundary of every width), the grid is anchored at the 300 s ledger boundary at or before `from` and uses the smallest whole multiple of 300 s whose count is ≤ maxPoints. `bucketSeconds` is that width (an `Int`). For an epoch-aligned table width, the first bucket starts less than `bucketSeconds` before `from`; for the fallback grid, it starts less than 300 s before `from`. Coverage and gaps are clipped to the requested range.
  - Widths < 300 s aggregate `Sample` rows within retention.
  - Widths ≥ 300 s aggregate `EnergyInterval` statistics for the metrics it stores (PV, LOAD, GRID, BATTERY, SOC). `EnergyInterval` has no per-phase, vendor-load or inverter-AC statistics, so `GRID_A/B/C`, `LOAD_VENDOR` and `INVERTER_AC` are aggregated from `Sample` at every width (SQL `avg/min/max`), valid only within `SAMPLE_RETENTION_DAYS`; older points are null and listed in `gaps`.
  - Every point has nullable avg/min/max and coverage. Fine SOC counts distinct valid occupied ten-second observation slots. Coarse SOC has `avg = null`, independent `socCoveredSec`, and whole-bucket extrema; partial historical buckets use conservative covered seconds `max(0, queriedSeconds - (300 - socCoveredSec))`. Historical NULL coverage remains unknown: the API exposes no invented coverage and includes a gap, but can retain known SOC min/max even at coverage 0. Other coverage-0 points have null statistics.
  - Metrics must be a nonempty list of at most ten supported entries before database work; bounded duplicates are deduplicated in selection order. Repetition cannot multiply point allocation beyond the supported metric count.
  - `energyTotals` window breakdowns require an explicit `tariffId` and effective versions covering the requested window; tariff-local windows/holidays classify each bucket, while result rows retain site-local dates. Omission leaves `gridByWindow` empty rather than guessing a tariff. `vendor.lifetime` is the final raw counter reading in the range (includes pre-monitoring, unvalidated); `vendor.intervalDelta` is the separately labelled within-range last-minus-first comparison.

## Accounting algorithms

**Canonical per-sample powers** (W, after the `MappingConfig` signs):
- `P_grid` = meter total, + import; `P_grid,φ` per phase.
- `P_inv` = Σ 74–76, + output to the house.
- `P_eps` = Σ 92–94.
- `P_pv` = Σ PV string power.
- `P_bat`, + discharge.
- `P_house` = `P_grid` + `P_inv` + `P_eps`.

`P_house` excludes battery charging and inverter self-use. Grid-charging appears as `P_inv` < 0 and therefore never adds to household consumption. The grid import it causes is billed once.

**Family validity.**

| Family | Invalid when |
|---|---|
| Grid | `METER_LINK_DOWN \| METER_COMM_FAULT \| METER_STALE \| BLOCK_INVALID_1800 \| CLOCK_STEP` |
| PV | `BLOCK_INVALID_0 \| CLOCK_STEP` |
| Battery power | selected Sample mapping only: `BLOCK_INVALID_1800` for `BMS_1914`, or `BLOCK_INVALID_0` for `BAT1_POWER_G3_50`; plus `CLOCK_STEP` |
| SOC | `BLOCK_INVALID_1800 \| CLOCK_STEP`, independently of the battery-power source; BATTERY/ALL exclusions also apply |
| Load | grid invalid, `BLOCK_INVALID_0`, or `NEGATIVE_DERIVED_LOAD` (`P_house` < −50 W; values in [−50, 0) are integrated as-is, never clamped) |
| Counters | `BLOCK_INVALID_2000` |

`DataExclusion` windows invalidate the listed families. Invalid means unknown; it is never zero.

**Power integration** (`integrate.ts`). For consecutive valid samples (t₀, P₀), (t₁, P₁) with Δt = t₁ − t₀ (wall-clock `observedAt`):
- **Validity.** If 0 < Δt ≤ `maxGapSec` (default 30 s; an effective-dated policy calculation parameter, stored per bucket as `maxGapSecUsed`): integrate. Otherwise: no energy, the overlapped buckets get the family's GAP flag, and their covered seconds are not counted. A 45-s interval at 1 kW is excluded at 30 s and contributes 12.5 Wh at 60 s.
- **Trapezoid with directional split.**
  - Same sign: area = (P₀ + P₁)/2 · Δt, credited to that direction.
  - Sign change: zero crossing at τ = Δt·\|P₀\|/(\|P₀\| + \|P₁\|). Credit \|P₀\|·τ/2 to P₀'s direction and \|P₁\|·(Δt − τ)/2 to P₁'s direction.
  - Import and export are never netted against each other.
- **Bucket boundaries** inside an interval are split by linear interpolation of P at the boundary. Wh = W·s/3600.
- **Grid netting modes.**
  - `METER_NET` applies the directional split to the normalized external-meter **total** P_grid (register 1814, `Sample.gridW`) for each integration interval. It is never derived from the phases: if the total is unknown or invalid for an interval, that interval is unknown for `METER_NET` (grid gap) even when all three phases are valid.
  - `METER_PER_PHASE` applies the split to each normalized phase P_grid,φ (1808/1810/1812) and sums the directional results. It needs all three phases and never falls back to the total. `METER_PER_PHASE` has its own coverage column, `gridPhaseCoveredSec` (migration `0006_grid_phase_coverage`): the seconds in which all three normalized phases were valid, exactly the time `gridImportPhaseWh`/`gridExportPhaseWh` integrate (the minimum over the phases, never a sum). `gridCoveredSec` stays the meter-total coverage; totals, reconciliation and billing use the coverage of the active grid candidate (`METER_NET` → `gridCoveredSec`, `METER_PER_PHASE` → `gridPhaseCoveredSec`, `INVERTER_COUNTER` → counter coverage). With the total missing and all three phases valid, `METER_PER_PHASE` reads full coverage while `METER_NET` reads 0 s; with the total valid and a phase missing it is the reverse. `gridPhaseCoveredSec` is NULL for rows stored before the migration (unknown, not zero): readers fall back to `gridCoveredSec` for them until ordinary ledger recomputation rewrites the bucket, and recovery verification ignores a stored NULL in this column so it never rewrites old buckets by itself. `LEDGER_ALGO_VERSION` (3) and `BILLING_CALC_VERSION` (2) are unchanged. The shared `GRID_GAP` flag is still raised by a gap in the total or in any phase, so it can over-report a gap for the active candidate but never hides one.
  - The two candidates are independent inputs and can differ (opposite phase flow; a reported total that is not the phase sum). Both are always stored (`gridImportNetWh`/`gridExportNetWh`, `gridImportPhaseWh`/`gridExportPhaseWh`). These definitions record software semantics, not verified physical accuracy; signs, CT location and cadence stay provisional until G3/G5/G6.
- **Uncertainty.** Meter/CT accuracy class (unknown; a typical class-1 meter is ±1%), plus sampling error quantified in G4 (2-s vs 10-s integration), plus 1 W quantization. The stated per-source text lives in `docs/field-mapping.md`.

**Counters** (`counters.ts`, per `CounterKey`, Wh, accepted readings only).
- **Baseline.** The first reading is unconfirmed until the next reading v′ satisfies 0 ≤ v′ − v ≤ limit(Δt_h); if v′ does not confirm it, the unconfirmed baseline is discarded and v′ becomes the new unconfirmed baseline (no energy accrues while unconfirmed; the energy between a baseline and its confirming reading is counted once confirmed).
- **Rate limits.** Counters are in Wh, so with R in kW (= kWh/h) the limit for an interval of Δt_h hours is **limit(Δt_h) = 1000·R·Δt_h + 200 Wh**. R (kW) = PV 15, GRID_BUY 60, GRID_SELL 15, BAT_CHARGE 15, BAT_DISCHARGE 15, LOAD_USE 60. Example: 500 Wh over 30 min (a constant 1 kW) is far below the GRID_BUY limit of 1000·60·0.5 + 200 = 30,200 Wh and is accepted. The same `limit()` governs baseline confirmation, ordinary transitions, the "mutually consistent" checks for reset/discontinuity, and the post-wrap delta.

For each new reading, with d = v − v_last:

| Case | Rule | Energy over (t_last, t] |
|---|---|---|
| 0 ≤ d ≤ limit(Δt_h) | Accept | d |
| d < 0 and v ≤ 1000 Wh | **Reset**: new segment; new baseline after confirmation | Unknown (counted in `counterUnknownSec`); event `COUNTER_RESET` |
| d < 0 otherwise, or d > limit(Δt_h) | **Reject**; keep the previous value | Event `COUNTER_JUMP_REJECTED` |
| 3 consecutive readings at a new level, each pair within limit(its Δt_h) | **Discontinuity**: new segment whose confirmed baseline is the third reading | Not counted (unknown from the last accepted reading to the third); event `COUNTER_DISCONTINUITY` |
| v_last > 0.9·W and v < 0.1·W, where W = 2³²·100 Wh | **Wrap**: d = v + W − v_last, then d ≤ limit(Δt_h) | As accepted |

- **Allocation.** Accepted d is allocated to buckets by time.
- **Gaps.** If Δt > `maxGapSec`, d is still valid energy (Δt runs from the last *accepted* baseline, which may be hours or days earlier), but its time distribution is unknown: allocate d uniformly over the span, set `counterGapAllocMask` on every bucket in the span, and flag `TOU_UNCERTAIN` if the span crosses a local-day boundary or any time-of-use boundary the ledger was given (`touBoundaryMinutes`; Phase 4 passes midnight only, because ToU windows belong to the tariff: Phase 5 derives ToU uncertainty from `counterGapAllocMask` plus the tariff's own windows). A late sample inside such a span re-marks the whole span dirty (Phase 4.4).
- **Device boundary.** A new `deviceId` (explicit replacement, Phase 2.5) always starts a new counter segment; counters are never differenced across devices. Changes in observed capabilities create no boundary.
- **Daily registers.** `*_today` registers are never used for accounting.

**Policy and source of truth.**

| Quantity | Default policy v1 | Changes when |
|---|---|---|
| Grid import/export | `METER_NET`: the external meter's own total (register 1814), closest to the utility boundary, independent of the vendor counters the technician distrusts | G6 shows only another candidate within tolerance (`METER_PER_PHASE` or `INVERTER_COUNTER`) |
| PV | `COUNTER`, if the G5 counter/integration ratio is within 0.95–1.05 | Otherwise `INTEGRATED`. Seeded policy v1 (before any G5 data exists) uses `INTEGRATED` with `validated: {}`; G5 then creates a new version |
| Battery | `COUNTER`, if the G5 counter/integration ratio is within 0.95–1.05 | Otherwise `INTEGRATED` (seeded v1: `INTEGRATED`, as for PV) |
| Load | `DERIVED` | — |

Every bucket has exactly one active source per quantity, so a source switch can never double count.

`maxGapSec` is a calculation parameter, not a source choice: changing it recomputes the ledger (Phase 4.5, V27); switching among stored candidates does not.

**Provenance per `EnergyValue`.**
- `MEASURED_INTEGRATED` for meter/PV/battery integration; `DEVICE_COUNTER` for inverter counter differences; `DERIVED` for household load.
- `ESTIMATED` when any bucket in the row has gap-allocated counter energy.
- `VENDOR_SUMMARY` only in `vendor` comparisons.
- `validated` comes from the policy's G5/G6 results.

**Coverage and status.**
- Coverage = covered seconds ÷ seconds in `[max(rangeStart, monitoringSince), rangeEnd)`. For counter sources it is 1 − unknown seconds ÷ range seconds.
- Status: `OK` if coverage ≥ 0.995; `PARTIAL` if 0 < coverage < 0.995 (the energy is a lower bound of **that directional quantity only**, since unobserved flow is ≥ 0; this does not carry over to any cost, see Pricing step 6); `UNAVAILABLE` if coverage is 0.
- `preMonitoringExcluded` is true if the range starts before `monitoringSince`.
- Totals are always "since monitoring began". Inverter lifetime counters appear only as `DEVICE_COUNTER` "lifetime (includes pre-monitoring, unvalidated)" and never seed history.

**Time.** Everything is stored in UTC. Local day/week/month/year and billing boundaries are computed with luxon in `SITE_TIMEZONE`, then mapped to UTC 5-min buckets. DST is handled generically (23/25-h days give 276/300 buckets); V9 uses a synthetic `Europe/Berlin` site.

**Daily balance check.** residual = E_pv + E_bat,dis − E_bat,ch + E_imp − E_exp − E_house. If it falls outside [0%, 15%] of (E_pv + E_bat,dis + E_imp), emit a `BALANCE_ANOMALY` event.

**Reconciliation** (`reconciliation.service.ts`). For two `MeterReading`s (t₁, t₂):
- **Our delta, per candidate** (`METER_NET`, `METER_PER_PHASE`, `INVERTER_COUNTER`): sum the full buckets inside the window. Re-integrate the edge partial buckets from samples. For the counter candidate, interpolate the counter value at t₁/t₂ between adjacent accepted readings.
- **Verdict.**
  - `INSUFFICIENT` if grid coverage is < 0.99, Δimport_utility < 50 kWh, or Δexport_utility < 20 kWh (export is judged separately).
  - Otherwise `PASS` if \|Δours − Δutility\| ≤ max(0.02·Δutility, 2·resolutionKwh), else `FAIL`.
  - Output the ratio ours/utility for each candidate.
- **Investigation path** (shown in the UI and in `docs/field-mapping.md`; there is no automatic calibration):
  1. **Direction.** Is export appearing as import? Re-check G3 per phase. A phase importing at night with no PV and an idle battery is fine; one exporting means a reversed CT. Also check fault 30029 bit 2.
  2. **Constant ratio** across windows → CT ratio or meter scaling.
  3. **Netting.** NET vs PER_PHASE: which one matches.
  4. **Placement.** A load-correlated shortfall suggests a circuit outside the CTs.
  5. **Data.** Coverage holes or exclusions in the window.

  Software cannot fix physical measurement errors. Any physical or CT change is the user's or installer's decision.

## Pricing algorithm

`TariffRulesV1` (zod, schema version 1):

```ts
{
  currency: "MYR",
  timezone: "Asia/Kuala_Lumpur",
  touWindows: [{
    code: "PEAK",
    days: ["MON", "TUE", "WED", "THU", "FRI"],
    start: "14:00",
    end: "22:00",
    excludeHolidays: true,
  }],
  defaultWindow: "OFFPEAK",
  consumptionBasis: "GROSS_IMPORT" | "NET_IMPORT",            // basis for thresholds and conditions
  thresholdProration: "NONE" | "DAYS_OVER_30",
  nem: null | {
    offsetComponents: string[],                               // component codes whose kWh basis export reduces
    touOffset: "PRO_RATA" | "SAME_WINDOW_FIRST",
    creditExpiryPeriods: 12,
  },
  components: [
    { code, label, kind: "PER_KWH", basis: "IMPORT",
      rates: [{ window: "PEAK" | "OFFPEAK" | "ANY", tiers: [{ uptoKwh: string | null, rate: string }] }],
      tierMode: "INCREMENTAL" | "WHOLE" },
    { code, label, kind: "PER_KWH_MONTHLY", basis: "IMPORT", applyIfConsumptionAboveKwh?: string },   // rate from TariffMonthlyRate (e.g. AFA)
    { code, label, kind: "FIXED", amount: string, prorate: boolean, waiveIfConsumptionAtOrBelowKwh?: string },
    { code, label, kind: "PERCENT", percent: string, ofComponents: string[],
      applyIfConsumptionAboveKwh?: string, portion: "ALL" | "ABOVE_THRESHOLD_SHARE" },
  ],
  totalRounding: "NONE" | "NEAREST_0_05",
}
```

Rates are decimal strings (`^-?\d{1,6}(\.\d{1,6})?$`). Rebates are negative rates.

**Algorithm** (decimal.js, precision 30):
1. **Split at tariff versions.** Split the billing period `[startDate 00:00, endDate+1 00:00)` local at tariff-version boundaries. Thresholds are first scaled for the period length per `thresholdProration` (`NONE`: unchanged; `DAYS_OVER_30`: × days(period)/30, so a 600 kWh threshold is 620 kWh in a 31-day period), then, when the period is split, apportioned to each sub-period by days(sub)/days(period). A `prorate: true` FIXED amount is computed once per sub-period as `amount × days(sub)/30` and is NOT scaled again by step 1 (an unchanged RM10 charge over a 30-day period split 15/15 totals RM10). A split adds the reason `TARIFF_CHANGED_MID_PERIOD`.
2. **Quantities.** For each 5-min bucket: window = `tou.windowFor`. Import/export kWh come from the active grid source under the policy.
3. **NEM.** Every rule here, including lot order and the `creditExpiryPeriods` horizon, stays subject to the bill-reproduction gate; nothing here asserts TNB rules.
   - State is a list of **lots** `{originStart, kwh}`. Opening lots = the period's `openingCreditLots` anchor if set, else the previous contiguous period's `nem.closingLots` (same tariff). No anchor and no predecessor → `NEM_OPENING_CREDIT_UNKNOWN`; a non-contiguous predecessor → `NEM_CHAIN_GAP`.
   - **Expire first.** Before any credit is applied, remove opening lots whose age exceeds `creditExpiryPeriods` periods (measured from `originStart`) and report them as `expiredLots`.
   - **Apply FIFO.** Eligible credit is consumed oldest lot first, with this period's own export as the newest lot. Credit offsets the kWh basis of `offsetComponents` only. `PRO_RATA` spreads it across windows by import share. `SAME_WINDOW_FIRST` offsets each window's import with that window's export first, then pro-rata.
   - **Carry.** Unconsumed carried lots keep their original `originStart` (and so their original expiry), reduced by whatever was consumed. Only the unused part of **this period's export** becomes a new lot with `originStart` = this period's start. Closing lots = remaining carried lots + the new lot, stored in `nem.closingLots`.
   - **Implementation choices pending the bill gate (provisional).** Lot age is the whole-calendar-month difference between the lot's `originStart` month and the current period's start month, and a lot expires when that age exceeds `creditExpiryPeriods`; `SAME_WINDOW_FIRST` keeps the same-window allocation preference but debits credit from lots oldest-first; the credit bank is carried losslessly (no rounding to 3 dp; display rounding only); an unknown opening bank applies no credit and the result carries `NEM_OPENING_CREDIT_UNKNOWN`/`NEM_CHAIN_GAP`. Each of these is confirmed or replaced by the Phase 5.7 bill-reproduction test.
   - **Downstream effect.** If recomputing a period changes its closing lots, later dependent periods are recalculated chronologically until a period's closing lots are unchanged or an independent anchor is reached (Phase 5.5). "Unchanged" includes credit quality: a closing bank derived from incomplete grid data (`COVERAGE_BELOW_99_5`, `MISSING_DATA_DIRECTION_UNKNOWN`, `PRE_MONITORING_DATA_MISSING`, `CALC_PARAMS_PARTIAL_RECOMPUTE`, or an inherited `NEM_OPENING_CREDIT_ESTIMATED`) is estimated, and each contiguous successor that consumes it reports `NEM_OPENING_CREDIT_ESTIMATED` until an independent anchor or repaired upstream data removes it. Reasons that do not alter the credit balance (ToU allocation, holiday calendar, monthly rates, tier split, bill verification, mid-period tariff change) are not inherited.
4. **Consumption** for thresholds/conditions follows `consumptionBasis`.
   - **PER_KWH tiers.** `INCREMENTAL`: kWh above the threshold use the next tier. When windows exist, the above-threshold kWh are split across windows pro-rata (reason `TIER_SPLIT_PRO_RATA` whenever this triggers). `WHOLE`: all kWh use the tier the consumption falls in.
   - **PER_KWH_MONTHLY.** kWh split by calendar month of the bucket. A missing month rate makes that line `UNAVAILABLE` (reason `MONTHLY_RATE_MISSING:<code>`).
   - **FIXED.** Amount × (days(sub)/30 if `prorate`), computed once per sub-period (see step 1); waived when the condition holds.
   - **PERCENT.** Applied to the sum of the rounded listed lines; `ABOVE_THRESHOLD_SHARE` multiplies by (consumption − threshold)/consumption.
5. **Rounding.** Each line is rounded `ROUND_HALF_UP` to 0.01. Subtotal = Σ lines. `NEAREST_0_05` adds a `ROUNDING` line.
6. **Status.**
   - `UNAVAILABLE` if no tariff version overlaps, grid coverage is < 0.80, or the period is entirely before monitoring. **Billing coverage is computed over the whole billing period, never clipped to `monitoringSince`** (that clipping is for display totals only). A period that starts before `monitoringSince` is at best `ESTIMATED` with reason `PRE_MONITORING_DATA_MISSING`.
   - Cloud data never enters billing (Amendment A1). The engine reads quantities only from the ledger, so a period whose only data is cloud-sourced has no ledger quantities and is `UNAVAILABLE` with reason `VENDOR_DATA_ONLY`; no cost is computed from vendor figures. A period partly covered by ledger data follows the normal coverage and `PRE_MONITORING_DATA_MISSING` rules. NEM lots therefore only ever derive from ledger data.
   - Otherwise `ESTIMATED` with any of these reasons: `COVERAGE_BELOW_99_5`, `MISSING_DATA_DIRECTION_UNKNOWN` (added whenever coverage < 0.995 and `isLowerBound` is false), `PERIOD_IN_PROGRESS`, `TOU_ALLOCATION_ESTIMATED`, `HOLIDAY_CALENDAR_MISSING` (ToU year with no holiday rows), `MONTHLY_RATE_MISSING:*`, `NEM_OPENING_CREDIT_UNKNOWN`, `NEM_CHAIN_GAP`, `NEM_OPENING_CREDIT_ESTIMATED`, `TARIFF_NOT_BILL_VERIFIED`, `TARIFF_CHANGED_MID_PERIOD`, `TIER_SPLIT_PRO_RATA`, `CALC_PARAMS_PARTIAL_RECOMPUTE`, `ACCOUNTING_UNRECONCILED`, `MAPPING_PROVISIONAL`, `PRE_MONITORING_DATA_MISSING`; `UNAVAILABLE` adds `VENDOR_DATA_ONLY`.
   - **`isLowerBound`** is true only for a closed list of provably monotone tariff shapes, and false otherwise. All must hold: `nem: null` (export earns no credit); `consumptionBasis = GROSS_IMPORT`; every `PER_KWH` component has a **single flat tier per window** with rate ≥ 0 (any tiered component, `INCREMENTAL` or `WHOLE`, disqualifies, because tier boundaries and pro-rata window splits can make cost fall as import rises); `PER_KWH_MONTHLY` rates ≥ 0; `FIXED` amounts ≥ 0 (threshold waivers are allowed: crossing the threshold only adds the charge); `PERCENT` ≥ 0 with `portion = ALL`; no negative rate or rebate; and import is the only data that can be missing. Then cost is non-decreasing in import and observed-data cost ≤ complete-data cost. Counterexamples that must give `false`: with NEM, 100 kWh observed import and 80 kWh unobserved eligible export at a simplified RM 0.50/kWh gives RM 50 observed vs RM 10 complete; with `WHOLE` tiers (RM 1/kWh up to 100 kWh, RM 0.50/kWh above), 100 kWh observed costs RM 100 but 101 kWh complete costs RM 50.50. The user's NEM tariff therefore never reports a lower bound, and a tariff outside the list is never assumed monotone.
   - `isLowerBound` is also false whenever the ToU window allocation is uncertain (`TOU_ALLOCATION_ESTIMATED`): an uncertain split between windows with different rates can make the observed-data cost larger than the true one.
   - INCREMENTAL tier thresholds are crossed according to `consumption` (per `consumptionBasis`) while the chargeable quantity of a non-offset component stays the gross kWh: only the consumption above a threshold is priced at the higher tier.
   - Otherwise `COMPLETE`.
   - Battery flows never enter the cost. Only grid import/export does.

**Fixing the TNB rule choices.** `consumptionBasis`, `nem.offsetComponents`, `nem.touOffset`, `thresholdProration`, and `totalRounding` are set to the combination that reproduces the user's bill in the Phase 5.7 test.

**TNB RP4 ToU + NEM template.** Line items to look for on the bill. These come from secondary sources and must be confirmed against the bill; rates are filled from the bill, never from the web:
- ToU generation/energy charge, peak/off-peak, with a 1,500 kWh tier
- capacity charge
- network charge
- retail charge, waived ≤ 600 kWh
- AFA (monthly)
- any EEI rebate, KWTBB %, or SST % lines
- NEM export credit and carried balance

Peak is Mon–Fri 14:00–22:00 local; everything else, including gazetted public holidays, is off-peak. The user enters into `TariffHoliday` the holiday list TNB applies.

No savings estimate is built (it was not requested).

## Deployment and operations

**Stack pins** (implementation selections read from manifests, not a fresh registry survey; the original registry survey was 2026-10-15):

| Component | Version |
|---|---|
| Node | 24 LTS (`node:24-bookworm-slim` by digest) |
| TypeScript | 6.0.3 (`@nestjs/graphql` 14 peers ^5.5 \|\| ^6) |
| NestJS | @nestjs/core/common 12.1.3; @nestjs/graphql 14.0.3; @nestjs/apollo 14.0.3 |
| GraphQL | @apollo/server 5.5.1; graphql **16.14.2** (Apollo 5 does not support 17); graphql-scalars 2.0.1; custom fragment-aware depth rule (Phase 2.10) |
| Health / logging | Custom `src/health/health.module.ts` (no @nestjs/terminus dependency); nestjs-pino 5.3.1; pino 10.4.0 |
| Prisma | prisma / @prisma/client / @prisma/adapter-pg **7.10.1**; pg 8.23.1 |
| Libraries | modbus-serial 8.0.25; decimal.js 10.6.0; luxon 3.7.2; zod 4.6.7; selfsigned 5.5.0 |
| Tests | vitest 5.0.4 |
| Desktop | electron 44.7.2; electron-vite 6.0.0; electron-builder 26.3.1; vite 8.3.4; react 19.3.1; @tanstack/react-query 5.104.3; echarts 6.1.0 |
| Database image | `postgres:18.6-bookworm` (digest pinned in compose) |

**`deploy/truenas/compose.yaml`** (TrueNAS Install via YAML). `POOL` and the tag are placeholders. In YAML, `$` inside commands must be written `$$`.

- **`db`**
  - `image: postgres:18.6-bookworm@sha256:<digest>`, `user: "999:999"`, `restart: unless-stopped`, `stop_grace_period: 60s`, `shm_size: 128m`, `mem_limit: 1g`
  - env: `POSTGRES_USER=solar`, `POSTGRES_DB=solar`, `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`; `secrets: [db_password]`
  - `command: ["postgres", "-c", "tcp_keepalives_idle=30", "-c", "tcp_keepalives_interval=10", "-c", "tcp_keepalives_count=3"]` so the server reaps dead client sessions (including a lingering advisory-lock session) in about a minute.
  - volumes: `/mnt/POOL/apps/house-solar/pgdata:/var/lib/postgresql`, `/mnt/POOL/apps/house-solar/backups:/backups:ro`
  - `healthcheck: pg_isready -U solar -d solar`, interval 10 s, retries 6, start_period 30 s
  - `networks: [internal]`
- **`migrate`**
  - backend image; `command: ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]`; `working_dir: /app`; `user: "568:568"`; `restart: "no"`
  - env: `DATABASE_URL=postgresql://solar@db:5432/solar` (no password), `DATABASE_PASSWORD_FILE=/run/secrets/db_password`, `CHECKPOINT_DISABLE=1`, `PRISMA_HIDE_UPDATE_MESSAGE=1`; `secrets: [db_password]`. Compose grants secrets per service and does not inherit `backend`'s environment, so `migrate` lists both itself (Docker Compose secrets docs).
  - `depends_on: db: service_healthy`; `networks: [internal]`
  - **Migration-success gate:** `backend` depends on `migrate: service_completed_successfully`, so a failed migration leaves no running backend.
- **`backend`**
  - `image: ghcr.io/captain-slow/house-solar-backend:<semver>`; `user: "568:568"`; `init: true`; `restart: unless-stopped`; `stop_grace_period: 30s`; `mem_limit: 512m`
  - `depends_on: migrate: service_completed_successfully`
  - `ports: ["NAS_IP:8443:8443"]` (published on the NAS's trusted LAN address only, not `0.0.0.0`; `NAS_IP` is a compose placeholder like `POOL`)
  - env from the env schema with `SITE_TIMEZONE=Asia/Kuala_Lumpur`, `TZ=UTC`, `DATABASE_URL=postgresql://solar@db:5432/solar`, `DATABASE_PASSWORD_FILE=/run/secrets/db_password`, `DEVICE_KEY=inverter-1`, `EXPECTED_MODEL=HIT-10L-G3`, `COLLECTOR_ENABLED=false` initially (`COLLECTOR_SOURCE` defaults to `MODBUS`); `secrets: [db_password]`
  - volumes: `.../tls:/data/tls`, `.../backups:/backups:ro`
  - `healthcheck: ["CMD", "node", "dist/cli/healthcheck.js"]`, interval 30 s
  - `networks: [internal, lan]`
- **`db-backup`**
  - `image:` same postgres; `user: "999:999"`; `restart: unless-stopped`; `environment: TZ=Asia/Kuala_Lumpur`; `secrets: [db_password]`; `entrypoint: ["/scripts/backup.sh", "daemon"]`
  - volumes `.../backups:/backups`, `.../scripts:/scripts:ro`; `tmpfs: ["/run/pg:mode=0700,uid=999,gid=999"]`; `depends_on: db: service_healthy`; `networks: [internal]`
  - **Authentication.** `backup.sh` (one script for the nightly loop and the pre-upgrade command) creates a **private password file per invocation**: under `umask 077` it runs `f=$(mktemp /run/pg/pgpass.XXXXXX)` (tmpfs, never on disk, mode 0600) and writes one line `db:5432:solar:solar:<password>`, with the password read from `/run/secrets/db_password` and every `\` and `:` escaped with `\` (the base64 secret has neither; the escape is applied anyway). On Unix libpq ignores a password file that is group/world-accessible, so it must be `0600` (libpq password-file docs). The script exports `PGPASSFILE=$f`, runs `pg_dump -w` (never prompts; fails instead), writes the file with `printf` (never on a command line, never `echo`, never `set -x`), and an EXIT trap installed before the first temporary file is created removes only the files this invocation created (password file, its exclusive `<final>.<random>.partial`, its last-success temp), guarding empty variables; a TERM/INT trap forwards to the running dump and exits 143. Publication uses `ln -T`, which never replaces an existing archive, and the `last-success` temp file (`mktemp last-success.XXXXXX.tmp`) is created only after a successful publish. The daemon builds a fresh file for each nightly dump instead of holding one for the container's lifetime, so a `docker exec` pre-upgrade run inside the same container can never delete the daemon's credentials. The password appears in no environment variable, argv, or log line; logs carry only status lines and pg_dump's own stderr.
  - `backup.sh daemon`:
    1. `mkdir -p /backups/daily /backups/weekly /backups/pre-upgrade`, then sleep until the next 03:30 local.
    2. `pg_dump -w -h db -U solar -d solar -Fc -Z 6 -f /backups/daily/solar-<YYYYMMDD-HHMM>.dump.<random>.partial` (created exclusively with `mktemp`), then `pg_restore --list` on it, then publish it as `.dump` with a hard link that refuses to replace an existing archive and write a timestamp to `/backups/last-success` (mode 0644, no secret in it; the backend reads it as uid 568). Every step of a dump is checked explicitly (the daemon calls the dump inside an `if`, which disables `set -e`), and a SIGTERM/SIGINT cancels the running dump and removes its `.partial` and password file (`stop_grace_period: 30s` on `db-backup`). On failure, remove the partial and log `BACKUP FAILED`.
    3. On Sundays, copy to `/backups/weekly/`.
    4. Keep the newest 7 daily and 4 weekly dumps. `pre-upgrade/` dumps are never pruned automatically.
  - `backup.sh once pre-upgrade <tag>`: the same step 2 with its own per-invocation password file, writing `/backups/pre-upgrade/solar-<tag>-<YYYYMMDD-HHMMSS>-<8 hex>.dump` (unique per invocation) and logging `BACKUP OK` on success.
  - Publication requires hard-link support on the actual backups mount. Daily/weekly copy and startup partial cleanup assume exactly one daemon. Startup removes leftover daily/weekly partials; pre-upgrade partials require manual cleanup only after confirming no backup is running. SIGKILL/power loss can bypass traps. NAS filesystem/permission behaviour and an unattended natural 03:30 run remain unverified.
- **`networks:`** `internal: { internal: true }` (no egress; the DB is never published), `lan: {}` (published port plus Modbus egress).
- **`secrets:`** `db_password: { file: /mnt/POOL/apps/house-solar/secrets/db_password }`.

**Restart and recovery semantics.**
- `unless-stopped` plus TrueNAS app auto-start covers NAS reboots. The collection gap during a reboot is recorded; counters bridge the energy (with TOU flagged).
- **Modbus or network outage:** the backend stays healthy and the collector backs off up to 5 min.
- **DB outage:** `/readyz` returns 503 and the process stays up. Collection does **not** continue through it: when the lock session's heartbeat fails for `OWNERSHIP_LEASE_SEC` (15 s) the collector stops Modbus requests, closes the socket, and shows `LOCK_NOT_HELD` until it re-acquires the lock. Polls already collected stay in the queue (360 FAST polls plus 64 status polls, including pending writes) and are flushed idempotently when the DB returns. The outage is a recorded `DB_UNAVAILABLE` gap; valid counters bridge the energy over it.
- **The process exits only on** invalid config (78) or an uncaught error (1, which triggers a restart).
- **Credential expiry.**
  - Modbus track: there are no vendor credentials. Cloud stopgap (A1): the user-supplied credential or token lives only in a NAS secret, expiry yields `AUTH_FAILED` (VC3).
  - An expired GHCR PAT only blocks upgrades.
  - API tokens never expire but are revocable.
  - The TLS certificate lasts 10 years; `tlsCertExpiresAt` is shown in the UI.
- **Overlapping pollers** are prevented by a single loop plus fail-closed advisory-lock ownership (heartbeat lease and takeover delay, Phase 2.4). The residual window is bounded by that lease rule; no external coordinator is introduced.

**Upgrade**
1. Build and push a new semver tag.
2. Run a pre-upgrade dump with the same authenticated script: `docker exec <db-backup container> /scripts/backup.sh once pre-upgrade <tag>` (no password on the command line; the script builds its own `PGPASSFILE`). Find the container name with `docker ps --format '{{.Names}}'`. Do not proceed unless it logs `BACKUP OK`.
3. Edit the tags of `backend` and `migrate` in the app YAML and save. TrueNAS redeploys db → migrate → backend.
4. Verify `/readyz`, collector `RUNNING`, and new samples arriving.

**Rollback.** Set the previous tag. If the release contained a migration, first restore the newest `/backups/pre-upgrade/solar-<tag>-*.dump` (one tag can match several archives; `pg_restore` takes a single file, so pick the latest timestamp) with the production restore procedure below (the final `migrate` step then runs with the **previous** image tag). Migrations are forward-only, and release notes state whether each one is additive.

**Restore (production):** PostgreSQL alone → empty database → `pg_restore` → current migrations → backend. Collection and automatic migrations stay off until the data is in place because `backend` and `migrate` are not running during steps 1–6.
1. Stop the `house-solar` app in the UI (stops `backend`, `migrate`, `db-backup`, `db`).
2. Replace the `pgdata` **ZFS dataset** (it is a dataset, not a directory, so `mv` is not valid). With the app stopped so the dataset is not busy: record its local properties (`zfs get -s local -o property,value all <pool>/apps/house-solar/pgdata`), then `zfs rename <pool>/apps/house-solar/pgdata <pool>/apps/house-solar/pgdata.broken-<date>` (OpenZFS remounts a dataset with an inherited mountpoint at its new path, which frees the old path). Create a new `pgdata` dataset with the recorded local properties (including `recordsize=16K`) through the TrueNAS Datasets UI or `zfs create`, then `chown 999:999` and `chmod 0700` on `/mnt/<pool>/apps/house-solar/pgdata`. Keep the broken dataset until the restore is verified; to roll back, destroy the new empty dataset and rename the old one back.
3. Install the temporary app `house-solar-restore` from `deploy/truenas/compose.restore.yaml`: only `db` (same image, `pgdata`, secret, and a read-only `backups` mount; no `migrate`, no `backend`, no Modbus access).
4. Make the target empty: `docker exec <db> psql -U solar -d postgres -c 'DROP DATABASE solar' -c 'CREATE DATABASE solar TEMPLATE template0 OWNER solar'`. Assert it is empty: `docker exec <db> psql -U solar -d solar -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')"` must print `0`. (Local-socket access inside the container; confirmed in the Phase 3 drill.)
5. `docker exec <db> pg_restore -U solar -d solar --exit-on-error --single-transaction /backups/daily/<file>.dump`. **No `--clean`:** it drops only objects that exist in the archive, so objects absent from an older archive would survive next to an older `_prisma_migrations`. Restoring into an empty database makes the archive the whole truth.
6. Delete the `house-solar-restore` app (keep `pgdata`).
7. Start the normal `house-solar` app. `migrate` applies the migrations missing from the restored `_prisma_migrations` (all later ones if the dump predates a schema migration, none if current); only on success does `backend` start, collection resume, and the ledger worker process any `LedgerDirtyRange` rows stored in the dump.
8. Data between the dump and the restore is a recorded gap.

**Restore drill** (Phase 3 exit, then monthly; log results in `docs/operations.md`):
- Copy the latest dump to the PC and run `docker compose -f deploy/dev/compose.dev.yaml up -d db`. Create a fresh database from `template0`, assert it is empty, `pg_restore` without `--clean`, run `prisma migrate deploy` with the current build, and only then start the backend.
- Run the backend with `COLLECTOR_ENABLED=false` and `COLLECTOR_SOURCE=NONE` against it. `COLLECTOR_ENABLED=false` is a global override: no collector of any source starts.
- Also restore a dump made **before** the latest schema migration and confirm `migrate deploy` applies exactly the missing migrations and the backend starts (V21).
- `energyTotals` for the last complete local day must equal production's output exactly (same kWh strings), and `Sample`/`RawPoll` counts (Modbus) or `CloudSnapshot` payloads and `firstFetchedAt`/`lastFetchedAt`/`fetchCount` (cloud) must match up to the dump time.
- Perform the production-path restore once during Phase 3, while losing data is cheap.
- ZFS snapshots and replication of the `backups` dataset are recommended. Snapshots of `pgdata` are not treated as a validated backup.

**Resources and storage.**
- Backend: CPU/steady-state RAM are site-sizing estimates [INFERENCE], not measured NAS limits. The historical 400-day populated replay sampled 386,478,080 bytes RSS; terminal recovery sampled 393,965,568 bytes. These workloads do not establish steady-state collection usage or a throughput guarantee. Shipping limit remains 512 MB.
- Postgres: 256–512 MB is a planning estimate [INFERENCE], not measured NAS demand; shipping limit remains 1 GB.
- Disk: do not budget from the old 6 GB estimate. See the measured synthetic 400-day size under Data-model rules. Budget database growth/WAL plus 7 daily and 4 weekly dumps, unbounded-by-policy pre-upgrade archives and safety headroom; confirm actual space and retention choices before deployment.

**Security.**
- Access is LAN-only. Port 8443 is HTTPS with a pinned self-signed certificate. Bearer tokens are hashed at rest. ADMIN vs VIEWER roles apply. Failed-auth throttling is on. CORS is off (it is not authentication). Logs are redacted.
- PostgreSQL is never published. No privileged containers and no Docker socket.
- The Modbus layer can only read. Modbus TCP itself is unauthenticated on the LAN, so keep the stick on the trusted LAN.
- **Remote-access policy:** if wanted later, use a VPN into the LAN only (WireGuard or Tailscale). Never port-forward 8443 or expose the API publicly.

## Amendments

### A1. Cloud stopgap source (2026-10-17, user decision)

**Footnote: Ethernet is still the better solution.** The wired Modbus path remains the target and the only source that supports independent accounting and reconciliation (per-phase meter power every 10 s, integrated by us). The user will pursue it later: a Wi-Fi-to-Ethernet client bridge next to the stick, after consulting the installer, because the stick is outdoors, a long cable is impractical, and the user does not want to disturb the setup. Nothing in A1 removes or weakens the Modbus work.

**Evidence that led here.** G0 failed on the Wi-Fi path: one single-address TCP connect to the stick's Wi-Fi IP, port 502, was actively refused (2026-10-17). The IP was identified only by router entry (`espressif`, MAC 48:4D:26:24:39:01, not yet matched to the label), so the device identity is unconfirmed. This agrees with the community claim that Modbus is exposed only on Ethernet.

**Design contract (what the implementer must follow).**
- **Separate storage, no ledger.** A cloud source does not feed `RawPoll`, `Sample`, `normalize.ts`, `integrate.ts`, `counters.ts` or `LedgerDirtyRange`. Those are register-shaped and 10-s-cadence by contract (a 5-minute snapshot would fail `maxGapSec = 30` or force fabricated registers and timestamps). A new migration adds `CloudSnapshot { id, dataSourceId, deviceKey, firstFetchedAt, lastFetchedAt, fetchCount, measuredAt? (nullable: the vendor gives none), payload Json (redacted, no tokens), unitsNote, counterFamily?, apiContractVersion }`. The advisory lock, `DataSource`, `Device` identity and `ApiToken` auth are reused; register-model detect and the normalizer are not.
- **Own collector.** A `CloudCollector` module, enabled by configuration (`COLLECTOR_SOURCE = MODBUS | CLOUD | NONE`, default `NONE`); exactly one acquisition source is active per backend instance and the other's loop never starts. Changing it is a configuration change plus an `ACQUISITION_SOURCE_CHANGED` quality event, **not** an `AccountingPolicy` change. `AccountingPolicy` keeps selecting only among already-computed ledger candidates (V6, V27 stay unchanged); there is no `CLOUD` candidate and `EnergyInterval` has no cloud columns.
  This is the deferred A1 contract, not the current Modbus-only environment default. Until A1 is implemented, the code supports `MODBUS | NONE` and defaults to `MODBUS`; the shipping TrueNAS compose keeps `COLLECTOR_ENABLED=false` until G0–G2 pass. No cloud acquisition is implemented or implicitly enabled.
- **What cloud data feeds.** Live display and daily/period vendor figures only. GraphQL adds `vendorLive: VendorLive` and `vendorDaily(fromDate, toDate): [VendorDay!]!`; `collectorStatus.acquisitionSource: String!` (`MODBUS|CLOUD|NONE`) tells the dashboard which to use, and `liveStatus` returns `freshness: NO_DATA` while the cloud source is active. The dashboard polls `vendorLive` every 60 s when the source is `CLOUD`, with the same stale-banner rule (two missed cadences). These queries return `provenance = VENDOR_SUMMARY`, `source = CLOUD`, `measuredAt` (null when unknown), `fetchedAt`, and a `snapshotAgeSeconds`. It never produces energy totals labelled MEASURED_INTEGRATED, and never fills per-phase grid, inverter AC/EPS, derived load, or a daily balance.
- **Freshness is source-specific.** Modbus `LIVE` is unchanged: collector-observed sample age ≤ 30 s (Modbus has no device clock, so `observedAt` is the collector's). `LIVE` is never reported for a cloud snapshot. For a cloud snapshot with unknown measurement time the status is `SNAPSHOT` (a new `Freshness` value) with the `fetchedAt` age, and the UI says "vendor snapshot, measurement time unknown"; flow animation is disabled and the fixed caption "Calculated from measured grid import/export" is replaced by "Vendor-reported; not independently measured".
- **Accounting and billing exclusion.** Cloud data is excluded from `reconciliation` (see limit 2) and from billing (Pricing step 6: `UNAVAILABLE`, `VENDOR_DATA_ONLY`). C3's counter-family comparison is a separate vendor-comparison query that cannot change `AccountingPolicy.validated` or `accountingStatus`. A cloud-based cost estimate is out of scope for A1; adding one later needs its own amendment, with its uncertainty carried through the result and NEM lot types.
- **Read-only enforcement.** The adapter has an allowlist by exact origin, HTTP method and route. Authentication and read endpoints may be POST (the allowlist is semantic, not GET-only); settings/control endpoints, including `/pvm-ctl/api/0/dev/setting/write`, are unreachable, and a unit test proves any non-allowlisted route throws before a request is made. Tokens and credentials are never logged (pino redaction extended to cloud headers and bodies) and never stored in the repository.

**Cloud-track acceptance (replaces the Modbus exits for the stopgap).** Applies only after C1 and C2 pass. None of V10, V12, V16, V17, V22, V24, V25 validates the cloud track.
- **VC1 Cadence and counts:** over 24 h on the NAS, at least 95% of the expected snapshots at the verified vendor cadence; a poll whose payload equals the immediately preceding stored one increments `fetchCount` and moves `lastFetchedAt` instead of adding a row (separated identical payloads still get separate rows); success is measured as the sum of `fetchCount` against expected polls, not as row count. The 95% target is provisional until C2 verifies the vendor cadence.
- **VC2 Freshness honesty:** a snapshot with unknown `measuredAt` never shows `LIVE`; after two missed cadences the UI shows the stale banner.
- **VC3 Auth expiry and outage:** an expired or revoked token yields an explicit `AUTH_FAILED` state, no retry storm, no secret in logs; a vendor outage and a container restart each produce one gap event and no duplicate snapshots.
- **VC4 Read-only proof:** the allowlist test above plus a recorded run that issues only allowlisted requests.
- **VC5 Isolation:** with cloud active, no `LedgerDirtyRange`, `EnergyInterval` or `BillingPeriodResult` row is created from cloud data, and no `BillingPeriodResult` quantity depends on it. Switching to Modbus leaves cloud snapshots tagged and untouched.
- Synthetic regression tests V1–V9 and V22–V27 stay runnable against replay fixtures; they are not evidence for the cloud track.

**Binding limits (what the cloud source can never do).**
1. It never sets `TariffVersion.billVerified`, and no cost is computed from cloud data: cloud-only periods return `UNAVAILABLE` with `VENDOR_DATA_ONLY` (Pricing step 6).
2. Reconciliation against TNB meter readings never runs on it: the service returns `NOT_ELIGIBLE` and `RECONCILED` is impossible for a cloud or mixed range. G5/G6 stay Modbus-only.
3. Counters from the two sources are never differenced against each other. Cloud data never enters the ledger, so a source change is a collector configuration change (see Design contract), not an `AccountingPolicy` change.
4. The app's grid import/export totals are still not the source of truth (see Context). The cloud source may display them, labelled vendor-reported.
5. No password, token or credential is stored in the repo, chat or logs. The user supplies the credential or token to the NAS themselves; redaction applies as for the backend.

**Not authorized by A1 (each needs a separate explicit user yes).**
- TLS interception, rooting, certificate injection, or extracting protected credentials from the phone.
- ADB use. A1 does not lift "no ADB".
- Any write, control, firmware or account action.

**Open prerequisites (gates, no work without them).**
- **C1 Credential path:** how the user will provide a cloud credential or token without chat/repo exposure. Not yet decided. The unofficial login is password-derived; the official API needs a key from Hoymiles that the user has not requested.
- **C2 Contract verification:** the routes found in the APK are static candidates with no verified request/response contract. The adapter's field map and cadence are established from the user's own authorized requests, and each field is marked VERIFIED/PROVISIONAL in `docs/field-mapping.md`, as for Modbus.
- **C3 Counter family:** issue #80 reports two counter families (`mb_*` vs `grid_*`) for a HIT-10L-G3; which one matches the meter is decided by comparison with TNB readings, not assumed.

**Resuming Modbus.** When a wired path exists: run the single-address port 502 test on the stick's new IP, then the Phase 1.8 probes. The switch is: stop the app, set `COLLECTOR_SOURCE=MODBUS` (and `MODBUS_HOST`), restart; the backend records an `ACQUISITION_SOURCE_CHANGED` event, the cloud loop never starts, and the Modbus collector starts under the usual lock and takeover delay. Cloud snapshots stay tagged `CLOUD` and are never differenced against Modbus counters. `AccountingPolicy` is untouched.

## Review findings and where they are resolved

| # | Finding | Resolution |
|---|---|---|
| F1 | Migrations not runnable | Phase 2.1 and 2.14 (single config/build layout), Deployment `migrate` (env, secret, gate), V19 |
| F2 | Unauthenticated backups | Deployment `db-backup` (PGPASSFILE on tmpfs, 0600, `pg_dump -w`), Upgrade step 2, V20 |
| F3 | Restore ordering | Deployment "Restore (production)", restore drill, `compose.restore.yaml`, V11, V21 |
| F4 | 600 V rule | Evidence rows 22–23, Phase 1.6, M1 rows, V22 |
| F5 | Ledger recovery | Phase 2.6, Phase 4.4, Data model (`LedgerDirtyRange`, `counterState`, retention), V5, V23 |
| F6 | Counter units | Accounting "Counters" (`limit(Δt_h)`), V4 |
| F7 | Device identity (Modbus track; the cloud track reuses `DataSource`/`DEVICE_KEY` but has no register identity) | Evidence rows 10 and 23, Phase 2.5, Data model (`Device`), V24 |
| F8 | Collector ownership | Phase 2.4, Phase 2.6 buffer, Restart semantics, V10, V25 |
| F9 | NEM lifecycle | Pricing step 3, Phase 5.5 cascade, Data model, V26 |
| F10 | `maxGapSec` vs selection (ledger candidates only; acquisition-source changes are configuration, see A1) | Phase 4.5, Data model (`maxGapSecUsed`, `AccountingPolicy`), Accounting validity, V6, V27 |
| F11 | Cost lower bounds (never true for cloud-derived input, see Pricing step 6) | Pricing step 6, GraphQL `BillingPeriodResult`, Phase 6 Usage & Cost, V28 |

Status: the original M1/2026-10-17 document-review history is retained as history, not current acceptance. `docs/operations.md` records local software/replay, built-image V19, backup-authentication, and current/0002 restore drills, including 2026-10-23 follow-ups. None is fresh verification by this plan reconciliation, and none proves NAS, physical accuracy, installed NSIS or real-bill acceptance. Use the per-item recorded acceptance snapshot below, not a blanket pass.

## Critical files and anchors

- `apps/backend/src/modbus/register-map.ts`: mapped field addresses, types and scales, ported from the library @78c620d with MIT attribution; `read-plan.ts` separately defines bulk reads. Keep the catalog consistent with `docs/field-mapping.md`.
- `apps/backend/src/accounting/integrate.ts`: directional trapezoid with zero-crossing and bucket splitting. Every energy figure depends on it.
- `apps/backend/src/accounting/counters.ts`: the reset/jump/wrap/discontinuity state machine. It decides which counter energy is known and which is unknown.
- `apps/backend/src/tariff/engine.ts`: the pure billing engine. Its bill-reproduction test is the authority on TNB rule flags.
- `deploy/truenas/compose.yaml`: the production topology. Network isolation, user IDs, mounts, and backup schedule live here.

## Verification

Prerequisites:
- PC with Node 24 (nvm) and Docker Desktop.
- Dev DB: `docker compose -f deploy/dev/compose.dev.yaml up -d db`, with `DATABASE_URL=postgresql://solar:solar@127.0.0.1:55432/solar_test` for integration tests.
- Commands from the repo root:
  - unit: `npm run test -w apps/backend`
  - integration: `npm run test:int -w apps/backend`
  - replay: `npm run replay -w apps/backend -- --capture test/fixtures/captures/day.jsonl --port 15020`, and the backend with `MODBUS_HOST=127.0.0.1 MODBUS_PORT=15020`

| # | Scenario (step) | Input → expected output |
|---|---|---|
| V1 | Known-energy integration (P4.1) | Constant 1000 W for 3600 s with jittered 7–13 s sample spacing → 1000.000 Wh ± 0.001. The same stream with a 45-s hole → 987.5 Wh ± 0.1 (12.5 Wh missing), GAP flag on the overlapped bucket(s), covered seconds 3555 |
| V2 | Sign reversal (P4.1) | +2000 W → −2000 W linearly across one 10-s interval → zero crossing at 5 s; import 1.389 Wh, export 1.389 Wh (not netted to 0) |
| V3 | Meter-total NET vs per-phase netting (P4.1) | φA +1000, φB +1000, φC −1500 W for 1 h. Meter total 1814 = +500 W (equal to the phase sum) → `METER_NET` import 500 Wh, export 0; `METER_PER_PHASE` import 2000 Wh, export 1500 Wh. Same phases with a deliberately different meter total of −300 W → `METER_NET` import 0, export 300 Wh (not the +500 W phase sum) while `METER_PER_PHASE` stays 2000 / 1500 Wh; a total of +1200 W → `METER_NET` import 1200 Wh, export 0. Total unavailable with valid phases → `METER_NET` unknown (GRID_GAP, 0 covered s), `METER_PER_PHASE` energy still 2000 / 1500 Wh with its own full `gridPhaseCoveredSec` coverage while `METER_NET` coverage is 0 s; a phase unavailable with a valid total → `METER_PER_PHASE` unknown with `gridPhaseCoveredSec` 0, `METER_NET` unaffected at full coverage |
| V4 | Counter reset and jump (P4.2) | 1000.0 → 1000.5 → 0.2 → 0.4 kWh: counted 0.5 + 0.2 = 0.7 kWh, `COUNTER_RESET`, the reset interval unknown. 1000.0 → 1000.1 → 33768.5 → 1000.2: counted 0.2 kWh, `COUNTER_JUMP_REJECTED`. Wrap near 2³²·100 Wh: correct small delta. **Units:** 500 Wh over 30 min on GRID_BUY (1 kW) is accepted (limit 1000·60·0.5 + 200 = 30,200 Wh); a 31,000 Wh jump over the same 30 min → `COUNTER_JUMP_REJECTED`. The same `limit()` is applied to baseline confirmation, reset/discontinuity confirmation, and post-wrap deltas |
| V5 | Duplicates / out-of-order (P2.6, P4.4) | Ingest the same 360 polls twice → 360 `Sample` rows. Running ledger recompute twice → identical `EnergyInterval` rows (equal hash of all Wh columns). `observedAt` going backwards within a run → `CLOCK_STEP`, interval excluded |
| V6 | Source switching (P4.5) | Policy v2 `INVERTER_COUNTER` effective at T. A range spanning T sums meter buckets before T and counter buckets after T. Totals equal the sum of the two sub-ranges (no double count). A retroactive v3 at the first sample supersedes v2. None of these creates a `CalculationRun`; only overlapping `BillingPeriodResult`s are invalidated |
| V7 | Stale / missing (P2.3, P4) | Replay with 1800 = 0 for 10 min → grid null for those buckets; `gridCoveredSec` reduced; valid block-2000 counters keep producing ordinary 10-s deltas (they are independent of register 1800), so grid *power* coverage falls while counter energy is unaffected; `COUNTER_GAP_ALLOCATED` appears only if the counter readings themselves are missing for more than `maxGapSec` (a second variant drops block 2000 for the same 10 min). Meter words unchanged for > `maxRepeatSpanSec` → `METER_STALE`. `liveStatus` with last sample 45 s old → `freshness: STALE`, `ageSeconds` ≥ 45 |
| V8 | Tariff changes and billing boundaries (P5) | **ToU:** weekday 13:55 bucket → OFFPEAK, 14:00 → PEAK, 22:00 → OFFPEAK, Saturday → OFFPEAK, holiday → OFFPEAK, holiday table empty → `HOLIDAY_CALENDAR_MISSING`. **Version split:** v1 until 2026-11-14, v2 from 11-15, period 11-03..12-02 → two sub-periods, prorated thresholds, `TARIFF_CHANGED_MID_PERIOD`. **Tiers:** 1,600 kWh INCREMENTAL → 1,500 at tier 1 and 100 at tier 2. **NEM:** see V26. **Rounding:** half-up at 0.005 |
| V9 | DST and timezone (P4.6) | Synthetic site `Europe/Berlin`: local day 2026-10-25 has 300 buckets, 2026-03-29 has 276. Daily totals sum to the UTC total |
| V10 | Collector / container restart (P3) | On the NAS, `docker restart <backend>` → one GAP ≤ restart duration + takeover delay, no duplicate `Sample`s, counters bridge the energy. Starting a second backend with the same DB → `LOCK_NOT_HELD`, no second Modbus connection (confirmed in the stick's single-client behaviour: no read errors in the primary). Lock-loss behaviour: V25 |
| V11 | Restore (P3.5) | Restore drill: kWh strings identical for the last complete day; row counts match up to the dump time. Production-path restore (PostgreSQL alone → empty DB → `pg_restore` without `--clean` → `migrate` → backend) completes and the collector resumes. Older-schema dump: V21 |
| V12 | Electron closed / PC off / phone off (P7) | Record the PC shutdown time and switch the phone to airplane mode, for ≥ 2 h. Afterwards, `energyTotals` for that window has grid coverage ≥ 0.99 and ≥ 99% of expected `Sample` rows (≥ 713 of 720) |
| V13 | UI end-to-end (P6) | With the live NAS: Overview values equal a simultaneous `liveStatus` curl. A null field shows `—` with a reason; a measured 0 shows `0 W`. Stopping the backend app → within 30 s, a stale banner with the last-data age, greyed values, no flow animation. A wrong token → `AUTH_FAILED` screen. A re-generated certificate → `TLS_MISMATCH` screen with the presented fingerprint. History chart gaps line up with the `dataQualityEvents` GAP times |
| V14 | Electron security (P6) | `window.open` and navigation to `https://example.com` are blocked. `window.solar.query('NotAnOperation')` is rejected. The renderer has no `require`/`process`. The token appears in no renderer-visible object (DevTools check) |
| V15 | Packaging (P6) | NSIS installer installs per-user on Windows; the app launches, completes first-run setup, and survives a restart with the token still decryptable |
| V16 | Real-data integration accuracy (P1.8c, P4.9) | Cadence capture (meter block only): 10-s vs 2-s integration of **grid power** differ < 1%. Derived load needs registers 74–76 and 92–94, which the `--cadence` capture does not contain; its sampling check uses the 120-min capture instead (10-s vs 20-s decimation). 24-h NAS data: PV and battery counter/integration ratios recorded. Daily balance residual within [0, 15]% |
| V17 | Trusted meter comparison (P7) | Two TNB readings ≥ 7 days apart with Δimport ≥ 50 kWh: `reconciliation` for the active source is PASS (\|Δ\| ≤ max(2%, 2×resolution)), or FAIL with the per-candidate ratios and investigation steps recorded in `docs/field-mapping.md`. Also compare the inverter-counter candidate and record whether it explains the technician's complaint |
| V18 | Bill reproduction (P5.7) | Each bill fixture is reproduced within RM 0.01 per line and in total. The selected rule flags are recorded in `TariffVersion.sourceNote` |
| V19 | Migration startup (P2.14, P3.3) | Built image, `internal` network only, secret at `/run/secrets/db_password`, no password in `DATABASE_URL`: `migrate` applies all migrations to an empty database and exits 0 (exercises `prisma.config.ts` and `src/config/database-url.ts` inside the runtime image, with a password containing `+ / =`); `backend` starts only afterwards. With a wrong password file, `migrate` exits non-zero and `backend` never starts |
| V20 | Unattended backup authentication (P3) | `db` requires password auth and `db-backup` has no `PGPASSWORD`: the 03:30 loop and `backup.sh once pre-upgrade <tag>` both produce a listable `.dump` via their own `/run/pg/pgpass.*` files (0600). Running the pre-upgrade command with `docker exec` inside the live daemon container leaves the daemon's next scheduled dump successful. With a file at 0640, libpq ignores it, the backup logs `BACKUP FAILED`, no `.partial` remains, and nothing hangs on a prompt. Container logs, `docker inspect` (env/args), and `ps` output contain no password string |
| V21 | Older-schema restore (P3.5) | Dump taken at migration `0002`; upgrade to the current schema; restore the `0002` dump into an empty `template0`-based database with no `--clean`: only archived migration history/objects exist before upgrade. `migrate deploy` then applies exactly all pending migrations (currently `0003_tariff`, `0004_raw_poll_monotonic`, `0005_soc_coverage`, `0006_grid_phase_coverage`, in order; the recorded drills below predate 0006; the local isolated restore drill was rerun for 0006 on 2026-10-25, see `docs/operations.md`); backend starts and `/readyz` is 200. Historical counter-example: `--clean --if-exists` over a newer database leaves newer objects absent from the archive beside older `_prisma_migrations` |
| V22 | Valid high PV voltage (P1.6) | FAST block with PV1 = 820.0 V, PV2 = 760.0 V, AC 230 V, battery 52 V, SOC 52 → no retry, block valid, PV/battery/inverter fields all decoded. PV 1100.0 V accepted; 1100.1 V or 1500 V → re-read twice, then block invalid. AC 650 V or battery 200 V follow the same retry path |
| V23 | Delayed persistence, outages, and long counter gaps (P2.6, P4.4) | (a) *Delayed persistence:* with the lock held and Modbus healthy, make inserts fail for 45 min (for example by revoking INSERT on `Sample`); polls accumulate in the buffer and flush afterwards, a `LedgerDirtyRange` covers the span plus bounding samples, and recomputed intervals equal a run whose writes never failed. (a2) *Fail-closed outage:* take the DB offline 45 min; collection stops within the lease, the span is a `DB_UNAVAILABLE` gap with reduced coverage (explicitly **not** equal to uninterrupted collection), valid counters bridge the energy as gap-allocated, and only polls already buffered at the moment of loss are flushed. (b) A sample 3 h old inserted into an already-processed gap → the whole span between its neighbours is recomputed, not a trailing window. (c) A 6-h upstream gap between accepted counter readings → seeding uses the preceding accepted baseline from `counterState` (outside any lookback) and energy is gap-allocated over all 6 h with `counterGapAllocMask`. (d) Kill the worker mid-range and again between finishing a range and counter propagation, then restart → the range or its continuation row is still present, and final rows equal an uninterrupted run. (e) A dirty range older than `SAMPLE_RETENTION_DAYS` is truncated and reported via `outsideRetentionBefore`; nothing is reconstructed from deleted samples. (f) A repeated-meter run starting at 11:59:40 crosses `maxRepeatSpanSec` at 12:00:10, after the 11:55 bucket was computed → the retroactive `METER_STALE` update enqueues the whole run plus bounding samples in the same transaction, the 11:55 bucket is recomputed with reduced energy and coverage, and buckets before the run are untouched. (g) Isolated core-schema ingest runs with `0001_core` plus its `0004_raw_poll_monotonic` extension, without accounting/tariff tables, and writes dirty ranges without error. This test-only schema selection is not a production migration order or permission to run current ingest on bare 0001 |
| V24 | Night-time reconnect identity (P2.5) | Replay a day capture, then a night capture with PV voltages < 1.0 V (detected MPPT count 0); in a variant the battery or meter blocks read as absent. Reconnect → the same `Device` row continues: no `retiredAt`, no new `deviceId`, no counter boundary; only `observedCapabilities` changes and `CAPABILITY_CHANGED` is logged. A model string ≠ `EXPECTED_MODEL` → `IDENTITY_MISMATCH`, no samples written. `device.js replace` retires the row and starts a new counter segment with no differencing across the boundary |
| V25 | Lock-loss overlap prevention (P2.4) | Two backends A and B on one DB and the replay server. `pg_terminate_backend` on A's lock session → A issues no Modbus request after detection (≤ one 5-s heartbeat plus an in-flight 3-s request), closes its socket, and still flushes buffered polls; B acquires the lock but connects to Modbus only after the 18-s takeover delay. Replay-server logs never show two concurrent clients. Pausing A's DB traffic instead of killing it → A stops within `OWNERSHIP_LEASE_SEC`. A DB outage > 15 s yields no new samples until the lock is re-acquired; the 360-poll buffer preserves only already-collected polls |
| V26 | NEM aging and cascading corrections (P5) | Synthetic tariff with `creditExpiryPeriods = 12` (a test value, not a TNB rule). Period 1 leaves 100 kWh unused → lot {P1, 100}. Period 2 consumes 30 → lot {P1, 70} keeps origin P1 (not refreshed to P2); only the unused part of P2's own export becomes {P2, x}. A lot older than the horizon is expired and reported **before** FIFO, so it offsets nothing. Correcting period 1 to 20 kWh changes its closing lots → period 2 is recomputed, then period 3, … until a period's closing lots equal their stored ones; a period with an independent `openingCreditLots` anchor stops the cascade. A missing intermediate `BillingPeriod` → `NEM_CHAIN_GAP`. Actual TNB lot order and horizon stay unverified until V18 |
| V27 | `maxGapSec` vs source selection (P4.5) | A 45-s interval at 1 kW with `maxGapSec = 30` → excluded, GAP flag, covered seconds reduced. A policy at the same `effectiveFrom` with `maxGapSec = 60` → `CALC_PARAMS` dirty range, `CalculationRun(CALC_PARAMS_CHANGE)`, the interval becomes 12.5 Wh with `maxGapSecUsed = 60`, coverage and counter-allocation flags change, overlapping billing results are invalidated. Switching `gridSource` METER_NET → INVERTER_COUNTER creates no `CalculationRun` and writes no `EnergyInterval`, only billing invalidation. Buckets older than sample retention keep `maxGapSecUsed`; totals carry `STALE_CALC_PARAMS` and billing `CALC_PARAMS_PARTIAL_RECOMPUTE` |
| V28 | Missing-export cost uncertainty (P5) | NEM tariff, simplified RM 0.50/kWh energy component, 100 kWh observed import, 80 kWh unobserved export → `ESTIMATED`, `isLowerBound = false`, reason `MISSING_DATA_DIRECTION_UNKNOWN`; the dashboard shows the "estimate: may be higher or lower" chip, not "≥" (observed-data cost RM 50 vs complete RM 10). `WHOLE` tiers (RM 1/kWh up to 100 kWh, RM 0.50/kWh above): observed 100 kWh = RM 100 vs complete 101 kWh = RM 50.50 → `false`. Any `ABOVE_THRESHOLD_SHARE`, negative rebate, `NET_IMPORT`, or tiered component → `false`. A synthetic `nem: null` tariff with only flat non-negative per-window rates, fixed charges, and non-negative percents, with only import missing → `isLowerBound = true`, "≥" shown. A property test over random quantities asserts that every tariff the engine marks lower-bound is non-decreasing in import |

### Recorded acceptance snapshot (reconciliation; no fresh execution)

Statuses below describe retained historical claims, not commands run by this documentation review. "Verified locally" is restricted to the stated synthetic/software scope. A partial local check does not close a larger NAS/hardware/installer/bill gate. D0 relies on the recorded user report, not a new NAS check. Source locations identify scenario coverage, not independent execution evidence.

Evidence keys (all `docs/operations.md`; dates belong to the recorded runs):
- **U/I/D — 2026-10-23 third pass**, lines 554–574: `npm test -w apps/backend` → 25 files/209 tests; full `npm run test:int -w apps/backend` → 24 files/282 tests; `npm test -w apps/desktop` → 16 files/95 tests. Typecheck/lint also passed. Aggregate counts alone do not verify every scenario.
- **R — 2026-10-22/23**, lines 442–454 and 577–583: production-Dockerfile build plus `RESTORE_TEST_IMAGE=<recorded tag> bash deploy/dev/verify-restore.sh`, and `node apps/backend/.secrets/acceptda9e452062ed1ede/v19-check.mjs`; built-image V19 23.909 s, full restore 194.33 s, cleanup passed. The 2026-10-23 follow-up also records a separate 179 s restore. Do not conflate those runs or treat the removed private runner as still available.
- **B — 2026-10-23**, lines 554–574: `bash deploy/dev/verify-v20.sh` → V20 PASS/CLEANUP PASS; `bash deploy/dev/verify-backup-paths.sh` → BACKUP-PATHS PASS (stub pg tools, not authentication or restore proof). Process samples may show a held pg_dump wrapper rather than the native process; hard-link behaviour on NAS remains untested.
- **F — 2026-10-22/23**, lines 424–440: recorded `ACCEPTANCE_RUN=... node --max-old-space-size=384 .../soak.mjs delay` / `outage`; both exited 0 after 2,700,013.144 / 2,700,006.119 ms faults and scoped fidelity checks. Not OS-kill/NAS tests.
- **E — 2026-10-22/23**, lines 456–466: actual corrected unpacked executable, synthetic loopback backend, collection DISABLED, focused-window-equivalent outage response 9.723 s. Not NSIS; later source fixes were not rerun in this executable (lines 574). The private package/profile/runners were removed (lines 498–511).

| Item | Status | Historical evidence / named prerequisite |
|---|---|---|
| V1 | verified locally | Historical U: jittered 1 kW/hour and 45 s hole; integrate.spec.ts:11-38. |
| V2 | verified locally | Historical U: directional zero crossing; integrate.spec.ts:41-51. |
| V3 | verified locally | Historical U: 500 Wh NET / 2000 Wh import + 1500 Wh export per phase with total = phase sum (compute.spec.ts:74-95). Fresh 2026-10-24 synthetic regressions where the meter total differs from the phase sum (−300 W and +1200 W against +500 W), plus unavailable-total and unavailable-phase cases: compute.spec.ts:96-161, families.spec.ts:85-96. Software semantics only; physical accuracy awaits G3/G5/G6. |
| V4 | verified locally | Historical U: counter reset, spike, wrap and dimensional rate limits; counters.spec.ts. |
| V5 | verified locally | Historical U/I: duplicate 360-poll ingest, deterministic ledger, backward-clock validity; ledger.int-spec.ts:203 and clock-validity.int-spec.ts:230. |
| V6 | verified locally | Historical I: effective source selection/supersession, no source-only recompute, billing invalidation; policy.int-spec.ts:257, totals.int-spec.ts:190, billing.int-spec.ts:502. |
| V7 | verified locally | Historical U/I: meter-down/missing-counter independence, repeat staleness and 45 s API freshness; compute.spec.ts:276, ledger.int-spec.ts:347, api.int-spec.ts:286. Synthetic, not site cadence. |
| V8 | verified locally | Historical U/I: synthetic ToU/version/tier/rounding cases; engine.spec.ts:95,198, totals.int-spec.ts:377, billing.int-spec.ts:146. No actual tariff verified. |
| V9 | verified locally | Historical I: Europe/Berlin 276/300 buckets and UTC equality; totals.int-spec.ts:560. |
| V10 | blocked on named prerequisite | Authorized NAS deployment plus G0–G2 and actual stick; no NAS restart/single-client evidence. Operations:518. |
| V11 | blocked on named prerequisite | Actual NAS datasets, dump-time counts/totals and resumed site collection. Historical R verifies only the isolated synthetic production-shaped restore. Operations:519. |
| V12 | blocked on named prerequisite | Deployed gated collection and a measured ≥2 h PC-off/phone-airplane-mode interval. Operations:518. |
| V13 | blocked on named prerequisite | Live NAS/site collection and simultaneous UI/API/gap comparison. Historical E is local, synthetic, collection DISABLED, focused-window equivalent only; not full V13. |
| V14 | unverified | Historical E covers renderer globals, bridge/IPC and window.open, but the current-source packaged executable was not rechecked after later fixes; explicit external-navigation and renderer-token-visibility evidence is incomplete. |
| V15 | blocked on named prerequisite | Authorized current-source NSIS build/install/restart/upgrade/uninstall checks. Existing installer predates the latest runtime correction; E is unpacked only. Operations:522. |
| V16 | blocked on named prerequisite | Wired G0–G4 captures plus ≥24 h NAS observations and daily physical balance. Operations:517,520. |
| V17 | blocked on named prerequisite | G6: ≥7-day EXIF-timed utility readings, import delta ≥50 kWh, known resolution and comparison/investigation. Operations:520. |
| V18 | blocked on named prerequisite | Real redacted bills, actual rates/holidays, required monthly/window splits and NEM origins, plus operator attestation. Synthetic verification never passes V18. Operations:262-277,521. |
| V19 | verified locally | Historical R: production image on internal-only network, migrate success, readyz 200, wrong secret exits 1 and backend never starts; 23.909 s. No NAS inference. |
| V20 | blocked on named prerequisite | Actual NAS mount/permissions and unattended natural 03:30 run. Historical B passes local authentication/concurrency/cleanup with an overridden schedule; not the literal NAS/nightly gate. |
| V21 | verified locally | Historical R: real populated 0002 archive restored to an empty target, then exactly 0003/0004/0005; readyz and fidelity pass. This is the proposed current-schema variant, not NAS acceptance. |
| V22 | verified locally | Historical U: valid 820/760/1100 V and invalid-bound retry cases; hoymiles-g3.spec.ts:42-103. Synthetic registers only. |
| V23 | unverified | Historical F verifies both 45-minute local faults; I covers late samples, six-hour counters, rollback/continuation, retention, stale runs and updated core-schema fixture. OS-kill boundary acceptance is absent, and the long outage did not exercise a nonempty pre-outage buffer. Operations:440,523. |
| V24 | unverified | Historical U/I cover day/night replay, wrong model, explicit replacement and unit-level absent capabilities; no complete absent-battery/meter reconnect variant is identified. Physical identity remains G1-gated. |
| V25 | unverified | Historical I covers killed lock, paused DB traffic, takeover exclusion and buffered flush with shortened lease/timeout settings. No complete default 15 s lease / 18 s takeover scenario is recorded; no real-stick/NAS proof. |
| V26 | verified locally | Historical U/I: synthetic FIFO/aging/origins, cascade convergence, anchors and chain gaps; engine.spec.ts:589-797, billing.int-spec.ts:363-501. TNB lot rules remain blocked on V18. |
| V27 | verified locally | Historical U/I: 30→60 s gap recomputation, source-only non-rewrite and outside-retention staleness; integrate.spec.ts:54, ledger.int-spec.ts:492, policy.int-spec.ts:315-412. |
| V28 | verified locally | Historical U/I/D and recorded synthetic renderer evidence (operations:340): nonmonotone counterexamples, lower-bound property checks and uncertainty display. Not a real-bill result. |
| D0 | verified on hardware/NAS | User-reported version 25.04.2.6 satisfies the version criterion only (operations:11). No fresh NAS inspection; pool/IP/resources and deployment remain blocked. |
| G0 | blocked on named prerequisite | Installer-approved wired path/address; recorded Wi-Fi-only port 502 refusal is not a pass. |
| G1 | blocked on named prerequisite | G0, then real read-only identity/capability capture and label comparison; configured defaults/replay are not discovery. |
| G2 | blocked on named prerequisite | G0 and authorized sequential TS/Python 0.3.0 captures; no hardware decoder parity recorded. |
| G3 | blocked on named prerequisite | Real controlled import/battery/sign windows and residual evidence; map/sign/CT location remain provisional. |
| G4 | blocked on named prerequisite | Real two-second cadence capture and 10 s comparison; polling configuration is not measured cadence. |
| G5 | blocked on named prerequisite | ≥24 h site/NAS dataset with counter ratios and reset times; seeded PV/battery sources remain INTEGRATED. |
| G6 | blocked on named prerequisite | Aligned ≥7-day utility meter photographs/readings, resolution and minimum deltas; no automatic calibration/promotion. |
| C1 | blocked on named prerequisite | User decision on a secure authorized cloud credential path; A1 remains plan-only. |
| C2 | blocked on named prerequisite | C1 and authorized real request/response/field/cadence verification; APK routes are only static candidates. |
| C3 | blocked on named prerequisite | Verified cloud contract and utility comparison of counter families; community issue #80 is not site evidence. |
| VC1 | blocked on named prerequisite | C1/C2, an authorized implemented adapter, and 24 h NAS snapshot evidence. |
| VC2 | blocked on named prerequisite | C1/C2 and implemented cloud freshness/UI; no current SNAPSHOT behaviour exists. |
| VC3 | blocked on named prerequisite | C1/C2 and implemented cloud adapter; no auth-expiry/outage/restart evidence. |
| VC4 | blocked on named prerequisite | Verified endpoint allowlist, implemented enforcement and authorized request trace. |
| VC5 | blocked on named prerequisite | Implemented cloud source and observed isolation/source-switch scenario; absence of cloud code is not a test pass. |

**Milestone/phase status, not chronology rewritten as success:**

| Phase / milestone reference | Implementation and acceptance |
|---|---|
| Phase 0 | D0 version prerequisite satisfied by user report; wired path and remaining NAS facts blocked. |
| M1 / Phase 1 | Source, probe/replay and provisional field map exist; real G1/G2 exit and G3/G4 observations remain blocked. |
| Phase 2 | Collector, persistence, auth/TLS/API and local verification exist; site collector exit remains gated. |
| Phase 3 | Compose, backup and restore scripts plus local drills exist; no NAS deployment, 72 h collection, natural unattended backup or NAS restore acceptance. |
| Phase 4 | Ledger/totals/reconciliation software and local tests exist; G5, physical daily balance and G6 remain open. |
| Phase 5 | Synthetic billing/verifier mechanics exist; no V18 or production tariff verification. |
| M7 / Phase 6 | Dashboard and shared contracts exist; unpacked runtime evidence is historical; V12–V15 exit is not complete. |
| Phase 7 / M8 evidence | Operations §9 records local software verification, not final site sign-off; real meter/bill/NAS/installer acceptance remains open. |



## User inputs still needed (prioritized; never send passwords or tokens in chat)

1. **Gateway wired path (Modbus track):** a client bridge or cable to the stick's Ethernet socket, then its wired IP (DHCP reservation). The user will arrange it later; the installer should be consulted first. **Cloud credential path (C1)** is needed for the stopgap.
2. **TrueNAS (Phase 0/3):** pool name, trusted NAS LAN IP, free RAM and disk. Version **25.04.2.6** is already user-reported in the runbook and satisfies D0; do not ask for it again.
3. **GHCR:** the user creates a `read:packages` PAT and enters it only in the TrueNAS registry sign-in.
4. **TNB bills (Phase 5):** 1–3 recent bills with period dates, peak/off-peak import kWh, export kWh, every line amount, NEM credit carried and its origin, AFA rate, and the public-holiday list TNB applies to ToU. Redact account numbers before sharing as fixtures.
5. **TNB meter readings (Phase 7):** timestamped photos of the import/export (and ToU, if shown) registers at day 0 and day 7, then on each bill date.
6. **Optional:** any further technician detail, e.g. whether CTs were moved or reversed, or which app figure they compared against.

## Assumptions and contingencies

- **Stick has no Ethernet cable and none can be added:** the project continues on the cloud stopgap (Amendment A1) at lower confidence; the Modbus layer stays built and waits for a wired path.
- **Stick is cabled but gets no DHCP lease, or port 502 is closed:**
  - Don't change stick, app, or network settings.
  - Record it, and ask the installer whether Modbus TCP on Ethernet needs enabling.
  - The Modbus track pauses at G0; the cloud stopgap (A1) is unaffected.
- **G1 model or decode mismatch:** stop. Keep the raw captures and re-plan the register map before writing collector code.
- **G3 inconclusive after Phase 1:** deploy with `MappingVersion 1` `provisional: true`. Accounting outputs carry `MAPPING_PROVISIONAL`. Once G3 passes on NAS data, re-normalize with `RENORMALIZE`.
- **TrueNAS < 24.10:** Phase 3 waits for the user's upgrade. Development and tests continue against `deploy/dev/compose.dev.yaml`.
- **TrueNAS YAML rejects top-level `secrets:`:** put `POSTGRES_PASSWORD` in the `db` environment, `DATABASE_URL` with the URL-encoded password in the `migrate` and `backend` environments (leave `DATABASE_PASSWORD_FILE` unset), and keep `db-backup` reading the password from a read-only bind-mounted file at `/run/secrets/db_password` (`backup.sh` has no environment-only mode and `PGPASSWORD` is unsupported: it would leave backups failing, and V20 rejects it). The environment values are visible to NAS admins and in `docker inspect`; `backup.sh` never logs them. Re-run V19 and V20 for this variant.
- **Port 8443 in use on the NAS:** publish `NAS_IP:18443:8443`.
- **`selfsigned` cannot generate ECDSA:** use RSA-3072.
- **`graphql-depth-limit` fails with graphql 16.11+:** replace it with a ~30-line custom `ValidationRule` that enforces depth ≤ 8.
- **Electron's `certificate.fingerprint` format differs from the backend's `sha256/<base64>` log line:** compute and log the backend fingerprint in Electron's format. Verify on the first connection in Phase 6.
- **Meter words legitimately unchanged longer than 30 s:** `maxRepeatSpanSec = 2 × observed update period` (from G4).
- **How the utility nets phases is unknown:** `METER_NET` (the meter's own total, register 1814) is the default until G6 selects otherwise; `METER_PER_PHASE` remains a separate candidate.
- **No bill provided by Phase 5:** the engine ships with synthetic tests; costs show `ESTIMATED` with `TARIFF_NOT_BILL_VERIFIED`.
- **libpq ignores the password file or `pg_dump` would prompt:** `backup.sh` uses `-w`, so it logs `BACKUP FAILED` instead of hanging. Fix the file mode (0600) or tmpfs ownership; never fall back to a password on a command line.
- **Prisma cannot load `prisma.config.ts` in the runtime image:** a release blocker found by V19. Fix the image contents (the Phase 2.1 file set); do not change the migration design.
- **Heartbeat false positives on a slow DB link:** lengthen `OWNERSHIP_LEASE_SEC`; the takeover delay scales with it. A false positive costs a gap, never an overlap.
