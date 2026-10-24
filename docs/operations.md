# Operations runbook: house-solar on TrueNAS

Everything here is a procedure for **you** to run on the NAS. Nothing in this repository touches your NAS, your router, the Hoymiles stick or any account. Commands marked `[NAS shell]` run in the TrueNAS shell (as root or with `sudo`); `[PC]` runs on the Windows PC.

Never type or paste the database password, API tokens or the GHCR PAT into chat, a ticket or this repository.

## 1. Site facts

| Fact | Value | Source |
|---|---|---|
| TrueNAS version | 25.04.2.6 (gate D0: >= 24.10 passes) | user |
| Pool name | `<pool>` (to fill) | user |
| NAS LAN IP | (to fill) | user |
| Free RAM / disk | (to fill; shipped backend/DB memory limits total 1.5 GB before other overhead. Do not size from the old 6 GB disk estimate: section 9 records a synthetic 400-day DB of 10,165,166,607 bytes before ledger generation; actual NAS sizing needs growth/WAL and backup headroom) | user supplies available resources; compose limits and historical local sizing evidence |
| Stick wired IP | none yet: the stick is on Wi-Fi only; port 502 on its Wi-Fi IP was refused (2026-10-17) | user test |
| App | one Compose app, `house-solar` (`deploy/truenas/compose.yaml`) | repo |

The shipped compose file has `COLLECTOR_ENABLED: "false"`. Keep it disabled until G0–G2 pass on the installer-approved wired path. Then set `MODBUS_HOST` to that verified address and explicitly enable collection. The API, database, backups and restore work without a data source.

## 2. Datasets and files

Under `<pool>/apps/house-solar`:

| Name | Kind | Owner | Mode | Notes |
|---|---|---|---|---|
| `pgdata` | ZFS dataset, `recordsize=16K` | 999:999 | 0700 | replaced with `zfs rename` + recreate on restore, never `mv` |
| `backups` | ZFS dataset | 999:568 | 0750 | `daily/`, `weekly/`, `pre-upgrade/`, `last-success` (0644, a bare timestamp; the backend reads it as uid 568 through the 0750 group-568 directory) |
| `tls` | directory | 568:568 | 0700 | `cert.pem`, `key.pem` (generated on first start) |
| `secrets` | directory | root | 0755 | holds `db_password` only |
| `scripts` | directory | root:root | 0755 | `backup.sh`, read-only inside the container |

```sh
# [NAS shell]  replace <pool>
zfs create -p -o recordsize=16K <pool>/apps/house-solar/pgdata
zfs create    <pool>/apps/house-solar/backups
mkdir -p /mnt/<pool>/apps/house-solar/{tls,secrets,scripts}

chown 999:999 /mnt/<pool>/apps/house-solar/pgdata    && chmod 0700 /mnt/<pool>/apps/house-solar/pgdata
chown 999:568 /mnt/<pool>/apps/house-solar/backups   && chmod 0750 /mnt/<pool>/apps/house-solar/backups
chown 568:568 /mnt/<pool>/apps/house-solar/tls       && chmod 0700 /mnt/<pool>/apps/house-solar/tls
chown root:root /mnt/<pool>/apps/house-solar/scripts && chmod 0755 /mnt/<pool>/apps/house-solar/scripts
```

(The TrueNAS docs recommend creating app directories before installing; `storage filesystem mkdir path=...` is the equivalent API route for the plain directories.)

**Secret** (32 random bytes, base64; the command prints nothing):

```sh
# [NAS shell]
umask 077
openssl rand -base64 32 > /mnt/<pool>/apps/house-solar/secrets/db_password
chown 999:568 /mnt/<pool>/apps/house-solar/secrets/db_password
chmod 0440   /mnt/<pool>/apps/house-solar/secrets/db_password
```

Owner 999 lets `db` and `db-backup` read it; group 568 lets `migrate` and `backend` read it. The password may contain `+ / =`; the services URL-encode it (migrate and backend) or escape it (backup) themselves.

**Backup script**: copy `deploy/truenas/backup.sh` from the repository to `/mnt/<pool>/apps/house-solar/scripts/backup.sh` (for example with the TrueNAS file share or `scp` from the PC) and make it executable (`chmod 0755`). It must keep Unix line endings (the repo's `.gitattributes` enforces that).

## 3. Image and install

1. **Build and push** `[PC]`, from the repository root, after `docker login ghcr.io` (the PAT is only ever typed into that prompt):

   ```
   docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t ghcr.io/captain-slow/house-solar-backend:0.1.0 --push .
   ```

2. **Registry sign-in on the NAS**: in the TrueNAS Apps settings, sign in to a Docker registry: `ghcr.io`, your GitHub username, a PAT with only `read:packages`. The menu labels in this runbook (Apps -> Configuration, Discover -> Install via YAML) come from the TrueNAS app documentation for recent versions and were **not verified on 25.04.2.6**; if a label differs, look for the app registry credentials and the custom/YAML install option.
3. **Edit `deploy/truenas/compose.yaml`** in a text editor and substitute: every `POOL`, the image tag (`migrate` and `backend` identical), `NAS_IP` (the NAS address on your trusted LAN, IPv4: the API is published only on that address, so a second network interface does not expose it; this is not a firewall, so guest VLANs that can route to that address still need their own rule). If `NAS_IP` is left unsubstituted, the app fails to start instead of publishing widely, `STICK_IP` (or set `COLLECTOR_ENABLED: "false"`), and `TLS_SUBJECT_ALT_NAMES` (the same NAS IP and/or name the desktop app will use, comma-separated). Keep a literal `$` as `$$` if you add shell commands.
4. **Install**: Apps -> Discover -> the three-dot menu -> Install via YAML, name `house-solar`, paste the file.
5. **Check** `[NAS shell]`: `docker ps --format '{{.Names}}\t{{.Status}}'` shows `db` healthy and `backend` healthy; `migrate` has exited 0. If `migrate` failed, the backend never starts (by design): read its log with `docker logs <migrate-container>`.
6. **Tokens** `[NAS shell]`, inside the backend container (find the name with `docker ps --format '{{.Names}}'`):

   ```
   docker exec -it <backend-container> node dist/cli/token.js create --name desktop --role ADMIN
   docker exec -it <backend-container> node dist/cli/token.js create --name viewer --role VIEWER
   ```

   Each token is printed once, together with the TLS fingerprint. Store it in a password manager. `token.js list` shows names and ids (never hashes); `token.js revoke --id <id>` revokes.
7. **Certificate to the PC**: copy `/mnt/<pool>/apps/house-solar/tls/cert.pem` to the PC. Verify `[PC]`, in PowerShell, **without putting the token on a command line** (a token typed into a command is saved in the PSReadLine history file and is visible in the process list). The token is read with a hidden prompt and handed to curl on stdin:

   ```powershell
   $q = New-TemporaryFile
   '{"query":"{ collectorStatus { state } }"}' | Set-Content -NoNewline $q
   $s = Read-Host "token" -AsSecureString
   $t = [Net.NetworkCredential]::new('', $s).Password
   "Authorization: Bearer $t" | curl.exe --cacert cert.pem -H "@-" -H "content-type: application/json" -d "@$q" https://<nas-ip>:8443/graphql
   Remove-Variable t, s; Remove-Item $q
   ```

   (`-H "@-"` needs curl 7.55 or newer; Windows 10/11 ship a newer one.) With the collector off the state is `DISABLED`; with it on and a working stick it is `RUNNING`. If you ever did paste a token into a command, revoke it (`token.js revoke --id <id>`) and create a new one.

## 4. Backups

`db-backup` dumps the database every night at 03:30 (`TZ=Asia/Kuala_Lumpur`) to `backups/daily/solar-<YYYYMMDD-HHMM>.dump` (custom format, listed with `pg_restore --list` before it is accepted), copies Sunday's dump to `backups/weekly/`, keeps the newest 7 daily and 4 weekly, and writes a timestamp to `backups/last-success` (shown as `lastBackupAt` in the API). `pre-upgrade/` dumps are never pruned automatically; each is named `solar-<tag>-<YYYYMMDD-HHMMSS>-<8 hex>.dump`, so repeated or overlapping invocations with the same tag keep separate archives. Every dump writes to an exclusively created `<final>.<random>.partial` and is published with a hard link that refuses to replace an existing archive (the backup filesystem must support hard links; ZFS does); a failed run removes only its own partial. Weekly copy and the daemon-start cleanup of `daily/`/`weekly/` partials still assume one daemon.

Each dump builds its own private libpq password file on tmpfs (`/run/pg`, mode 0600) and deletes it on exit; no `PGPASSWORD` exists anywhere. A failed or cancelled dump logs `BACKUP FAILED` (or exits 143 on SIGTERM) and removes the `.partial` file that invocation created; a process killed without a chance to run its trap (SIGKILL, power loss) can leave one behind. The daemon removes leftover `.partial` files in `daily/` and `weekly/` at start-up; `pre-upgrade/` is deliberately not swept (a `docker exec` run may be writing there), so remove stale `solar-*.dump.*.partial` files there by hand once no backup is running.

Check: `docker logs <db-backup-container> --tail 20` shows `BACKUP OK <path>`.

ZFS snapshots and replication of the `backups` dataset are recommended. Snapshots of `pgdata` are not treated as a validated backup.

## 5. Upgrade

1. Build and push a new semver tag (section 3, step 1).
2. Pre-upgrade dump, using the same authenticated script. Do not continue unless it logs `BACKUP OK`:

   ```
   docker exec <db-backup-container> /scripts/backup.sh once pre-upgrade <tag>
   ```

3. Edit the tags of `backend` **and** `migrate` in the app YAML and save. TrueNAS redeploys db -> migrate -> backend.
4. Verify `/readyz` (`curl.exe -k https://<nas-ip>:8443/readyz` returns 200), the collector state, and (with a data source) new samples arriving.

**Rollback.** Set the previous tag. If the release contained a migration, first restore the newest `backups/pre-upgrade/solar-<tag>-*.dump` (one tag can match several archives because every invocation writes its own; `pg_restore` takes a single file, so pick the latest timestamp) with the production restore below; the final `migrate` step then runs with the **previous** image tag. Migrations are forward-only; release notes state whether each one is additive.

## 6. Restore (production)

PostgreSQL alone -> empty database -> `pg_restore` -> current migrations -> backend. Collection and automatic migrations stay off until the data is in place, because `backend` and `migrate` do not run during steps 1-6.

1. **Stop the app** `house-solar` in the UI (stops `backend`, `migrate`, `db-backup`, `db`).
2. **Replace the `pgdata` ZFS dataset** (a dataset, not a directory: `mv` is not valid). With the app stopped:

   ```sh
   # [NAS shell]
   zfs get -s local -o property,value all <pool>/apps/house-solar/pgdata      # record the local properties
   zfs rename <pool>/apps/house-solar/pgdata <pool>/apps/house-solar/pgdata.broken-<date>
   zfs create -o recordsize=16K <pool>/apps/house-solar/pgdata                 # plus any other recorded local property
   chown 999:999 /mnt/<pool>/apps/house-solar/pgdata && chmod 0700 /mnt/<pool>/apps/house-solar/pgdata
   ```

   OpenZFS remounts a dataset with an inherited mountpoint at its new path, which frees the old path. Keep the broken dataset until the restore is verified. To roll back, destroy the new empty dataset and rename the old one back.
3. **Install the temporary app** `house-solar-restore` from `deploy/truenas/compose.restore.yaml` (substitute `POOL`): only `db` (same image, `pgdata`, the secret, `backups` read-only; no migrate, no backend, no Modbus access, no published port).
4. **Make the target empty and assert it** (local-socket access inside the container):

   ```
   docker exec <db> psql -U solar -d postgres -c 'DROP DATABASE solar' -c 'CREATE DATABASE solar TEMPLATE template0 OWNER solar'
   docker exec <db> psql -U solar -d solar -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')"
   ```

   The second command must print `0`.
5. **Restore, with no `--clean`**:

   ```
   docker exec <db> pg_restore -U solar -d solar --exit-on-error --single-transaction /backups/daily/<file>.dump
   ```

   `--clean` drops only objects that exist in the archive, so objects absent from an older archive would survive next to an older `_prisma_migrations`. Restoring into an empty database makes the archive the whole truth. (This is demonstrated by `deploy/dev/verify-restore.sh`; see the drill log.)
6. **Delete the `house-solar-restore` app** (keep `pgdata`).
7. **Start the normal `house-solar` app.** `migrate` applies the migrations missing from the restored `_prisma_migrations` (all later ones if the dump predates a schema migration, none if current); only on success does `backend` start, collection resume, and the ledger worker process any `LedgerDirtyRange` rows stored in the dump.
8. Data between the dump and the restore is a recorded gap.

## 7. Restore drill

Run after install, then monthly; record each run in the log below.

1. Copy the latest dump to the PC and start the dev database: `docker compose -f deploy/dev/compose.dev.yaml up -d db`.
2. Create a fresh database from `template0`, assert it is empty, `pg_restore` without `--clean`, run `prisma migrate deploy` with the current build, and only then start the backend with `COLLECTOR_ENABLED=false` (a restore must never start a collector or a retention job).
3. Also restore a dump made **before** the latest schema migration and confirm `migrate deploy` applies exactly the missing migrations and the backend starts (V21).
4. **Data fidelity (every drill, from the first one):** the restored `Sample` and `RawPoll` row counts (Modbus source) must equal production's counts as of the dump time, and the newest restored `Sample.observedAt` must match; with the cloud stopgap (plan Amendment A1) compare the `CloudSnapshot` payloads and `firstFetchedAt`/`lastFetchedAt`/`fetchCount` instead; with no collector yet, compare `DataSource`, `Device` and `ApiToken` counts. A restore that starts and migrates but loses rows is a failed drill. From Phase 4 on, also: `energyTotals` for the last complete local day must equal production's output exactly (same kWh strings).
5. Perform the production-path restore (section 6) once during Phase 3, while losing data is cheap.

### Drill log

| Date | Where | What | Result |
|---|---|---|---|
| 2026-10-17 | PC, Docker (not the NAS), `deploy/dev/verify-restore.sh` | production-path restore ordering with the real `compose.yaml`/`compose.restore.yaml` (named volumes, collector off) and an older-schema dump with a throwaway newer migration (`--clean` counter-example included) | PASS: restore ordering works, `--clean` leaves newer objects behind, `migrate` applies exactly the missing migration, `/readyz` 200. A throwaway migration stood in for the real 0002/0003 |
| 2026-10-17 | PC, Docker, `deploy/dev/verify-v20.sh` | unattended backup authentication, SIGTERM cleanup, 0640 password-file rejection, weekly copy, stale-partial cleanup | PASS (PC only; no NAS bind mounts, ZFS or TrueNAS UI involved) |
| 2026-10-18 | PC, Docker, final M8 image | V19 migration gate and V20 authenticated backup/failure handling | PASS; wrong migration secret prevents backend startup; scheduled/pre-upgrade dumps listable; secret cleanup and file-mode checks pass |
| 2026-10-18 | PC, Docker, rewritten `deploy/dev/verify-restore.sh` | Real populated 0002 accounting dump → 0003 tariff; current and older production-path restores | PASS; 8,641 RawPoll, 8,641 Sample, 288 EnergyInterval rows, complete newest Sample and all six last-complete-day kWh strings identical; exactly 0003 applies to the old dump, `/readyz` 200; `--clean` negative counterexample retained |
| 2026-10-22 | PC, Docker, fresh corrected-source image | Complete current-schema restore and real populated 0002 → 0003/0004/0005 upgrade; real production backup script and Compose ordering, independent source/evidence reviews | PASS twice: 199.15 s wall, then 193.67 s after final harness corrections; nonempty full-row telemetry/ledger fingerprints, exact six daily kWh strings, historical NULL evidence, populated current acquisition/SOC fields, readiness ordering and cleanup passed. Details below |
| (to fill) | NAS | production-path restore | not yet run |
| (to fill) | NAS | older-schema restore (real populated 0002 → 0003/0004/0005) | not yet run |

### Isolated corrected-source restore drill — 2026-10-22

**Remaining findings: none in the reviewed local-drill scope.** Only `deploy/dev/verify-restore.sh`, `deploy/dev/verify-restore-helper.mjs` and this runbook changed. No production source, schema, migration, generated client, dependency or device setting was changed.

The obsolete fixture path started the current backend against schema 0002 and called the current generated client before later migrations existed. Historical preparation now runs a one-shot Node helper using `pg`, explicit real-0002 columns and a transaction; no backend server starts before migration deployment. Synthetic precomputed ledger values deliberately use algorithm version 3 with workers disabled: this proves persistence, not the arithmetic of an old release. The production order remains PostgreSQL alone → empty `template0` target → restore **without** `--clean` → current migrations → current backend.

Commands from the repository root, with Git Bash available at the explicit path below:

```sh
docker build -f apps/backend/Dockerfile -t house-solar-restore-drill:20261022-1326 .
RESTORE_TEST_IMAGE=house-solar-restore-drill:20261022-1326 "C:/Program Files/Git/bin/bash.exe" deploy/dev/verify-restore.sh
# The preceding COMPLETE drill was run again after the final admission/diagnostic corrections.
"C:/Program Files/Git/bin/bash.exe" -n deploy/dev/verify-restore.sh
node --check deploy/dev/verify-restore-helper.mjs
npm exec --no -- prettier --check deploy/dev/verify-restore-helper.mjs
```

The fresh Linux/amd64 image build passed in **292.06 s**, including Prisma generation and the backend production build. Image ID: `sha256:c8a3ba145581710817b17e8ff121d3fb0fc0f676cb09be22b582577e3bd7f47e`. It was local only and subsequently deleted. The complete drill passed first in **199.15 s wall / 199 s shell**, then against the final harness in **193.67 s wall / 193 s shell**, both exit 0 and with **no outer deadline**. Final syntax and formatting checks passed (shell 1.25 s, Node 1.36 s, formatting 2.46 s). No application behavior changed, so backend unit/integration and desktop suites were not rerun in this drill; their preceding correction results remain recorded separately, not claimed as fresh runs.

The final run used production project `restore4b37d89745470dd53c6b06b2`, restore-only project `restore4b37d89745470dd53c6b06b2r`, external volumes with suffixes `_pgdata`, `_backups`, `_tls`, a named `-volume-init` helper and private work directory `deploy/dev/.secrets/restore.l1XJuT`. The first run used `restore76f803eff9dc7873b7996fa0` and `restore.1PTMML`. Names and intended resources were printed before creation. Admission uses checked inventory queries, refuses existing namespaces/volumes and verifies volume ownership labels before initialization. Backend ports were loopback-only; collection, retention, ledger and billing background work stayed disabled by `COLLECTOR_ENABLED=false`.

Both archives came from the real `/scripts/backup.sh once pre-upgrade <tag>` inside production `db-backup`, including its authenticated custom-format dump and archive-list validation. Final log:

```text
2026-10-22T13:38:38Z BACKUP OK /backups/pre-upgrade/solar-old-0002-20261022-2138.dump
2026-10-22T13:39:22Z BACKUP OK /backups/pre-upgrade/solar-current-schema-20261022-2139.dump
```

Each restore replaced only its disposable pgdata volume, ran only PostgreSQL from the derived real `compose.restore.yaml`, asserted **0 non-system objects** in the newly created database, then ran `pg_restore -U solar -d solar --exit-on-error --single-transaction <archive>`. The current archive required **no pending migrations**. The real populated older archive contained exactly `0001_core,0002_accounting`; the harness parsed and asserted exactly **`0003_tariff` → `0004_raw_poll_monotonic` → `0005_soc_coverage`** in that order, checked the resulting history and columns, then started the backend through the production dependency gate.

| Final run stage | Migrate finished (UTC) | Backend started (UTC) | Readiness |
|---|---|---|---|
| Initial populated upgrade | 13:38:45.483559377 | 13:38:45.713540224 | `/readyz` 200 |
| Current-schema restore | 13:39:44.436218496 | 13:39:44.684459579 | `/readyz` 200 |
| Older-schema restore/upgrade | 13:40:41.686551792 | 13:40:41.905693270 | `/readyz` 200 |

The negative counterexample ran real `pg_restore --clean --if-exists` from the older archive over the populated current schema. It **exited 0 yet retained newer tariff objects beside 0001/0002 migration history**. This is semantic schema contamination, not an expected command failure; it demonstrates why production restores require an empty target.

Fidelity for the complete local day **2026-10-21**, `Asia/Kuala_Lumpur`: **8,641 RawPoll, 8,641 Sample, 288 EnergyInterval**, newest complete Sample unchanged at **2026-10-21T16:00:00.000Z**. Exact SQL Wh sums before the older backup and authenticated GraphQL kWh strings after migration and both restores:

| Quantity | Stored Wh sum | Daily row and total kWh |
|---|---:|---:|
| Solar | 36036.000 | `36.036` |
| Consumption | 28872.000 | `28.872` |
| Grid import | 5868.000 | `5.868` |
| Grid export | 1584.000 | `1.584` |
| Battery charge | 3060.000 | `3.060` |
| Battery discharge | 4536.000 | `4.536` |

All six report coverage `"1"` and status `OK`. The entire authenticated snapshot, including the newest Sample and total metadata, compared byte-for-byte. Stable full-row MD5 integrity fingerprints cover every RawPoll, Sample and EnergyInterval in primary-key order; these are not security attestations or an audit of every other table/sequence. The historical comparison projects away **only** the three new raw acquisition columns and `socCoveredSec`; full-current comparisons include them, both immediately after restore and after backend startup.

| Fingerprint | Historical-column projection | Full populated current schema |
|---|---|---|
| RawPoll | `4d079f84679d2113095dc3bc247a6d8c` | `02efea97548f7e4770ad045297a84b2e` |
| Sample | `bd701ecd90e25241d6f26c8bd2714caf` | same |
| EnergyInterval | `749eec400537df04b40848e929447063` | `294bd0a38b07fbf8d8c65ecaf1337d77` |

Immediately after the initial upgrade and after the older restore/upgrade, all 8,641 legacy raw acquisitions retained NULL timing facts and all 288 ledger rows retained NULL SOC coverage plus original extrema (40/80/60). The current-schema archive additionally preserved 8,641 populated monotonic/clock/repeat facts and 288 independent SOC coverage values of **200 s**, distinct from battery-power coverage **300 s**. Temporary authenticated helper tokens were deleted; final ApiToken count was 0.

Two independent read-only reviewer tracks assessed ordering/fidelity and isolation/cleanup at findings, stabilized-source and runtime-evidence checkpoints. Findings corrected: historical current-client use; collision/adoption risk; silently ignored teardown errors; lost failure manifests/restore-project diagnostics; raw fractional timestamp string ordering; missing post-start current-column assertions; inventory-query errors treated as absence. Follow-up source/evidence reviews found no remaining actionable defects in their scopes. Reviewers inspected source and captured evidence; they did **not** execute builds/tests or replay runtime commands.

Parent-executed throwaway Bash-function fault injection reproduced the admission bug: a failed inventory query reached `volume create` and Compose `down` before the fix. Afterward, each of four injected inventory failures (Compose containers, networks, volumes, named containers) exited 1 before any Docker mutation. These were stubbed CLI failures, not induced real daemon failures. A fractional timestamp smoke check correctly ordered `12.1Z` before `12.12Z` using nanosecond normalization. The temporary experiment files and six retained probe directories were removed after evidence review; no new permanent tests were added for unchanged production behavior.

Cleanup attempts every owned resource, reports teardown/query failures, and checks for remaining containers/networks/volumes before reporting success. Failed runs retain diagnostics with the password file removed; inspect and remove those private files after investigation. Both completed runs printed `CLEANUP PASS`; their secrets, dumps, certificates, helper containers and work directories were removed with the owned volumes/directories. Independent final queries returned no containers, networks or volumes for either run prefix:

```sh
docker ps -aq --filter name=^/restore4b37d89745470dd53c6b06b2
docker network ls -q --filter name=^restore4b37d89745470dd53c6b06b2
docker volume ls -q --filter name=^restore4b37d89745470dd53c6b06b2
# Also executed each query with the first-run prefix restore76f803eff9dc7873b7996fa0.
docker image rm house-solar-restore-drill:20261022-1326
```

Image removal reported both untagging and deletion of the recorded image ID. No `restore.*` work directories or temporary review JSON remained. Existing unrelated resources were not targeted; no reset, clean, discard, Git-diff-based operation, publication, deployment, NAS access, hardware/cloud access or desktop installation occurred.

SHA-256 below was recorded **before changes** and matched again after the complete runs. Migrations **0001–0005 are unchanged**. This task-start baseline is not an earlier historical baseline:

| Migration | SHA-256 |
|---|---|
| 0001_core | `d069b019a8ced427e2494913564d654e07706437b1e52b83146eff05d6bf111e` |
| 0002_accounting | `1535e134d7f885e1e1657f5139765201837e909c61e8ece848b746a43bb19c40` |
| 0003_tariff | `0b0e57f14e1777bef2fdc4e08ecff1078526f69d37e85c71b39e54749864324d` |
| 0004_raw_poll_monotonic | `1d686c816c86bbc4c60f15c6817cae508f5f0ae855812ba81ce0b11d923fe40d` |
| 0005_soc_coverage | `614c548037e560d6f78716cf6ca61d9555bc8873e49da731a7dbcca4fbdf0eb2` | | 0006_grid_phase_coverage | `f1e58cac8d3db12489e2af0e2304086d9ea89b967997b2f166bef43765c6a836` |

**Scope of the restore-only run above:** isolated synthetic persistence, not NAS/ZFS/permissions, unattended backup, physical accuracy or real-bill verification. The subsequent authorized local retention, dependency and unpacked-Electron checks are recorded in section 9. They do not authorize deployment, installation, hardware/cloud access, utility-meter validation or real-bill sign-off.

## Verifying a tariff against a bill

No real redacted TNB bill fixture has been supplied yet, so V18 has **not** been run and production tariff versions must remain unverified. Obtain the user's real bill, redact all account, address, meter and personal identifiers before saving any fixture, and enter its actual printed kWh splits, monetary lines, period and credit lots using the format described in `apps/backend/test/fixtures/bills/README.md`. Do not substitute synthetic rates, a generated bill, or copied test data.

Run `node dist/cli/verify-bill.js --version <tariffVersionId> --fixture <redacted-bill.json>` first to see expected versus calculated lines. Without attestation this command cannot mark a version verified: `ATTESTATION_REQUIRED` and a non-zero exit mean the gate remains closed. After comparing the redacted fixture with the real bill yourself, rerun with `--attest-real-bill`. The flag means: **I confirm this fixture was transcribed from a REAL redacted TNB bill; I understand synthetic or engine-generated data must never verify a tariff.** The CLI records the fixture basename, verification time and rule flags in `sourceNote` only when every line and total reproduce within RM 0.01; any mismatch, missing split or synthetic fixture is refused without changing verification state. Protect and remove temporary fixture copies after use.

Changing a tariff's holidays or monthly rates revokes `billVerified` on its versions automatically because the previously reproduced bill no longer proves those inputs. Newly created tariff versions start unverified; verify each affected version again against a real redacted bill. Until then calculated estimates retain `TARIFF_NOT_BILL_VERIFIED`.

### When a stored bill is stale

A stored `BillingPeriodResult` is recomputed (by the hourly refresh, or one period per GraphQL request, the rest flagged `stale`) as soon as an input it was computed with changed. Besides tariff versions, holidays, monthly rates, accounting policy, mapping and ledger rows, this includes the **reconciliation state**: adding or deleting a utility meter reading, or any new data that flips the current grid source's result for the latest reading pair between reconciled and not reconciled, turns every closed bill that depends on it from `COMPLETE` into `ESTIMATED` with `ACCOUNTING_UNRECONCILED` (and back again when reconciliation is regained). The stored reasons are the record of the state used, so no extra column or migration is involved. Periods with `UNAVAILABLE` results never consult reconciliation and are not recomputed for it.

NEM credit carries its uncertainty forward. A NEM period whose own grid data are incomplete (`COVERAGE_BELOW_99_5`, `MISSING_DATA_DIRECTION_UNKNOWN`, `PRE_MONITORING_DATA_MISSING`, `CALC_PARAMS_PARTIAL_RECOMPUTE`) leaves an estimated closing credit bank. Every contiguous successor that consumes it reports `NEM_OPENING_CREDIT_ESTIMATED`, and passes the doubt on in turn, until a period with an independent `openingCreditLots` anchor from a bill, or a recomputation of the upstream period with repaired data, removes it. Estimate reasons that do not change the credit balance (ToU allocation, missing holiday calendar, missing monthly rate, tier split, unverified tariff, mid-period tariff change) do not propagate. A successor is also recomputed when only the credit quality of its predecessor changed, even if the lots are identical. Results stored before this rule (calculation version 1) are recomputed automatically.

Credit dependency freshness compares the bank actually consumed—known/unknown state, lots and credit-relevant quality—not wall-clock ordering of `computedAt`. Equal or earlier computation timestamps do not hide a changed predecessor. Flat/unavailable results do not consume a NEM bank; independent opening anchors stop inheritance. Internal reconciliation selects its latest pair in one query and calculates from those endpoint objects, so deletion after selection cannot turn an ordinary concurrent transition into a user-input error. That response describes the selected pair; the next evaluation observes the deletion. Explicitly invalid user-supplied reconciliation IDs still fail validation.

`BILLING_CALC_VERSION` remains 2 for these freshness fixes: neither monetary arithmetic nor the persisted result representation changed, and dependency equality detects already-stored mismatches directly. This does not make wall time a general revision identifier: unrelated direct ledger edits with equal/earlier `computedAt` are not detected by that timestamp alone; supported recalculation/repair paths explicitly invalidate dependent results.

## Rebuilding samples from raw polls (`RENORMALIZE`) and clock validity

`RENORMALIZE` rebuilds `Sample` rows from retained FAST `RawPoll` rows with the current mapping. Immutable clock-step and meter-repeat evidence must survive replay; mapping-dependent fields and the stale verdict against the selected mapping's repeat threshold are deliberately recomputed, not universally “never loosened”.

- **`RawPoll.monotonicMs`** (migration `0004_raw_poll_monotonic`, nullable double): the collector process's monotonic clock at the midpoint of a FAST read, in milliseconds. It is exactly the value the collector normalized with, so it is comparable only between polls of the same `runId` (a restart is a new `CollectorRun` with an unrelated clock). It is `NULL` for SLOW/SETTINGS polls and for every raw poll captured before migration 0004.
- **Durable acquisition facts** (the same migration): `RawPoll.acquisitionClockStep` (nullable boolean) and `RawPoll.acquisitionMeterRepeatSec` (nullable integer seconds) snapshot the original FAST normalization result. These are immutable even when retroactive stale marking or a mapping replay changes the sample. They preserve the clock-invalid bit and seed a frozen run's age when both sample retention and raw-predecessor retention have occurred. They are `NULL` for legacy and non-FAST rows.
- **Repeat duration** (`Sample.meterRepeatSec`, and `METER_STALE` derived from it) is measured on that monotonic clock, never on wall time: a backward or forward wall-clock adjustment cannot restart or shorten the age of a frozen meter reading. `CLOCK_STEP` is raised when wall time disagrees with monotonic time by more than 2 s, or runs backward, between consecutive polls.
- **Replay order and state.** Replay walks each device's polls in acquisition order (`runId`, then `seq`, indexed by `RawPoll_deviceId_runId_seq_idx`), starts a fresh repeat/clock state for every collector run, and measures elapsed time only from `monotonicMs`. A requested wall-time range limits sample writes, not acquisition predecessors: replay includes earlier acquisitions even if a wall step put them beyond the range's end. Retroactive `METER_STALE` marking (ingest and replay) chains samples the same way, so a frozen run that spans a wall-clock step is still one run. Every run crossing the range is checked, including later raw observations whose samples were pruned.
- **Per-acquisition timing evidence.** A rebuilt sample keeps any `CLOCK_STEP` recorded on its raw poll or surviving sample. Each poll's immutable acquisition repeat age is authoritative when present, including interior retention holes and a first retained invalid meter block; any same-run monotonic predecessor is not proof that acquisition history is complete. Replay must not infer elapsed time from wall timestamps or assume FAST sequence numbers are consecutive (other tiers share the sequence).
- **Missing acquisition boundaries.** Repeat-age equality alone cannot prove a continuous valid run after retention removes a raw-only invalid read. Stale-run discovery requires the intervening acquisition sequence to remain accounted for across all poll tiers. Retained SLOW/SETTINGS/DETECT observations can explain gaps between FAST sequence numbers; an actual missing sequence is an unknown boundary, not evidence for joining the runs.
- **Retained stale evidence.** Acquisition-validity repair only adds supported invalidity; it does not clear a known `METER_STALE` verdict merely because its raw-only triggering observation expired. Replay with an unchanged/lower repeat threshold preserves that verdict too. An explicit `RENORMALIZE` using a higher repeat threshold may deliberately loosen it; this is a mapping-policy change, not recovered historical evidence. A previous false-positive stale verdict cannot always be distinguished from a real trigger lost to retention.
- **Legacy rows (`monotonicMs IS NULL`, captured before 0004).** Their acquisition timing cannot be recovered and is never inferred from wall time. If the stored sample still exists, its `meterRepeatSec` and `CLOCK_STEP` are kept (only mapping-dependent fields, and `METER_STALE` against the current `maxRepeatSpanSec`, are recomputed). If the sample is gone (for example sample retention is shorter than raw retention), the rebuilt sample is marked `CLOCK_STEP`, i.e. clock-invalid, and carries `meterRepeatSec = 0`. Legacy `meterRepeatSec` values were derived from wall time by the previous release, so a pre-0004 reading acquired after a backward clock step can still carry an age that was understated at the time; this cannot be corrected retroactively.
- Wall-clock collisions: a stepped wall clock can give two polls of one device the same `observedAt`. Ingest keeps the first sample for that instant; replay updates every sample through its own raw poll and never overwrites another poll's sample. A new raw-only FAST collision still carries acquisition evidence: it can invalidate its frozen run and queue ledger corrections even when no Sample was inserted. Acquisition run/sequence, not overlapping wall timestamps, determines which samples belong to that run.
- **Retention.** Sample retention can delete a sample while its raw poll survives; the three raw acquisition timing fields remain available for reconstruction. Raw retention deletes only unreferenced polls outside the dirty-range pin, so it never removes timing from a surviving sample's raw poll. If both sample and raw poll are deleted, that acquisition cannot be rebuilt; retain database dumps for recovery beyond those windows. Legacy missing-sample reconstruction remains conservative as described above.
- **`export-samples` is a diagnostic capture, not a historical timing backup.** It exports the existing JSONL wire-capture format (blocks, decoded values and wall timestamps), not `Sample` rows, collector run/sequence or acquisition timing. Feeding it to the Modbus replay server makes a new synthetic acquisition on the receiving collector's clock; it must not be treated as reconstructing original coverage or clock validity. Use `RENORMALIZE` against retained database rows for historical sample reconstruction, and `pg_dump`/restore for a lossless backup including timing.

Ledger algorithm upgrades use `SAMPLE_RETENTION_DAYS`; explicit `RENORMALIZE` requests use `RAW_RETENTION_DAYS`. Version 3 upgrades repair retained acquisition validity while preserving each sample's historical mapping and decoded values, then recompute supported ledger buckets. Missing retained evidence is not permission to overwrite historical energy or invent SOC availability: old unsupported rows keep their values/version and are flagged `OUTSIDE_RETENTION`. The horizon travels with the durable dirty work: `RENORMALIZE` records `LedgerDirtyRange.reason = RENORMALIZE`, the worker applies the raw cutoff to that reason only (a crash retry keeps it) and never merges it with ordinary ranges; ordinary recomputation, algorithm upgrades and every other reason stay on the sample cutoff. When `RAW_RETENTION_DAYS` exceeds `SAMPLE_RETENTION_DAYS` the contract is: the *rebuilt window* is exactly the range a RUNNING `RENORMALIZE` run requested (its `rangeStart`/`rangeEnd` never grow). Below the sample cutoff the worker writes only inside a rebuilt window and never deletes a stored row; rows outside every window are authoritative history that is never rewritten or re-verified, the nearest one supplies the starting counter state, change propagation stops at it, and at most the single adjacent row after the window is flagged `OUTSIDE_RETENTION`. The dirty range created by the request is clamped to the window below the sample cutoff, retention never deletes Samples inside a RUNNING window, and a run is DONE when no `RENORMALIZE` dirt overlaps its range. At or after the sample cutoff, and whenever raw retention is not longer than sample retention, behaviour is the ordinary one, including a `RENORMALIZE` run's range following counter-state propagation; only in the raw-horizon mode is the range fixed. Sample pruning takes the same advisory reservation as `requestRecalculation` (lock 716071/7) without waiting and defers Sample pruning to the next daily run (with a warning) when it is busy, so a replay that has not yet committed its run cannot have its rebuilt Samples pruned; raw-poll pruning does not depend on it. The additive `0005_soc_coverage` migration leaves historical `socCoveredSec` NULL until evidence-based recomputation. Fine SOC uses valid occupied ten-second slots; coarse SOC retains min/max, no average, and its own coverage independent of battery power. Historical extrema can remain known while coverage is unknown/zero and the interval is reported as a gap.

Acquisition repair also runs before a dirty bucket's first ledger computation, not only when an old `EnergyInterval` already exists. The interpolation predecessor and initial/grown counter lookahead are repaired and re-read before use. Repair, correction dirt, billing invalidation and the chunk commit share a transaction; flag additions are ORed atomically with the current stored flags so concurrent ingest invalidation is not overwritten.

Meter-reading pagination follows `pageInfo.endCursor`/`hasNextPage`, including exactly-full terminal pages. Load-more is disabled during any fetch, and an old callback cannot cancel a mutation-driven refresh. Failed next-page requests keep loaded rows and can be retried with the same cursor. Additions become visible on invalidation/refetch (not by an unpromised live subscription). Ordinary and infinite query keys include a connection epoch; forgetting/replacing the backend cancels and removes the old cache before a new epoch reads data.

## 8. Troubleshooting

- **`migrate` exits non-zero**: the backend is held back on purpose. `docker logs <migrate-container>`; a wrong password shows an authentication error, a missing secret file shows an error naming the path. The backend never runs migrations itself.
- **`BACKUP FAILED: ... (tmpfs) is missing`**: the `db-backup` service lost its `tmpfs` `/run/pg`; reinstall from `compose.yaml`.
- **`BACKUP FAILED: pg_dump`**: the dump could not authenticate or connect; check `db` health and that `secrets/db_password` is unchanged and readable by uid 999.
- **Port 8443 in use**: publish `NAS_IP:18443:8443` instead (keep the LAN-address binding; never `18443:8443`, which binds every interface) and use that port in the desktop app.
- **Certificate changed**: deleting `tls/cert.pem` and `key.pem` generates a new pair on the next start; every desktop client must re-pin the new fingerprint.
- **Remote access**: only through a VPN into the LAN (WireGuard or Tailscale). Never port-forward 8443.

## 9. M8 software verification and remaining acceptance gates

The PC software/replay gates pass. **This is not production, hardware, bill or installer sign-off.** Nothing has been deployed to the NAS or pushed to GHCR.

Final checks from the repository root (Git Bash; the dev DB uses loopback port 55433):

```sh
DEV_DB_PORT=55433 docker compose -f deploy/dev/compose.dev.yaml up -d db
npm run schema -w apps/backend
npm run codegen -w packages/contracts
npm run typecheck -w apps/backend
npm run lint -w apps/backend
npm run typecheck -w packages/contracts
npm run typecheck -w apps/desktop
npm test -w apps/backend
npm test -w apps/desktop
DATABASE_URL=postgresql://solar:solar@127.0.0.1:55433/solar_test npm run test:int -w apps/backend
npm run build -w apps/desktop
docker build -f apps/backend/Dockerfile -t house-solar-backend:dev .
bash deploy/dev/verify-v19.sh
bash deploy/dev/verify-v20.sh
bash deploy/dev/verify-restore.sh
npm run package -w apps/desktop
```

Run the three Docker verification scripts sequentially. **Original M8 baseline, before the corrections below:** backend 177 unit tests / 156 integration tests; desktop 57 tests; typechecks and backend lint clean; V19, V20 and populated V11/V21 local drills pass. The first integration attempt failed because the dev database was not running; starting it and rerunning the whole integration suite passed. A first revised restore run passed fidelity checks but failed a Compose log-prefix assertion; the parser was fixed and the full sequential drill passed.

The replay server (`npm run replay -w apps/backend -- --capture <file.jsonl>`) treats each new client connection as starting with the collector's DETECT sequence (the four DETECT reads, in order, as `HoymilesG3.detect()` issues them): those reads are served from the capture's DETECT record alone, so a FAST record whose own block 0 or 1800 read failed in the capture cannot make detection fail. The first read that is not the next DETECT block ends that phase, and polling then replays every captured failure exactly (a failed FAST block answers ILLEGAL DATA ADDRESS); the FAST record advances after each read at 30000. Limitation: a client that polls FAST without detecting first on a fresh connection has its very first read of block 0 (identical on the wire to DETECT block 0) served from the DETECT record; the collector always detects first.

Actual Electron checks used an isolated backend with explicitly synthetic data. History showed the selected tariff's OFFPEAK/PEAK import split (3.912/1.956 kWh, summing to 5.868); Data Quality distinguished the 1.000 kWh interval delta from the 1,001.000 kWh raw lifetime reading. A missing-export NEM period displayed `MISSING_DATA_DIRECTION_UNKNOWN`, `TARIFF_NOT_BILL_VERIFIED` and “estimate: may be higher or lower”, without a lower-bound marker. Synthetic fixtures never establish physical accuracy or bill verification. The temporary database, credentials, certificates and scripts were removed.

### Twelve-finding correction verification

The correction run used synthetic data and disposable local PostgreSQL databases only. Backend typecheck, build and lint passed; backend unit tests passed **201/201** (25 files). The complete integration suite passed **202/202** (23 files) in **324.63 s**, with verbose progress and no skipped files. The first full correction run took 334.68 s and exposed an upgrade-test assertion pinned to algorithm version 1; after updating that assertion to the current version and checking the recomputed energy/coverage, the entire suite was rerun. A 300-second outer timeout is insufficient for this sequential suite: it includes real replay/outage waits and a thousand-period NEM cascade.

Desktop node/web typechecks, production build and **72/72** tests (15 files) passed; shared contracts typechecked. Browser verification of the real renderer against disposable synthetic backend shims exercised forgetting/switching connections (including delayed old responses and failed new requests), SOC day/week min/max plots with gaps, loading more than 50 meter readings in Data Quality and Settings, adding/selecting/reconciling/deleting a later reading, and resetting event pagination on date-range changes. These are renderer browser checks, not an installed Electron/installer verification.

Prisma applied the real `0001_core` through `0004_raw_poll_monotonic` migrations to a fresh disposable database; schema validation passed and the three timing columns and acquisition-order index were checked. The restore drill's pending-migration expectations were updated and its Bash syntax checked; the complete Docker backup/restore drill was not rerun in this correction run. Temporary verification servers, scripts, credentials and databases were removed. No hardware, cloud, deployment, image publication or real-bill validation was performed.

### Seven-finding runtime correctness verification

All seven runtime hypotheses were independently reviewed against current source and reproduced before their fixes. Three pre-implementation reviewer tracks covered ledger/acquisition/battery, billing/reconciliation, and desktop paging. Four final reviewer tracks inspected the integrated source; their substantive retained-evidence and concurrency findings were corrected and received follow-up source review. Reviewers did not run project-wide validation.

Final backend typecheck, build and lint passed; unit tests passed **209/209** (25 files, 2.78 s Vitest). The complete verbose integration command `npm run test:int -w apps/backend -- --reporter=verbose` passed **252/252** (23 files) in **418.97 s** (**419.66 s wall**) with no outer deadline. An earlier complete run failed 1/252 because the new invalidation helper assumed tariff tables existed; the existing core-only migration regression caught it. The corrected helper always persists dirt and checks optional billing-schema availability without catching database errors. That failed run (445.76 s) and two superseded, cancelled integration attempts were not treated as passes.

Desktop node/web typechecks and production build passed; tests passed **84/84** (16 files, 5.34 s Vitest). Shared contracts typechecked. Actual Chromium renderer checks used a synthetic bridge, not installed Electron: held deletion refetch versus paging, 119 unique remaining readings after deleting #10 from 120, cursor traversal in both reading views, failed next-page retry, a new row beyond an exactly-full terminal page, reconciliation selection, a late old-connection page, and day/week SOC min/max with null averages and gaps.

Prisma deployed migrations `0001_core` through `0005_soc_coverage` to a fresh disposable database and validated the schema. A populated real-0004 database upgraded by applying exactly 0005; all original energy, coverage and SOC extrema were unchanged and new SOC coverage remained NULL. Regeneration was byte-identical across all 28 generated TypeScript client files. Checksums of 0001–0004 matched the values recorded at the start of this correction; no earlier historical baseline was available. Restore-script migration expectations and Git Bash syntax passed; the complete backup/restore drill was not rerun.

A separate compiled-service smoke check with populated cached bills observed freshness `[false,false]` before acquisition correction and `[true,false]` afterward: the overlapping local-date bill became stale and the unrelated bill stayed fresh. No synthetic fixture establishes real bill verification. Disposable databases, their task-owned PostgreSQL container/volume, temporary migration script/configuration, renderer server and browser tab were removed. No hardware/cloud access, device-setting change, deployment, image push/publication or installed Electron/installer verification was performed.
The subsequent full corrected-source local backup/restore drill is recorded in section 7 above; it closes that local-drill gap only, not the NAS or release/site gates.

### Local retention, dependency and unpacked-runtime checks — 2026-10-22/23

This follow-on used synthetic data only. **Independent source reviews found no remaining actionable correctness finding in the reviewed changes.** The workload/performance boundaries below are not a general throughput guarantee. No deployment, publication, real hardware/cloud/NAS access, device-setting change or desktop installation was performed.

#### Workloads and production corrections

- The 400-day fixture spans `2025-09-16T16:00:00Z` through `2026-10-21T16:00:00Z`, including both FAST endpoints: **3,456,001 FAST + 115,201 SLOW + 38,401 SETTINGS = 3,609,603 RawPoll rows**, and **3,456,001 Sample rows**. All tiers share a contiguous acquisition sequence; DETECT is not persisted. FAST cadence is 10 s, SLOW 300 s and SETTINGS 900 s. Real encoded register payloads occupy **3,772,340,636 bytes**; the populated database was **10,165,166,607 bytes** before ledger generation. Bounded SQL batches populated the fixture; spot checks re-derived source bytes and normalized fields. Seed: 246.322 s; ANALYZE: 8.204 s; spot checks: 0.687 s.
- Profile: one device/run/mapping, constant grid/PV 1200 W, battery discharge 600 W, inverter AC 1800 W, EPS 0, derived load 3000 W and SOC 52. Meter words change between acquisitions; PV/grid-buy counters advance 100 Wh/300 s, discharge 100 Wh/600 s and load 100 Wh/120 s; sell/charge counters are constant. This is a mixed-tier retention workload, not a physical-site capture or a multi-device/mapping stress matrix.
- `findMeterRepeatRun` now reads the immediate neighbour before a larger acquisition page and supports a **strictly-greater-than-threshold proof**, whose reported maximum may be a sufficient lower bound rather than the complete run duration. Only acquisition repair requests that proof; ingest/replay retain complete traversal. `repairAcquisitionValidity` can prove a one-observation run from exact neighbouring FAST sequence identities already in its page, or use durable staleness/invalid-hash evidence. Missing, raw-only or interleaved identities conservatively fall back to the sequence-aware walker. Known stale flags and atomic OR updates are retained.
- A dense terminal chunk exposed recursive historical widening: loading progressively older committed baselines reopened their already-accounted-for spans until a 120 s transaction expired. The causal floor now comes from the original committed counter state. Later 30-day cases exposed two additional memory failures: a five-minute request accumulated a dense NULL-counter future, and terminal recovery materialized the whole historical power/SOC prefix. Grown lookahead now selects only non-NULL still-unresolved counters with strict `(observedAt,id)` continuation; predecessor reconstruction verifies one local-day window at a time.
- Independent review caught an intermediate bounded-window defect: a preserved unsupported historical row could retain an obsolete counter anchor. Verified actual counter states now flow across predecessor windows; the current window is recomputed when its stored boundary differs, and a newly exposed earlier anchor extends verification monotonically. Unsupported historical values/version/NULL SOC evidence remain untouched; future lookahead state is not persisted as actual state. A compiled-service reproduction produced **0.023 Wh instead of 0.012 Wh before this correction**, then **0.012 Wh**, identical logical rows and an unchanged unsupported row afterward. Permanent regressions cover both the earlier preserved anchor and the later invalidated anchor.
- `ApiClient` now retires its old transport and creates a fresh, non-persistent UUID-named Electron session for each trusted configuration. Chromium caches certificate verdicts separately from the verification callback; clearing/re-pinning in a reused session had left token saving unable to recover from a correctly rejected certificate. Retired callbacks cannot relabel a later network error or restore an old connection. Failed retirement remains unconfigured.
- The integration helper `terminateLockHolder` now restricts advisory-lock termination to the selected database. Its former server-wide lookup invalidated an early delayed-write experiment when the suite shared that PostgreSQL server. A cross-database regression preserves the other holder; the complete final suite used a separate task-owned PostgreSQL container.

`LEDGER_ALGO_VERSION` remains **3**, `BILLING_CALC_VERSION` remains **2**. No schema/migration rewrite, timeout increase, lookahead time cap, fabricated SOC coverage or production older-schema fallback was introduced.

#### Measured retention and recovery results

| Workload | Worker / runner seconds | SQL calls | Result |
|---|---:|---:|---|
| Before correction: one-day FAST-only acquisition repair | 120.158 | 11,757 | P2028 at the unchanged 120,000 ms transaction deadline; not a pass |
| Corrected repair of the last day in the 400-day mixed-tier fixture | 9.659 | 7,055 | No sample changed and no dirt invented |
| One-day frozen-run proof / repair | 0.249 / 11.031 | 11 / 8,677 | Proof reached 40 s (>30 s) with five members; repair correctly marked all 8,640 samples stale |
| One-day FAST-only ledger | 1.374 | 488 | 288 buckets; grid/PV 28,800.000 Wh, load 72,000.000 Wh, discharge 14,400.000 Wh; grid/SOC coverage 86,400 s; dirt drained |
| Earlier 400-day run, causal-floor build before final sparse/bounded-window changes | 5,310.565 | 5,848,275 | 400 chunks, 115,200 buckets; exact expected integrated totals and coverage; dirt drained |
| Final-source populated 400-day replay | 2,931.154 runner; 2,932.37 external wall | 3,033,001 | All 115,200 rows recomputed in 400 chunks; exact integrated totals/coverage; every logical stored field except `computedAt` unchanged; dirt drained |
| Final-source 30-day unresolved-counter tail | 40.452 worker; 43.427 supervisor; 44.35 external wrapper | 14,387 | 8,641 exact rows, 483,924 field checks passed; preexisting prefix including `computedAt` unchanged; dirt drained |
| Final-source 30-day terminal-counter recovery | 426.288 worker; 429.63 external wrapper | 101,702 | 8,641 exact rows, 483,924 field checks passed; preexisting prefix including `computedAt` unchanged; dirt drained |

The final 400-day replay ran against an already populated ledger, not a fresh empty-ledger generation or a 400-day old-algorithm upgrade. Integrated totals were **grid/PV 11,520,000.000 Wh each, load 28,800,000.000 Wh, discharge 5,760,000.000 Wh**, with **34,560,000 s** grid and independent SOC coverage. The ordered MD5 of per-row MD5s of **every stored field except `computedAt`** was **`65009fd8c137baede116105569eca110` before and after**, over all 115,200 rows. Sampled maximum RSS was **386,478,080 bytes**; native reported peak was **377,852 KiB**. Maximum spacing between precommit callbacks was 19.248 s, **not a transaction-duration measurement**. The timer/SQL count includes the runner's dirty setup, both full fingerprints and aggregate checks. Recorded compiled ledger SHA-256: `e067a928df133270bdde56b0a0c8c192d12749fbf7e6bacf12ad082e78c5508c`.

The FAST-only failed repair and mixed-tier corrected repair are different profiles, **not** a controlled 120.158→9.659 speedup. Likewise, 5,310.565→2,931.154 is not a controlled speedup: the earlier run inserted rows, the final replay updated populated rows, caches/concurrent load differed. These were populated/analyzed/read-cache workloads; no cold-cache, retention-DELETE or index-plan benchmark is claimed, and the fixture was not VACUUMed.

The 30-day fixtures contain **259,201 actual normalized FAST samples**. A valid 300 s counter witness precedes a dense tail of failed block-2000 acquisitions; power/SOC blocks remain valid. In the terminal variant, only the final reading recovers the counters. Source bytes were encoded and re-normalized during preparation, not copied from ledger output. Each full run requires 8,640 complete buckets plus exactly one endpoint bucket: 10 s SOC coverage, zero power coverage and NULL power/counter energy at that endpoint. The unresolved tail keeps NULL counter energy, 300 unknown counter seconds and the retained witness; it never invents energy. Current full runs leave exactly one source BLOCK_INVALID event and no dirty work.

The failed 30-day terminal run aborted with V8 heap OOM after 97.669 child seconds, with only 14 local days committed; its partial output was not a pass. After correction, the largest terminal computation used **8,706 samples**, not the whole dense prefix: 990 calls, 8,599,143 input-sample visits and 13,145,018 SQL rows returned. Sampled maximum RSS was **393,965,568 bytes**, maximum used heap **178,207,976 bytes**. The unresolved run used at most 8,705 samples/call and sampled maximum RSS **335,728,640 bytes**.

Counter fidelity is **exact at each stored bucket's three-decimal Wh precision**, not exact aggregate conservation before rounding. Terminal PV/grid-buy sum to 864,000 Wh; independently rounded discharge/load buckets sum to **432,001.834 / 2,160,001.834 Wh**, versus unrounded deltas 432,000 / 2,160,000 Wh. Those are the expected sums of individually rounded buckets, not a waived assertion. The backup/restore kWh strings below are compared exactly without this rounding qualification.

Limits: predecessor verification can still be quadratic in span length; 30-day terminal completion is not proof of 400-day terminal-gap throughput. Rejected **non-NULL** future candidates and broad acquisition-repair spans can still be expensive; the filter is not a universal memory bound. `--max-old-space-size=384` limits old space, **not total process RSS or the total V8 heap**; V8 reported a 603,979,776-byte (576 MiB) heap limit. Node workers ran on the host; perf/soak PostgreSQL containers each had 1 GiB/2 CPU, and integration PostgreSQL had 2 GiB/2 CPU. The production 120 s transaction and 30 s statement deadlines were unchanged. Some runs overlapped other validation; 343.662 s from an earlier windowed build versus the final 426.288 s is **not** a controlled regression comparison.

The temporary NULL-tail report initially described `processOnce(END + 301 s)` while actual recorded `worker.now` was `END`. Its prose was corrected, the original report retained, and an explicit metadata correction recorded; numerical results/exercised code were unchanged.

Representative actual commands from the repository root (the ignored runners and their synthetic credentials are disposable, not shipped product commands):

```sh
RUN=acceptda9e452062ed1ede
W=apps/backend/.secrets/$RUN
ACCEPTANCE_RUN=$RUN DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:50203/perf \
  node --max-old-space-size=384 "$W/perf.mjs" repair 1
ACCEPTANCE_RUN=$RUN DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:50203/perf \
  node --max-old-space-size=384 "$W/perf.mjs" ledger 400
ACCEPTANCE_RUN=$RUN DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:50203/perf_nulltail \
  node --max-old-space-size=384 "$W/null-tail.mjs" prepare 30 terminal full
ACCEPTANCE_RUN=$RUN DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:50203/perf_nulltail \
  node "$W/null-tail.mjs" run 30 terminal full
# The separate unresolved database uses the same prepare/run commands with "unresolved".
```

#### Final-source 45-minute wall-clock fault runs

Both independent Node workers exited **0** after complete recovery/fidelity checks. Their four compiled identities (collector, ingest, acquisition repair and ledger) matched the final build; ledger SHA-256 was `e067a928df133270bdde56b0a0c8c192d12749fbf7e6bacf12ad082e78c5508c`. Reports were written after `finally` cleanup, with no cleanup errors. The workers were launched concurrently through the process supervisor, using these commands and the manifest-owned loopback PostgreSQL server:

```sh
ACCEPTANCE_RUN=acceptda9e452062ed1ede node --max-old-space-size=384 \
  apps/backend/.secrets/acceptda9e452062ed1ede/soak.mjs delay
ACCEPTANCE_RUN=acceptda9e452062ed1ede node --max-old-space-size=384 \
  apps/backend/.secrets/acceptda9e452062ed1ede/soak.mjs outage
```

| Final-source experiment | Actual fault milliseconds | Total runner seconds | Observed fidelity |
|---|---:|---:|---|
| INSERT rejection with healthy lease and Modbus | 2,700,013.144 | 2,780.585 | 276 FAST acquisitions/samples; 9 SLOW + 4 SETTINGS; one connection; no lock loss, overflow or grid-gap pair |
| Database access revoked, fail-closed acquisition | 2,700,006.119 | 2,790.973 | Lease loss in 260.284 ms; 3 cycles / 31 requests before stopping; wire counters stayed unchanged and clients stayed zero for the remaining fault hold after acquisition stopped; 6 total FAST acquisitions/samples after recovery |

Delayed writes were compared with a separate successful-per-acquisition reference rebuilt by re-normalizing **all 289 original raw records**, never copying Sample/EnergyInterval rows. Raw envelopes, immutable acquisition facts and normalized samples matched; every logical persisted ledger field matched fingerprint **`61e5ced5287e41f7862b3945dc158de1`**. Independent grid integration was **916.669 Wh**, counter delta/persisted counter energy **900/900 Wh**, 2,749 summed whole coverage seconds, zero gap pairs and no dirty work. Native peak RSS was 227,060 KiB.

The outage produced one **2,730,014 ms** actual acquisition gap and only **13.325 Wh** integrated grid energy with 38 summed whole coverage seconds. The intervening buckets retained NULL power energy, zero coverage and counter-gap allocation flags. The counter delta was **900 Wh**; the sum of independently rounded bucket allocations was **900.003 Wh**, within the existing 0.0005 Wh-per-bucket rounding bound, not exact aggregate conservation. Counter reset/jump/discontinuity events were absent; dirt drained. Native peak RSS was 201,924 KiB. This run did **not** exercise a nonempty pre-outage buffer. These are synthetic local faults, not OS-kill, real-device or NAS autonomy acceptance.

#### Final image, migrations and full restore rerun

```sh
docker build --progress plain -f apps/backend/Dockerfile \
  -t house-solar-acceptance-final:acceptda9e452062ed1ede .
RESTORE_TEST_IMAGE=house-solar-acceptance-final:acceptda9e452062ed1ede \
  bash deploy/dev/verify-restore.sh
node apps/backend/.secrets/acceptda9e452062ed1ede/v19-check.mjs
```

The actual production Dockerfile built in **35.75 s**, image **`sha256:6dc804bf57f8ea3d0b906355c14b32662582e658b71e9a41d73b19a7fff069ee`**. The separate V19 runner passed in **23.909 s** (24.22 s external wall): only an internal network, npm 11.19.1, `schema-engine-debian-openssl-3.0.x` present, migrate/status successful, `/readyz` 200, wrong secret exits 1 with backend never started, no password logged, teardown/absence checks passed.

The **whole** restore drill then passed in **194.33 s wall / 194 s shell**, exit 0: project `restoreb6b00ac3ac4a6059e6edf1e4` plus its restore-only `r` project. Both source archives came from real `backup.sh`; both destructive restores used empty disposable targets before migrations/current backend startup. The real populated 0002 dump applied only pending 0003/0004/0005; the `--clean --if-exists` counterexample still retained newer tariff objects and was not accepted as a restore method. Migration completion preceded backend start and readiness in all stages.

Each restored dataset had **8,641 RawPoll, 8,641 Sample and 288 EnergyInterval rows**. Exact daily kWh strings: **solar 36.036, consumption 28.872, import 5.868, export 1.584, charge 3.060, discharge 4.536**. Current-schema full-row MD5 fingerprints were RawPoll **`4e7ec4dc19f5f70c708f3dc9d6ec9ed7`**, Sample **`965e30d650258b95b13f49eca820c892`**, EnergyInterval **`7e2fd06f3b35de7a18fc14d004d08ad3`**; all matched after restoration. Historical projection fingerprints also matched, old acquisition/SOC columns remained NULL and current populated acquisition facts plus SOC 200 s versus battery coverage 300 s survived. This run's fixture day was 2026-10-22, so timestamp-dependent digests differ from earlier runs with a different fixture day. The harness printed **CLEANUP PASS** with no owned containers, networks, volumes or work files.

#### Actual corrected packaged executable

Only a **directory/unpacked x64 package** was built, with publication disabled. No NSIS installer was run, installed, upgraded or uninstalled. Corrected executable SHA-256 **`2e6344c60a882ef23d2b4f86a62777904aeebbf2405276975651ef4ba788cc11`**, ASAR **`ee43d479fdaee7ef98407037109e624cae191e3252e8c30adccaea345aabfaa4`**. Five extracted main/preload/renderer files matched the current build; the final desktop rebuild and identity check passed again in 2.08 s. RunAsNode, NodeOptions and CLI-inspect fuses were disabled; embedded-ASAR integrity and ASAR-only loading were enabled.

The real executable used its own profile and a loopback HTTPS backend with collection **DISABLED**. It exercised first-run URL/probe/independent fingerprint comparison, ADMIN authentication, pin-bound encrypted-token persistence through executable restart, same-process certificate B→A→B rejection and explicit re-pinning recovery without a desktop restart. Rejected invalid credentials entered the real token-recovery screen; VIEWER had no mutation forms/deletion choices and an administrative request received AUTH; ADMIN recovered.

Actual renderer checks covered all 135 readings in Settings and Data Quality, a terminal 136th addition, confirmed deletion restoring 135, both reconciliation selectors containing all 135 endpoints, and synthetic reconciliation correctly remaining **INSUFFICIENT**. Historical power/energy charts showed 99.59% solar / 99.95% grid-import coverage; SOC showed separate min/max with no fabricated average. The corrected executable's LIVE lines animated, then a real backend stop produced the offline banner, grey/last-known values and no line animation in **9.723 s**; restarting the final-source backend reconnected as ADMIN without token entry, `/readyz` 200 and collection DISABLED.

The LIVE/outage experiment explicitly used **CDP focus emulation** because the managed attached window was backgrounded. It proves a focused/foreground-equivalent observation, not an unconditional minimized/background polling bound. An initial temporary animation probe queried marker paths instead of animated line elements and retained an `ok:false` measurement; the corrected actual-line check passed. A wrong banner selector also timed out before the correct `.notice` measurement. Neither was hidden or counted as a product pass. Screenshots and the real default-world checks confirmed the rendered surface, no renderer Node globals, only the intended bridge, rejection of unknown/oversized IPC and malformed backend URLs, blocked window opening, settings metadata without tokens and no plaintext token in its encrypted file. This is not a comprehensive sandbox penetration or other-user DPAPI isolation test.

#### Final static/unit/integration evidence and review

```sh
npm exec --no -- prettier --write apps/backend/src/accounting/ledger.service.ts apps/backend/test/ledger-crash.int-spec.ts
npm run build -w apps/backend
npm run typecheck -w apps/backend
npm run lint -w apps/backend
npm run typecheck -w apps/desktop
npm run typecheck -w packages/contracts
npm test -w apps/backend
npm test -w apps/desktop
DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:60918/postgres \
  npm run test:int -w apps/backend -- --reporter=verbose
npm run build -w apps/desktop
DATABASE_URL=postgresql://build@127.0.0.1:1/build CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
  node node_modules/prisma/build/index.js generate --config apps/backend/prisma.config.ts
DATABASE_URL=postgresql://build@127.0.0.1:1/build CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
  node node_modules/prisma/build/index.js validate --config apps/backend/prisma.config.ts
npm ls prisma @prisma/adapter-pg @prisma/client @prisma/engines deepmerge-ts mysql2 pkg-types confbox -w apps/backend
npm audit --omit=dev -w apps/backend --json
```

Formatting the two changed ledger files and the final backend build passed together in 6.02 s.

All four type/lint commands passed (16.02 s combined). Backend units **209/209**, 25 files, **3.42 s**; desktop units **87/87**, 16 files, **5.63 s**. The **entire** verbose backend integration suite passed **258/258**, 23 files, **435.31 s Vitest / 436.13 s wall**, with **no outer deadline**. The complete ledger-recovery file separately passed 30/30 in 67.85 s; that focused run was not substituted for the full suite. The final backend build passed; schema generation/validation passed in 2.54 s, and all 28 generated client files were byte-identical on repeat generation.

Read-only reviewers independently checked retention/ordering/fidelity, dependency pins/lock/engine/image implications, and packaged security/runtime evidence. Corrected findings included unrelated dependency drift (the final pkg-types subtree is unchanged), preserved-hole counter-state carry, the weakened intermediate lookahead-order assertion (replaced with first-commit storage/rollback checks), and temporary-soak oracle/input/counting defects. Follow-up reviews found no remaining actionable source finding in those checkpoints. Reviewers did not run the validation commands; the parent executed them and reviewers inspected saved evidence. The fixture's provisional mapping, synthetic meter endpoints and absence of actual bills remain explicit; no synthetic attestation is a real tariff/bill or installation acceptance.

Owned infrastructure is recorded under run `acceptda9e452062ed1ede`: perf/soak/integration containers and volumes with that exact prefix and ownership label; loopback ports 50203/50204/60918; backend 61195; a dedicated Electron profile and loopback-only debugging port; unique V19/restore projects and private work directories. App collection stayed disabled; collector services were enabled only inside the explicitly synthetic, loopback Modbus replay experiments. Migration SHA-256 values were rechecked against the task-start manifest and match all five values in section 7; this creates no earlier historical baseline. Shared existing Docker resources and the untracked implementation were not reset, cleaned or discarded.

#### Final cleanup and preservation evidence

Cleanup finished only after both final-source soak workers exited 0, all four compiled identities matched, the final 400-day replay and both 30-day fidelity reports passed, and independent review accepted the evidence and ownership-scoped teardown. The manifest and five migration hashes were retained in memory before deleting private files.

The final read-only reviewer independently confirmed that the exact private work directory was absent and found no cleanup documentation mismatch. Docker/listener absence checks were executed by the parent; the reviewer could not independently execute Docker queries under its tool policy. Do not attribute those runtime checks to the reviewer.

- Released the owned `solar-packaged-fixed` browser attachment; stopped the dedicated Electron/backend processes and three database wrappers. Both soak workers had already exited successfully; the manifest's `accept-live-feed` daemon did not exist. Host process enumeration then found **zero processes containing this run identity**.
- Verified exact container IDs, ownership labels and PostgreSQL volume mounts, plus each volume's ownership/creation identity. Explicit `docker stop --time 20` completed for the three owned database containers. Their `--rm` auto-removal raced a redundant explicit `docker rm`, which reported one already-absent container; a fresh label-filtered query proved **all three absent** before volume deletion. This diagnostic was not suppressed or treated as a validation pass.
- `docker volume rm acceptda9e452062ed1ede_perf acceptda9e452062ed1ede_soak acceptda9e452062ed1ede_int` removed all three owned volumes and all disposable databases within them.
- `docker image rm house-solar-acceptance:acceptda9e452062ed1ede house-solar-acceptance-final:acceptda9e452062ed1ede` reported both tags untagged and both recorded image IDs deleted. No force or shared-cache prune was used.
- Fresh container/network/volume queries for each exact Compose-project label returned empty: `acceptda9e452062ed1edev19`, `restore4dc7d688b862928e6075131a`, `restore4dc7d688b862928e6075131ar`, `restoreb6b00ac3ac4a6059e6edf1e4` and `restoreb6b00ac3ac4a6059e6edf1e4r`. Queries for the task ownership label and both image references were also empty.
- Windows process/listener inspection found **no listeners on 50203, 50204, 60918, 61195 or the final Electron debugging port 50282**.
- Checked canonical `realpath`, directory/reparse boundary and all five migration hashes before recursively removing **only** `apps/backend/.secrets/acceptda9e452062ed1ede`. Removal covered both unpacked packages, profile/encrypted credentials, TLS files, synthetic fixtures, failed-attempt artifacts, private runners and reports. A subsequent `lstat` returned ENOENT. Measured evidence is retained in this runbook; the disposable runners are intentionally no longer present.
- All migration 0001–0005 SHA-256 values still match the task-start values in section 7; no earlier historical baseline is claimed. Existing unrelated resources/work were not targeted; no Git reset/clean/discard, deployment, publication, hardware/NAS access or desktop installation occurred. Shared Docker build cache was intentionally retained.


| Acceptance | Remaining evidence/action |
|---|---|
| D0 / deployment | User supplies pool name, trusted NAS LAN IP, free RAM and free disk. Version 25.04.2.6 already satisfies the version gate. Only then substitute section 3 values; image push/NAS install require explicit authorization. Keep collector disabled. |
| G0–G4 / V16 | Consult installer about cable or bridge; supply verified wired IP, then perform the sequential probes/captures in the plan. Do not scan or change gateway/router settings. Record real results in `field-mapping.md`. |
| V10 / V12 / V13 on NAS | After gated collection is deployed: measure restart gaps/duplicates; PC off and phone airplane mode for at least two hours, recording start/end; check grid coverage ≥0.99 and sample count ≥713 of720; compare live NAS UI and API and chart gaps. PC replay checks do not replace these. |
| V11 / V20 / V21 on NAS | Perform sections 6–7 using real datasets, dump-time counts and last-complete-day totals; observe an unattended 03:30 backup. Local Docker drills do not verify NAS permissions or ZFS operations. |
| G5 / G6 / V17 | Collect at least24h for counter ratios; photograph import/export/ToU meter registers at day0 and day7 with EXIF times and known resolution. Import delta must reach50kWh (export20kWh for an export verdict). Enter readings, inspect reconciliation, never auto-calibrate. |
| V18 | Supply1–3 real redacted bills, actual rates/holidays and NEM opening origins. Follow bill verification above. No actual TNB rate is built in. |
| V15 | The existing unsigned installer at `apps/desktop/release/House Solar Monitoring Setup 0.1.0.exe` predates the latest runtime correction and was not modified or accepted by this follow-on. Current unpacked-executable checks are recorded above. Rebuild the installer from current source; installation/upgrade/uninstall, installed-app setup/restart and SmartScreen handling require separate user authorization. |
| V23 wall-clock duration | Local 45-minute synthetic replay faults and transaction-crash checks are distinct from NAS operation and OS-kill experiments. The local measurements and their exact scope are recorded above; NAS fault/autonomy and OS-kill acceptance remain unverified. |
| A1 / C1 | Cloud stopgap remains plan-only; agree a secure credential handoff later. No cloud credentials go in chat/repo, and cloud data must never enter the ledger. |
| M6 test-policy decision | Synthetic success-path verifier tests simulate attestation only in disposable databases. This proves mechanics, notV18. The user's choice to retain these or use refusal-only tests is still unresolved. |

### Review-finding fixes — 2026-10-23

Six corrections were made after a source review. **Fresh verification, scoped to this section:**

- `deploy/dev/verify-v20.sh` now uses a unique Compose project and a private `deploy/dev/.secrets/v20.*` directory, refuses a project whose container/network/volume inventory is non-empty or fails, tears down only that project, and reports cleanup failures. A real run passed (V20 PASS, CLEANUP PASS). Fault injection with a stubbed `docker` (one run per scenario, not a matrix) showed: an inventory failure issues no mutating Docker command, exits 1 with `V20 FAIL: cannot inventory containers` and prints `CLEANUP PASS … diagnostics retained` (no resources were admitted, so there was nothing to fail); a failed `up` followed by a failed `down` exits 1 with `CLEANUP FAIL`; an unrelated `.secrets/restore.*` marker survived both.
- `deploy/dev/verify-backup-paths.sh` (stub pg tools, no Docker) checks repeated and overlapping same-tag runs, collision refusal, own-partial-only cleanup and last-success preservation against the real `backup.sh`. V20 provides the authentication and archive-listability evidence; `verify-restore.sh` provides restore evidence.
- `apps/backend/test/ledger.int-spec.ts` ("ledger horizons and exclusion replay"), `test/support-db.int-spec.ts` and `apps/desktop/src/main/api-client.spec.ts` cover the `RENORMALIZE` raw horizon (success, crash/retry, ordinary clamp, preserved unrebuildable buckets), narrow-versus-whole replay with an older excluded counter anchor, disposable-database cleanup, and role-discovery recovery/token-replacement races. These are the first-round tests; each was confirmed to fail with its fix reverted (except the ordinary-clamp control). Historical: the second round below superseded the raw-horizon contract they pin.
- Not re-run: the full integration suite and acceptance workloads, the restore drill, the packaged desktop executable, NAS behaviour. Earlier recorded results above remain historical claims.

### Review follow-ups — 2026-10-23

Second round after the review-finding fixes. Everything in the previous subsections and in the dated tables above is **historical**; only this subsection lists what was executed in this round (PC, Docker, loopback PostgreSQL from `deploy/dev/compose.dev.yaml`, synthetic data only; no NAS, hardware, registry or installer).

**Changes.** (A) Raw-horizon `RENORMALIZE` contract: rebuilt window = the requested range of a RUNNING run (never extended); below the sample cutoff only the window is written, stored rows are never deleted, rows outside it are authoritative (not rewritten, not re-verified, propagation stops, at most the next row is flagged); the request clamps its dirt; retention keeps Samples inside a RUNNING window; verification and the write path apply the same keep-rule. In raw-horizon mode (raw retention longer than sample retention) a `RENORMALIZE` run's `rangeEnd` no longer grows with counter propagation, so such a run can become DONE while propagation dirt beyond its range is still pending; with equal retention the range still follows propagation as before. (B) Desktop: `saveToken` publishes `CONNECTED(UNKNOWN)` at once and the verified role only for the current token; the query role retry is detached. (C) `backup.sh`: traps before the first temp file, `ln -T`, last-success temp created only after publication. (D) `createTestDatabase` drops its database on any post-create failure incl. `admin.end()`, via the exported `provisionOrDrop`. (E) `verify-v20.sh`: `postgres:18.6-bookworm` declares `VOLUME /var/lib/postgresql`; `db-backup` has no tmpfs over it, so Docker attaches an anonymous volume the compose-label inventory cannot see. The script records the exact names and fails cleanup if they survive `down -v`.

**Executed in this round.**

| Command | Result |
|---|---|
| `npm run typecheck -w apps/backend` / `npm run lint -w apps/backend` | exit 0 / exit 0 |
| `npm test -w apps/backend` | 25 files, 209 tests passed |
| `npm run test:int -w apps/backend -- test/ledger.int-spec.ts test/support-db.int-spec.ts` | 2 files, 45 tests passed |
| full `npm run test:int -w apps/backend` (dev DB, port 55432) | 24 files, 278 tests passed |
| `npm run typecheck -w apps/desktop` / `npm test -w apps/desktop` | exit 0 / 16 files, 94 tests passed |
| `bash deploy/dev/verify-backup-paths.sh` | `BACKUP-PATHS PASS` (stub pg tools; not authentication or restore evidence) |
| `bash deploy/dev/verify-v20.sh` | `V20 PASS`, `CLEANUP PASS` |
| fresh `docker build -f apps/backend/Dockerfile`, then `RESTORE_TEST_IMAGE=<tag> bash deploy/dev/verify-restore.sh` | `RESTORE CHECKS PASS`, `CLEANUP PASS`, 179 s, exit 0; only the image tag built for this run was removed afterwards |

Each new ledger, desktop, backup and database test was confirmed to fail when its fix was reverted or against the pre-round file, except the regression guards named in the test names (concurrent publish, password file and prune checks in `verify-backup-paths.sh`, and the ordinary-clamp control).

**Limits.** The `pending` loop in the exclusion lower bound cannot be exercised through the ledger: `stepCounter` never leaves a pending reading older than `last`, so removing the loop changes no observable result (only the stored-versus-verified baseline mistake is detectable, and is tested). Not covered: several or adjacent RUNNING windows, a window straddling the sample cutoff, bounded-work scaling across window sizes, a thrown role retry, injected last-success failures, hard-link behaviour on the NAS filesystem, and the packaged desktop executable. The 20-repeat cap does not bound work done by a transaction that throws.

### Review follow-ups, third pass — 2026-10-23

Changes after a pre-commit source review (everything earlier is **historical**): sample pruning takes the replay reservation (advisory lock 716071/7) without waiting and defers to the next run when it is busy (a blocking wait inside a short transaction would have aborted the whole daily run), so a RENORMALIZE that has not committed its run cannot have its rebuilt Samples pruned; `verify-v20.sh` acquires its process-table, log and `docker inspect` evidence before searching it and fails when acquisition fails (it previously treated a failed command like "no password found"); the in-container process sampler fails on unreadable evidence of a live process and the gate requires three samples that contain the `pg_dump` invocation (a wrapper keeps it alive for 6 s after the real dump finishes, so the sampled process table is not empty of it; the samples may therefore show the held wrapper rather than the native dump process); a RENORMALIZE run's range is fixed only in raw-horizon mode (equal retention keeps the previous following-propagation behaviour); the plan's TrueNAS fallback no longer suggests an unsupported `PGPASSWORD` for `db-backup`; the plan's work-bound wording now says verification and lookahead can read several days inside one transaction.

New tests: pruning defers while a replay holds the reservation and keeps Samples in a RUNNING window (`retention.int-spec.ts`); several adjacent and disjoint windows, a window straddling the sample cutoff, and a 72-bucket window with a call bound (`ledger.int-spec.ts`); the same continuation test for LEDGER_RECOMPUTE and RENORMALIZE runs under default retention (`ledger-crash.int-spec.ts`); a transport failure during a role retry (`api-client.spec.ts`); injected last-success mktemp/chmod/mv failures (`verify-backup-paths.sh`). The retention lock, the RENORMALIZE continuation gate, the role-retry flag release and the last-success cleanup were each confirmed to fail their test when removed; the multi-window and straddle tests are coverage of those configurations and were not mutation-sensitive.

| Command | Result |
|---|---|
| backend typecheck / lint | exit 0 / exit 0 |
| `npm test -w apps/backend` | 25 files, 209 tests passed |
| full `npm run test:int -w apps/backend` | 24 files, 282 tests passed |
| desktop typecheck / `npm test -w apps/desktop` | exit 0 / 16 files, 95 tests passed |
| `verify-backup-paths.sh` / `verify-v20.sh` | `BACKUP-PATHS PASS` / `V20 PASS`, `CLEANUP PASS` |
| fresh image build + `verify-restore.sh` | `RESTORE CHECKS PASS`, `CLEANUP PASS`, 179 s; only the tag built for the run was removed |
| `verify-v20.sh` with a `docker` wrapper whose `inspect` fails | `V20 FAIL: cannot record the volumes…`, exit 1 (it stopped at volume recording, before the final credential gate; the final gate's fail-closed capture is verified by reading, not by a dedicated fault run) |

Not covered: the `pending` exclusion-bound loop (unobservable, see above), hard-link behaviour on the NAS filesystem, the packaged desktop executable.

### Contract-discrepancy fixes — 2026-10-24

Synthetic/local scope only: a uniquely named, loopback-only `postgres:18.6-bookworm` container (already cached; no pull) with `local-synthetic-only` credentials, plus the test helpers' per-run databases inside it. No NAS, hardware, cloud, registry, installer or real-bill access. The shipping collector stays disabled; `LEDGER_ALGO_VERSION` = 3 and `BILLING_CALC_VERSION` = 2 are unchanged; no migration, schema.gql or generated file changed. Everything above this subsection remains historical; only this subsection records this round.

**Changes.**
1. `collectorStatus`: `policyVersion` is the non-superseded policy in force at server time (`selectSegment`; `0` = none in force), `calcVersion` is `LEDGER_ALGO_VERSION` (running algorithm, not a claim that every bucket was recomputed), `monitoringSince` is the earliest `AccountingPolicy.effectiveFrom` (null without a policy; Sample retention no longer moves it). The read has no side effects. `phase2-exit.int-spec.ts` no longer asserts a non-null `monitoringSince` after five samples, because the policy is seeded only by the next ledger pass.
2. `powerSeries`: `maxPoints` is a hard per-metric maximum (new `series-grid.ts`: smallest table width whose actual aligned count fits, else a 300 s-anchored multiple-of-300 s width). Before the fix a 366-day unaligned window returned 367 points at maxPoints 1, 2 and 50.
3. GraphQL argument nullability: plan updated to the implemented non-null-with-default signatures; no resolver change.
4. `METER_NET` is explicitly the register-1814 meter total; `METER_PER_PHASE` is the directional phase sum. Source already behaved this way (no bug); differing-total regressions were added and `docs/field-mapping.md` reworded. Software semantics only; physical accuracy, signs, CT location and cadence still await G3/G5/G6.

**Pre-fix failures (reproduced before the fix).** `test/api.int-spec.ts` (the 12-test version at the time; a 13th test was added afterwards and was not run against pre-fix code): 5 failed | 7 passed (calcVersion expected 3 got 0; monitoringSince expected null got the earliest retained sample; policyVersion expected 1/2/3/8 got 0). Series (old width rule): `expected 367 to be less than or equal to 1` (also 2 and 50), `expected 2 to be less than or equal to 1` for a window straddling every table boundary; 4 failed | 15 passed. Item 4 and item 3 had no failing pre-state; a temporary mutation deriving NET from the phases made 5 compute/families tests fail, and the source was restored.

**Fresh verification, run from `apps/backend`.**

```
npm run typecheck                      # clean
npm run lint                           # oxlint --type-aware, no diagnostics
npm run build                          # nest build, clean
npx vitest run                         # 26 files, 218 tests passed
DATABASE_URL=postgresql://solar:local-synthetic-only@127.0.0.1:<ephemeral>/postgres \
  npx vitest run --config ./vitest.config.int.ts   # 24 files, 293 tests passed
```

Four independent reviewer passes (one per item) found no defect; their test-quality notes were applied (reverse-ordered version/`effectiveFrom` policy case; null-versus-zero assertions on the directional NET cases). The series reviewer reported additional ad hoc sweeps of synthetic grids and SQL anchor arithmetic; no artifact of those sweeps is retained, so they are not counted as evidence here. A later independent review noted that `METER_PER_PHASE` shared `gridCoveredSec`/`GRID_GAP` with `METER_NET`; this was then fixed by migration `0006_grid_phase_coverage` (see the next subsection).

**Acceptance effect.** Software-level only: V3 now distinguishes meter-total NET from the phase sum; no other V-row changes status. V10-V18, V20 and the V23-V25 gaps stay open. Desktop (`npm test -w apps/desktop`), the installer, `deploy/dev/verify-*.sh` scripts and any NAS/hardware/bill check were **not** run.

**Cleanup.** Removed the container `solar-fix-synth-pg-7f3a` (label `owner=solar-fix-synth`) and its anonymous data volume, verified by creation time and PG 18 contents before removal; no existing container, volume or database was touched.

### Grid candidate coverage (migration 0006) — 2026-10-24

Approved follow-up to the contract-discrepancy round above. Synthetic/local only: uniquely named loopback `postgres:18.6-bookworm` containers (cached image, no pull) removed afterwards with `docker rm -fv`.

**Change.** `EnergyInterval.gridPhaseCoveredSec` is an additive nullable INTEGER with no backfill (migration `0006_grid_phase_coverage`, SHA-256 `f1e58cac8d3db12489e2af0e2304086d9ea89b967997b2f166bef43765c6a836`; 0001-0005 are byte-identical to HEAD). It is the all-three-phases-valid seconds (the minimum over the phase integrations), so `METER_PER_PHASE` no longer borrows the meter-total `gridCoveredSec`. Totals, reconciliation and billing pick coverage by active grid source (NET → `gridCoveredSec`; PER_PHASE → `gridPhaseCoveredSec`, historical NULL → `gridCoveredSec`; INVERTER_COUNTER → counter coverage). `LEDGER_ALGO_VERSION` 3 and `BILLING_CALC_VERSION` 2 are unchanged: legacy rows keep NULL and their original values until an ordinary recompute rewrites them, ledger recovery verification ignores a stored NULL in this column so it never rewrites old buckets by itself, and stored `BillingPeriodResult`s are not invalidated, so a PER_PHASE period changes only when it or its ledger rows are recomputed. The shared `GRID_GAP` flag is unchanged and can over-report a gap for the active candidate, never hide one. `schema.gql` is unchanged; the checked-in Prisma client was regenerated with the repository command. `deploy/dev/verify-restore.sh` and `verify-restore-helper.mjs` hard-code the migration list and were updated for 0006.

**Pre-fix failures** (migration and client applied, compute/consumers not wired): `compute.spec.ts` 5 failed | 29 passed; `totals.int-spec` PER_PHASE with total missing returned `kwh: null, status UNAVAILABLE` instead of `2.880 / OK`; `reconciliation.int-spec` `expected +0 to be 1`; `billing.int-spec` coverage `['0.0000','0.5000','1.0000']` instead of `['1.0000','0.5000','0.3333']`; `ledger-crash.int-spec` with the NULL tolerance disabled rewrote a legacy bucket.

**Fresh verification, from `apps/backend`:** `tsc --noEmit` clean; `npm run lint` no diagnostics; `npm run build` clean; `npx vitest run` 26 files, 225 tests passed; integration `vitest run --config ./vitest.config.int.ts` 24 files, 302 tests passed; `npm test -w apps/desktop` 16 files, 95 tests passed. Migrations 0001-0006 applied from empty matched `schema.prisma` (`prisma migrate diff`: no difference). Two independent reviewer passes (compute/ledger/consumers and deploy/migration) found no defect; their test-gap notes were applied (mixed legacy/new period; CLOCK_STEP and gap cases).

**Image and drill results (2026-10-25, same commit `f4b8dff`).** `docker build -f apps/backend/Dockerfile -t house-solar-backend:dev .` succeeded locally (base images and `npm ci` fetched by the build; nothing logged in to or pushed to a registry); the image contains migrations 0001-0006. Using Git bash (`C:/Program Files/Git/bin/bash.exe`, since the default `bash` here is an empty WSL): `deploy/dev/verify-restore.sh` exit 0 in 187 s (`Pending migration sequence verified: 0001_core,...,0006_grid_phase_coverage`; `/readyz` 200; exact nonempty telemetry/energy equality for the current-schema and actual 0002 -> current restores; `Historical NULL acquisition/SOC/phase coverage and SOC extrema preserved`; `RESTORE CHECKS PASS`, `CLEANUP PASS`); `deploy/dev/verify-v20.sh` exit 0 (`CLEANUP PASS`); `deploy/dev/verify-v19.sh` exit 0 (`V19 PASS`: migrate applies all migrations, backend healthy, `/readyz` 200, wrong password fails closed). Synthetic data, isolated project-scoped volumes and networks removed by the scripts' own cleanup. This is the local isolated variant only. NAS, hardware, installer and real-bill checks remain open. The local `house-solar-backend:dev` image was left in place.

### Dependency risk disclosure

The 2026-10-23 local review upgraded the three exact backend pins and the two Prisma `allowScripts` approvals to **7.10.1**. This ships **deepmerge-ts 8.0.2** and **mysql2 3.24.4**, fixing the previously recorded [recursive-merge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [MySQL authentication downgrade](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) and [compressed-protocol exhaustion](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3). `npm audit --omit=dev -w apps/backend --json` returned **zero findings at every severity**; `npm ls` confirmed the installed versions. This is an inventory/advisory result, not a claim that every application security property has been audited.

Independent read-only review confirmed that the lock changes are limited to Prisma and its changed dependencies: `denque`, `seq-queue` and `sqlstring` leave; `sql-escaper` enters. The **pkg-types 2.3.3 subtree, including nested confbox 0.3.1, is identical to the saved baseline**; it was not removed. No new install-script approval or major Prisma upgrade was introduced. The internal engine build is `d1b3f377`, not an application upgrade to Prisma 8. The generated client reports 7.10.1; repeat generation was byte-identical across all 28 TypeScript files, and schema validation passed. The final production-Dockerfile image built in 35.75 s; its internal-network-only migration/failed-secret gate passed in 23.909 s, and the full current/real-0002 restore drill passed in 194.33 s. The temporary traced Dockerfile supplied separate foreground-install-script evidence; the production Dockerfile itself remains unchanged. PostgreSQL-only/static-config reachability assessment remains limited: reassess if MySQL/Studio or untrusted executable migration configuration is introduced.

On every future Prisma bump, update both exact-version `allowScripts` entries together with the three package pins and rerun offline V19. Do not rely on an npm version's unapproved-script default; the tested image uses npm 11.19.1.
