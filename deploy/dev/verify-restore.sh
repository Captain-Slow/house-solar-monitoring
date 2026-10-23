#!/usr/bin/env bash
# Local V11/V21 restore drill using the production backup and restore Compose files.
# Requires Docker and a freshly built image (RESTORE_TEST_IMAGE, default house-solar-backend:dev).
# No hardware/NAS access: isolated named volumes, loopback-only API, collector disabled.
# Verifies current-schema restore and populated 0002_accounting -> current migrations.
set -euo pipefail
set +x                         # Never trace password generation or authenticated helper execution.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
umask 077
mkdir -p .secrets
W="$(mktemp -d .secrets/restore.XXXXXX)"
project="restore$(openssl rand -hex 12)"
pgdata="${project}_pgdata"; backups="${project}_backups"; tls="${project}_tls"
P=(docker compose -p "$project" -f "$W/prod.yaml" -f "$W/helper.yaml")
O=("${P[@]}" -f "$W/old.yaml")
R=(docker compose -p "${project}r" -f "$W/restore.yaml")
test_image="${RESTORE_TEST_IMAGE:-house-solar-backend:dev}"
init_container="${project}-volume-init"
owned_volumes=()
started=$SECONDS
resources_admitted=0
cleanup() {
  local status=$? cleanup_failed=0 remaining=""
  trap - EXIT INT TERM
  set +e
  if [ "$status" -ne 0 ] && [ "$resources_admitted" -eq 1 ]; then
    "${P[@]}" ps -a
    "${P[@]}" logs --no-color --tail 60
    "${R[@]}" ps -a
    "${R[@]}" logs --no-color --tail 60
    for log in "$W"/*.log; do [ ! -f "$log" ] || cat "$log"; done
  fi
  if [ "$resources_admitted" -eq 1 ]; then
    "${P[@]}" down --remove-orphans || cleanup_failed=1
  fi
  if [ "$resources_admitted" -eq 1 ]; then
    "${R[@]}" down --remove-orphans || cleanup_failed=1
  fi
  if [ "$resources_admitted" -eq 1 ]; then
  # The volume initializer is outside Compose; label it and own its exact name.
  remaining="$(docker ps -aq --filter "label=house-solar.restore-drill=$project")" || cleanup_failed=1
  if [ -n "$remaining" ]; then
    docker rm -f $remaining || cleanup_failed=1
  fi
  for volume in "${owned_volumes[@]}"; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      if [ "$(docker volume inspect -f '{{ index .Labels "house-solar.restore-drill" }}' "$volume")" = "$project" ]; then
        docker volume rm "$volume" || cleanup_failed=1
      else
        echo "CLEANUP REFUSED: $volume is not owned by $project" >&2
        cleanup_failed=1
      fi
    fi
  done
  for owner in "$project" "${project}r"; do
    remaining="$(docker ps -aq --filter "label=com.docker.compose.project=$owner")" || cleanup_failed=1
    [ -z "$remaining" ] || cleanup_failed=1
    remaining="$(docker network ls -q --filter "label=com.docker.compose.project=$owner")" || cleanup_failed=1
    [ -z "$remaining" ] || cleanup_failed=1
  done
  remaining="$(docker volume ls -q --filter "label=house-solar.restore-drill=$project")" || cleanup_failed=1
  [ -z "$remaining" ] || cleanup_failed=1
  remaining="$(docker ps -aq --filter "label=house-solar.restore-drill=$project")" || cleanup_failed=1
  [ -z "$remaining" ] || cleanup_failed=1
  fi
  rm -f -- "$W/db_password" || cleanup_failed=1
  if [ "$status" -eq 0 ] && [ "$cleanup_failed" -eq 0 ]; then
    rm -rf -- "$W" || cleanup_failed=1
  fi
  if [ "$cleanup_failed" -ne 0 ]; then
    echo "CLEANUP FAIL: inspect inventory project=$project work=$PWD/$W" >&2
    status=1
  elif [ "$status" -ne 0 ]; then
    echo "CLEANUP PASS: project=$project; no owned Docker resources; secret removed; failure diagnostics retained at $PWD/$W"
  else
    echo "CLEANUP PASS: project=$project; no owned containers, networks, volumes or work files"
  fi
  echo "Restore drill elapsed: $((SECONDS - started)) seconds; exit=$status"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fail() { echo "RESTORE FAIL: $*" >&2; exit 1; }

# Mount only the real historical migrations for the initial migrate container.
# Never overlay a synthetic migration or change the full-migration production image.
mkdir -p "$W/old-migrations/0001_core" "$W/old-migrations/0002_accounting"
cp ../../apps/backend/prisma/migrations/migration_lock.toml "$W/old-migrations/"
for migration in 0001_core 0002_accounting; do
  cp "../../apps/backend/prisma/migrations/$migration/migration.sql" "$W/old-migrations/$migration/"
  chmod 755 "$W/old-migrations/$migration"
  chmod 644 "$W/old-migrations/$migration/migration.sql"
done
chmod 755 "$W/old-migrations"
chmod 644 "$W/old-migrations/migration_lock.toml"
openssl rand -base64 32 > "$W/db_password"
# Compose file-backed secrets must be readable by the production container UIDs.
# The host directory remains 0700 and the file is removed by the trap.
chmod 644 "$W/db_password"
derive() {
  sed -e "s#/mnt/POOL/apps/house-solar/pgdata#$pgdata#; s#/mnt/POOL/apps/house-solar/backups#$backups#; s#/mnt/POOL/apps/house-solar/tls#$tls#" \
      -e 's#/mnt/POOL/apps/house-solar/scripts#../../../truenas#; s#/mnt/POOL/apps/house-solar/secrets/db_password#./db_password#' \
      -e "s#ghcr.io/captain-slow/house-solar-backend:0.1.0#$test_image#; s#COLLECTOR_ENABLED: \"true\"#COLLECTOR_ENABLED: \"false\"#" \
      -e 's#"NAS_IP:8443:8443"#"127.0.0.1::8443"#' "$1" > "$2"
  printf '\nvolumes:\n  %s: { external: true }\n  %s: { external: true }\n  %s: { external: true }\n' "$pgdata" "$backups" "$tls" >> "$2"
}
derive ../truenas/compose.yaml "$W/prod.yaml"
derive ../truenas/compose.restore.yaml "$W/restore.yaml"
cat > "$W/helper.yaml" <<'YAML'
services:
  backend:
    volumes:
      - "../../verify-restore-helper.mjs:/tmp/verify-restore-helper.mjs:ro"
YAML
cat > "$W/old.yaml" <<'YAML'
services:
  migrate:
    volumes:
      - "./old-migrations:/app/prisma/migrations:ro"
YAML

img=postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c
old_migs=0001_core,0002_accounting
current_migs="$old_migs,0003_tariff,0004_raw_poll_monotonic,0005_soc_coverage"
SQL() { docker exec "$1" psql -X -v ON_ERROR_STOP=1 -U solar -d "${3:-solar}" -Atc "$2"; }
MIGS() { SQL "$1" 'select string_agg(migration_name, chr(44) order by migration_name) from _prisma_migrations where finished_at is not null and rolled_back_at is null'; }
assert_volume_absent() {
  local existing
  existing="$(docker volume ls -q --filter "name=^$1$")" || fail 'cannot inventory Docker volumes'
  [ -z "$existing" ] || fail "refusing existing volume $1"
}
mkvol() {
  assert_volume_absent "$1"
  docker volume create --label "house-solar.restore-drill=$project" "$1" >/dev/null
  # Track immediately, including failures in ownership initialization.
  if [[ " ${owned_volumes[*]} " != *" $1 "* ]]; then owned_volumes+=("$1"); fi
  [ "$(docker volume inspect -f '{{ index .Labels "house-solar.restore-drill" }}' "$1")" = "$project" ] || fail "volume ownership changed: $1"
  docker run --rm --name "$init_container" --label "house-solar.restore-drill=$project" \
    -v "$1":/d --entrypoint sh "$img" -c "chown $2 /d && chmod $3 /d" >/dev/null
}
helper() { "${P[@]}" exec -T backend node /tmp/verify-restore-helper.mjs "$@"; }
healthy() {
  local compose=$1 service=$2 i
  local -n cmd="$compose"
  for i in $(seq 1 90); do
    if "${cmd[@]}" ps --format '{{.Service}} {{.Health}}' | grep -q "^$service healthy$"; then return 0; fi
    sleep 2
  done
  fail "$service did not become healthy ($compose)"
}
ready() {
  wait_migrate
  [ "$(MIGS "$DB")" = "$current_migs" ] || fail 'backend readiness before required migrations'
  local migrate backend finished started_at
  migrate="$("${P[@]}" ps -aq migrate)"
  backend="$("${P[@]}" ps -q backend)"
  finished="$(docker inspect -f '{{.State.FinishedAt}}' "$migrate")"
  started_at="$(docker inspect -f '{{.State.StartedAt}}' "$backend")"
  # Docker omits trailing fractional zeros; normalize rather than compare RFC3339 text.
  [ "$(date -d "$finished" +%s%N)" -le "$(date -d "$started_at" +%s%N)" ] || fail 'backend started before migrate finished'
  healthy P backend
  helper readyz || fail '/readyz not 200'
  echo "Ordering: migrate finished=$finished; backend started=$started_at; /readyz=200"
}
wait_migrate() {
  local i
  for i in $(seq 1 90); do
    if "${P[@]}" ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | grep -q '^migrate exited 0$'; then return 0; fi
    sleep 2
  done
  fail 'production migrate did not exit successfully'
}
# Check every table/sequence/index and the enum introduced by real 0003, not just one marker.
tariff_objects() {
  SQL "$1" "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'Tariff%' OR c.relname LIKE 'BillingPeriod%')) + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='BillingStatus')"
}
telemetry() {
  local raw_remove="'monotonicMs','acquisitionClockStep','acquisitionMeterRepeatSec'"
  local energy_remove="'socCoveredSec'"
  if [ "${2:-legacy}" = current ]; then raw_remove=""; energy_remove=""; fi
  SQL "$1" "select json_build_object(
    'RawPoll', (select count(*) from \"RawPoll\"),
    'Sample', (select count(*) from \"Sample\"),
    'EnergyInterval', (select count(*) from \"EnergyInterval\"),
    'newestSample', (select row_to_json(s) from \"Sample\" s order by \"observedAt\" desc limit 1),
    'rawDigest', (select md5(string_agg(md5((to_jsonb(r) - ARRAY[$raw_remove]::text[])::text), '' order by id)) from \"RawPoll\" r),
    'sampleDigest', (select md5(string_agg(md5(to_jsonb(s)::text), '' order by id)) from \"Sample\" s),
    'energyDigest', (select md5(string_agg(md5((to_jsonb(e) - ARRAY[$energy_remove]::text[])::text), '' order by \"bucketStart\")) from \"EnergyInterval\" e))"
}
snapshot() {
  helper snapshot "$day" > "$W/$1.json" || fail "authenticated telemetry/energy snapshot failed ($1)"
  [ "$(telemetry "$DB")" = "$before_telemetry" ] || fail "historical row fingerprints changed ($1)"
  if [ "${2:-legacy}" = current ]; then
    [ "$(telemetry "$DB" current)" = "$current_telemetry" ] || fail "current row fingerprints changed ($1)"
  fi
  cmp -s "$W/before.json" "$W/$1.json" || fail "counts/newest Sample/exact energyTotals changed ($1)"
  echo "$1: nonempty telemetry and all six last-complete-day kWh strings identical"
}
backup() {
  local tag=$1 output
  output="$("${P[@]}" exec -T db-backup /scripts/backup.sh once pre-upgrade "$tag")" || fail 'production backup.sh failed'
  printf '%s\n' "$output" | grep -q 'BACKUP OK' || fail 'no BACKUP OK from production script'
  printf '%s\n' "$output" >&2
  # The backup script owns the timestamped path; this isolated volume has one matching tag.
  "${P[@]}" exec -T db-backup sh -c "printf '%s\\n' /backups/pre-upgrade/solar-$tag-*.dump"
}
restore() {
  local dump=$1 expected=$2 empty
  "${P[@]}" down --remove-orphans >/dev/null 2>&1   # production step 1: stop the app
  docker volume rm "$pgdata" >/dev/null           # step 2: replace the pgdata dataset
  mkvol "$pgdata" 999:999 0700
  "${R[@]}" up -d > "$W/restore-$expected-up.log" 2>&1 || fail 'restore app did not start'
  healthy R db                                   # step 3: PostgreSQL alone
  [ "$("${R[@]}" ps --format '{{.Service}}')" = db ] || fail 'restore app runs more than PostgreSQL'
  RDB="$("${R[@]}" ps -q db)"
  docker exec "$RDB" psql -X -v ON_ERROR_STOP=1 -U solar -d postgres \
    -c 'DROP DATABASE solar' -c 'CREATE DATABASE solar TEMPLATE template0 OWNER solar' >/dev/null
  empty="$(SQL "$RDB" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')")"
  [ "$empty" = 0 ] || fail "target database not empty: $empty"
  echo "Restore target: only PostgreSQL running; empty object count=$empty; archive=$dump"
  docker exec "$RDB" pg_restore -U solar -d solar --exit-on-error --single-transaction "$dump" || fail 'restore into empty database failed'
  [ "$(MIGS "$RDB")" = "$expected" ] || fail 'restored migration history differs from dump'
  [ "$(telemetry "$RDB")" = "$before_telemetry" ] || fail 'restored counts/newest Sample differ before migrate'
  if [ "$expected" = "$current_migs" ]; then
    [ "$(telemetry "$RDB" current)" = "$current_telemetry" ] || fail 'current acquisition/SOC fields changed on restore'
  fi
  if [ "$expected" = "$old_migs" ]; then
    [ "$(tariff_objects "$RDB")" = 0 ] || fail '0003 tariff objects survived the older dump restore'
    echo 'Older dump restored: exactly 0001/0002 applied; all 0003 tariff objects absent'
  fi
  "${R[@]}" down --remove-orphans >/dev/null 2>&1  # step 6: delete restore app, retain pgdata
}
assert_pending_migrations() {
  local logfile=$1 applied expected
  applied="$(sed -n 's/^Applying migration `\([^`]*\)`.*$/\1/p' "$logfile")"
  expected=$'0003_tariff\n0004_raw_poll_monotonic\n0005_soc_coverage'
  [ "$applied" = "$expected" ] || fail "expected pending migrations $expected, got: $applied"
  [ "$(MIGS "$DB")" = "$current_migs" ] || fail 'migration history does not match the current schema'
  [ "$(tariff_objects "$DB")" -gt 0 ] || fail 'real tariff migration objects missing'
  [ "$(SQL "$DB" "SELECT count(*) FROM information_schema.columns WHERE table_name='RawPoll' AND column_name IN ('monotonicMs','acquisitionClockStep','acquisitionMeterRepeatSec')")" = 3 ] || fail 'raw acquisition timing columns missing'
  [ "$(SQL "$DB" "SELECT count(*) FROM information_schema.columns WHERE table_name='EnergyInterval' AND column_name='socCoveredSec' AND is_nullable='YES' AND data_type='integer'")" = 1 ] || fail 'nullable independent SOC coverage column missing'
  echo "Pending migration sequence verified: $current_migs"
}

echo "Inventory: project=$project restore_project=${project}r image=$test_image"
echo "Inventory: volumes=$pgdata,$backups,$tls initializer=$init_container work=$PWD/$W"
docker image inspect "$test_image" --format 'Test image ID: {{.Id}}' || fail 'test image unavailable'
# Admission precedes every Docker mutation. Never adopt an existing namespace.
for owner in "$project" "${project}r"; do
  existing="$(docker ps -aq --filter "label=com.docker.compose.project=$owner")" || fail 'cannot inventory Compose containers'
  [ -z "$existing" ] || fail "existing Compose project $owner"
  existing="$(docker network ls -q --filter "name=^${owner}_")" || fail 'cannot inventory Docker networks'
  [ -z "$existing" ] || fail "existing network namespace $owner"
done
for volume in "$pgdata" "$backups" "$tls"; do
  assert_volume_absent "$volume"
done
existing="$(docker ps -aq --filter "name=^/$project")" || fail 'cannot inventory named drill containers'
[ -z "$existing" ] || fail 'existing container namespace'
resources_admitted=1
echo '== setup: production dataset ownership and real 0001/0002 only'
mkvol "$pgdata" 999:999 0700; mkvol "$backups" 999:568 0750; mkvol "$tls" 568:568 0700
"${P[@]}" up -d db db-backup > "$W/initial-up.log" 2>&1 || fail 'database/production backup service did not start'
"${O[@]}" run --rm --name "${project}-historical-migrate" migrate > "$W/initial-migrate.log" 2>&1 || fail 'initial historical migrate failed'
DB="$("${P[@]}" ps -q db)"
[ "$(MIGS "$DB")" = "$old_migs" ] || fail 'initial database must have exactly real 0001/0002 applied'
[ "$(tariff_objects "$DB")" = 0 ] || fail 'initial old schema contains tariff objects'
[ -z "$("${P[@]}" ps -aq backend)" ] || fail 'backend exists before schema upgrade'
day="$("${P[@]}" run --rm --no-deps --name "${project}-seed" backend node /tmp/verify-restore-helper.mjs seed)" || fail 'historical SQL telemetry seed failed'
before_telemetry="$(telemetry "$DB")"
echo "Fixture: last complete local day $day; RawPoll=8641, Sample=8641, EnergyInterval=288"
echo "$before_telemetry"
old_dump="$(backup old-0002)"
[ "$(MIGS "$DB")" = "$old_migs" ] || fail 'older dump was not taken at exactly 0001/0002'

echo '== upgrade populated accounting schema with the real pending migrations'
"${P[@]}" run --rm --name "${project}-upgrade" migrate > "$W/upgrade.log" 2>&1 || fail 'pending migration upgrade failed'
assert_pending_migrations "$W/upgrade.log"
"${P[@]}" up -d backend > "$W/upgraded-up.log" 2>&1 || fail 'current production app did not start'
wait_migrate; ready
[ "$(telemetry "$DB")" = "$before_telemetry" ] || fail 'historical row fingerprints changed during migration'
helper snapshot "$day" > "$W/before.json" || fail 'post-migration authenticated energyTotals baseline failed'
cat "$W/before.json"
snapshot upgraded
helper enrich-current || fail 'current timing/SOC fixture preparation failed'
current_telemetry="$(telemetry "$DB" current)"
echo "Current-schema fingerprint: $current_telemetry"
current_dump="$(backup current-schema)"

echo '== A. current-schema production-path restore (real backup.sh + restore Compose)'
restore "$current_dump" "$current_migs"
"${P[@]}" up -d > "$W/current-up.log" 2>&1 || fail 'production app did not start after current restore'
wait_migrate
"${P[@]}" logs --no-color --no-log-prefix migrate > "$W/current-migrate.log" 2>&1
 grep -q 'No pending migrations' "$W/current-migrate.log" || fail 'current dump unexpectedly needs migrations'
DB="$("${P[@]}" ps -q db)"
ready
snapshot current-restored current

echo '== negative counterexample: --clean --if-exists old dump over the current schema'
"${P[@]}" stop backend db-backup >/dev/null 2>&1
# Old dumps cannot drop objects they do not know about. Capture, rather than hide, the exit status.
clean_status=0
docker exec "$DB" pg_restore -U solar -d solar --clean --if-exists "$old_dump" > "$W/negative-clean.log" 2>&1 || clean_status=$?
[ "$(tariff_objects "$DB")" -gt 0 ] || fail 'counterexample did not retain newer tariff objects'
[ "$(MIGS "$DB")" = "$old_migs" ] || fail 'counterexample did not restore old migration history'
echo "Recorded: --clean exit=$clean_status, real tariff objects retained beside 0001/0002 migration history"

echo '== B. older-schema production-path restore: empty template0 database, NO --clean'
restore "$old_dump" "$old_migs"
"${P[@]}" up -d > "$W/old-restored-up.log" 2>&1 || fail 'production app did not start after old restore'
wait_migrate
DB="$("${P[@]}" ps -q db)"
"${P[@]}" logs --no-color --no-log-prefix migrate > "$W/old-restored-migrate.log" 2>&1
assert_pending_migrations "$W/old-restored-migrate.log"
ready
snapshot old-restored
helper assert-legacy || fail 'older restored migration invented historical timing/SOC coverage'
[ "$(SQL "$DB" 'select count(*) from "ApiToken"')" = 0 ] || fail 'temporary helper token hash retained'
echo 'RESTORE CHECKS PASS: current and actual 0002 -> current restores; /readyz 200; exact nonempty telemetry/energy equality'
