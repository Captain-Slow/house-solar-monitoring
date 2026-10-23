#!/usr/bin/env bash
# V20 (plan): unattended backup authentication.
#  - db requires password auth; db-backup has no PGPASSWORD;
#  - the nightly loop AND `backup.sh once pre-upgrade <tag>` each produce a listable .dump via their own
#    /run/pg/pgpass.* file (mode 0600);
#  - running the pre-upgrade command with `docker exec` inside the live daemon container leaves the
#    daemon's next scheduled dump successful;
#  - a password file at 0640 is ignored by libpq: BACKUP FAILED, no .partial left, nothing hangs;
#  - container logs, `docker inspect` (env/args) and the process table contain no password string.
# Needs Docker. Run with Git bash on Windows.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git bash on Windows must not rewrite /container/paths
cd "$(dirname "$0")"
umask 077
mkdir -p .secrets
# Private per-invocation work dir and a unique Compose project; nothing shared with other runs.
W="$(mktemp -d .secrets/v20.XXXXXX)"
project="v20$(openssl rand -hex 12)"
export COMPOSE_PROJECT_NAME="$project"
export V20_SECRET_DIR="./$W"
export BACKUP_TIME=00:00   # placeholder so the compose file parses; the real time is set after db is ready
C=(docker compose -p "$project" -f compose.v20.yaml)
resources_admitted=0
# Fails closed: an inventory error or any pre-existing resource under this project refuses the run.
assert_project_absent() {
  local existing
  existing="$(docker ps -aq --filter "label=com.docker.compose.project=$project")" || fail "cannot inventory containers"
  [ -z "$existing" ] || fail "refusing existing containers for project $project"
  existing="$(docker network ls -q --filter "label=com.docker.compose.project=$project")" || fail "cannot inventory networks"
  [ -z "$existing" ] || fail "refusing existing networks for project $project"
  existing="$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" || fail "cannot inventory volumes"
  [ -z "$existing" ] || fail "refusing existing volumes for project $project"
}
# postgres:18.6-bookworm declares `VOLUME /var/lib/postgresql` (docker image inspect .Config.Volumes). `db` masks it
# with a tmpfs, `db-backup` does not, so Docker attaches an ANONYMOUS volume to that container. Anonymous volumes
# carry no Compose project label, so the label inventories below cannot see them: record the exact volume names
# mounted by this project's containers and require those very names to be gone after `down -v`. Nothing outside
# this list is ever looked up for removal, and nothing is removed here except through `down -v`.
recorded_volumes=()
record_volumes() {
  local ids names name
  local -a idlist
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project")" || return 1
  [ -n "$ids" ] || return 0
  mapfile -t idlist <<<"$ids"
  names="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "${idlist[@]}")" || return 1
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '%s\n' "${recorded_volumes[@]}" | grep -Fxq -- "$name" || recorded_volumes+=("$name")
  done <<<"$names"
}
cleanup() {
  local status=$? cleanup_failed=0 remaining="" name
  trap - EXIT INT TERM
  set +e
  if [ "$resources_admitted" -eq 1 ]; then
    # Also covers containers created after the post-start record, or by a run that failed early.
    record_volumes || cleanup_failed=1
    # The project name is unique to this invocation, so project-scoped teardown cannot touch other runs.
    "${C[@]}" down -v --remove-orphans || cleanup_failed=1
    remaining="$(docker ps -aq --filter "label=com.docker.compose.project=$project")" || cleanup_failed=1
    [ -z "$remaining" ] || cleanup_failed=1
    remaining="$(docker network ls -q --filter "label=com.docker.compose.project=$project")" || cleanup_failed=1
    [ -z "$remaining" ] || cleanup_failed=1
    remaining="$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" || cleanup_failed=1
    [ -z "$remaining" ] || cleanup_failed=1
    # Exactly the volume names recorded above (labelled or anonymous) must be gone.
    remaining="$(docker volume ls -q)" || cleanup_failed=1
    for name in "${recorded_volumes[@]}"; do
      if grep -Fxq -- "$name" <<<"$remaining"; then echo "CLEANUP: recorded volume $name still exists" >&2; cleanup_failed=1; fi
    done
  fi
  # Only this invocation's private directory is ever removed; .secrets and its siblings are left alone.
  rm -f -- "$W/db_password" || cleanup_failed=1
  if [ "$status" -eq 0 ] && [ "$cleanup_failed" -eq 0 ]; then
    rm -rf -- "$W" || cleanup_failed=1
  fi
  if [ "$cleanup_failed" -ne 0 ]; then
    echo "CLEANUP FAIL: inspect inventory project=$project work=$PWD/$W" >&2
    status=1
  elif [ "$status" -ne 0 ]; then
    echo "CLEANUP PASS: project=$project; no owned Docker resources; secret removed; diagnostics retained at $PWD/$W"
  else
    echo "CLEANUP PASS: project=$project; no owned containers, networks, volumes or work files"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fail() { echo "V20 FAIL: $*" >&2; if [ "$resources_admitted" -eq 1 ]; then "${C[@]}" logs --no-color 2>&1 | tail -40 >&2; fi; exit 1; }
BK() { "${C[@]}" exec -T db-backup "$@"; }

# Password with + / = and the two characters the password file must escape (: and \).
pw="$(openssl rand -base64 24)+/=:a\\b"
printf '%s' "$pw" > "$W/db_password"
chmod 644 "$W/db_password"   # container UID 999 reads the bind-mounted secret; the directory stays 0700
assert_project_absent
resources_admitted=1

echo "== start db"
"${C[@]}" up -d db >/dev/null 2>&1 || fail "db did not start"
for i in $(seq 1 40); do
  [ "$("${C[@]}" ps --format '{{.Service}} {{.Health}}' | grep -c healthy)" -ge 1 ] && break; sleep 2
done
# Rounded DOWN to the minute, +150 s guarantees the dump fires 90-150 s from now, after db is ready.
export BACKUP_TIME="$(date -u -d '+150 seconds' +%H:%M)"
echo "== start db-backup (daemon dump scheduled at $BACKUP_TIME UTC)"
"${C[@]}" up -d db-backup >/dev/null 2>&1 || fail "db-backup did not start"
sleep 2
record_volumes || fail "cannot record the volumes mounted by this project's containers"
echo "volumes mounted by this project's containers: ${recorded_volumes[*]:-none}"

echo "== db-backup has no PGPASSWORD; db requires a password"
envdump="$(BK env)" || fail "cannot exec into db-backup (did the daemon start?)"
if echo "$envdump" | grep -q '^PGPASSWORD='; then fail "PGPASSWORD present in db-backup env"; fi
if BK psql -w -h db -U solar -d solar -Atc 'select 1' >/dev/null 2>&1; then fail "db accepted a password-less TCP login"; fi
if BK pg_dump -w -h db -U solar -d solar -Fc -f /tmp/x.dump >/dev/null 2>&1; then fail "pg_dump worked without a password"; fi

echo "== pre-upgrade run inside the live daemon container"
out="$(BK /scripts/backup.sh once pre-upgrade t1)" || fail "pre-upgrade run failed: $out"
echo "$out" | grep -q "BACKUP OK" || fail "no BACKUP OK: $out"
pre="$(BK sh -c 'ls /backups/pre-upgrade/solar-t1-*.dump')" || fail "no pre-upgrade dump"
BK pg_restore --list "$pre" >/dev/null || fail "pre-upgrade dump not listable"
echo "pre-upgrade dump listable: $(basename "$pre")"
BK sh -c 'ls /run/pg | wc -l' | grep -qx 0 || fail "stray password files left in /run/pg after the run"

echo "== sample the process table while a dump runs (no password in argv/environ of any process)"
# A pg_dump wrapper that keeps the dump "running" for $WRAP_SLEEP s (default 40) after the real dump
# completes, so the sampled process table is guaranteed to contain a running dump.
cat > "$W"/pg_dump <<'WRAP'
#!/bin/bash
/usr/bin/pg_dump "$@"
rc=$?
sleep "${WRAP_SLEEP:-40}" </dev/null >/dev/null 2>&1
exit $rc
WRAP
# Process-table sampler: unreadable evidence of a live process is an error (exit 1); a process that
# exits between listing and reading is not.
cat > "$W"/sample.sh <<'SAMPLE'
#!/bin/sh
rc=0
for p in /proc/[0-9]*; do
  for f in cmdline environ; do
    [ -e "$p/$f" ] || continue
    { tr '\0' '\n' < "$p/$f"; } 2>/dev/null || { [ -d "$p" ] && rc=1; }
  done
done
exit $rc
SAMPLE
"${C[@]}" cp "$W"/pg_dump db-backup:/tmp/pg_dump_wrap >/dev/null 2>&1 || fail "could not copy the pg_dump wrapper"
"${C[@]}" cp "$W"/sample.sh db-backup:/tmp/sample.sh >/dev/null 2>&1 || fail "could not copy the process sampler"
BK sh -c 'mkdir -p /tmp/bin && cp /tmp/pg_dump_wrap /tmp/bin/pg_dump && chmod +x /tmp/bin/pg_dump' || fail "could not install the pg_dump wrapper"
( BK env WRAP_SLEEP=6 PATH=/tmp/bin:/usr/bin:/bin /scripts/backup.sh once pre-upgrade t2 >/dev/null 2>&1 ) &
bgpid=$!
leak=0
saw=0
for i in $(seq 1 40); do
  snap="$(BK sh /tmp/sample.sh)" || fail "cannot read the process table (unreadable evidence of a live process)"
  [ -n "$snap" ] || fail "process table sample was empty"
  if grep -qF "$pw" <<<"$snap"; then leak=1; fi
  if grep -q 'pg_dump' <<<"$snap"; then saw=$((saw + 1)); fi
  if [ "$saw" -ge 3 ]; then break; fi
  sleep 0.2
done
wait "$bgpid" || true
[ "$saw" -ge 3 ] || fail "the process-table samples never captured the running dump"
[ "$leak" = 0 ] || fail "password found in a process cmdline/environ"

echo "== a 0640 password file is ignored by libpq: BACKUP FAILED, no .partial, no hang"
# Build a variant whose password file is group-readable (0640) from the real script.
printf '%s\n' '/f=\$(mktemp /a\' '  chmod 0640 "$f"' > "$W"/b640.sed
"${C[@]}" cp "$W"/b640.sed db-backup:/tmp/b640.sed >/dev/null 2>&1 || fail "could not copy the sed program"
BK bash -c "sed -f /tmp/b640.sed /scripts/backup.sh > /tmp/b640.sh && chmod +x /tmp/b640.sh && grep -c 'chmod 0640 \"\$f\"' /tmp/b640.sh" | grep -qx 1 || fail "could not build the 0640 variant"
set +e
bad="$(timeout 60 "${C[@]}" exec -T db-backup /tmp/b640.sh once pre-upgrade bad640 2>&1)"; rc=$?
set -e
[ "$rc" != 0 ] && [ "$rc" != 124 ] || fail "0640 variant exit code $rc (hang or success): $bad"
echo "$bad" | grep -q "BACKUP FAILED" || fail "no BACKUP FAILED: $bad"
left="$(BK sh -c 'ls -la /backups/pre-upgrade /run/pg')"
echo "$left" | grep -q "partial\|bad640" && fail "partial/bad640 file left behind: $left"
[ "$(BK sh -c 'ls /run/pg | wc -l')" = 0 ] || fail "password file left in /run/pg after a failed backup: $left"
echo "0640 variant: exit $rc, BACKUP FAILED logged, no leftovers"

echo "== SIGTERM during a dump: cancelled, no .partial, no password file left"
# The pg_dump wrapper installed above keeps the dump "running" for 40 s after the real dump completes, and a
# helper finds the main backup.sh process (lowest pid) by its command line.
cat > "$W"/findpid.sh <<'FIND'
#!/bin/sh
for p in /proc/[0-9]*; do
  id=${p#/proc/}
  [ "$id" = "$$" ] && continue
  if tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q '^bash /scripts/backup.sh once pre-upgrade term1'; then echo "$id"; fi
done | sort -n | head -1
FIND
"${C[@]}" cp "$W"/findpid.sh db-backup:/tmp/findpid.sh >/dev/null 2>&1 || fail "could not copy the pid finder"
rm -f "$W"/term.rc "$W"/term.log
( rc=0; "${C[@]}" exec -T db-backup env PATH=/tmp/bin:/usr/bin:/bin /scripts/backup.sh once pre-upgrade term1 > "$W"/term.log 2>&1 || rc=$?; echo "$rc" > "$W"/term.rc ) &
pid=""
for i in $(seq 1 20); do pid="$(BK sh /tmp/findpid.sh || true)"; [ -n "$pid" ] && break; sleep 0.5; done
[ -n "$pid" ] || fail "could not find the running backup.sh process: $(cat "$W"/term.log 2>/dev/null)"
sleep 3   # the real dump has finished; the wrapper is now 'still dumping'
[ "$(BK sh -c 'ls /backups/pre-upgrade/*term1*.partial 2>/dev/null | wc -l')" = 1 ] || fail "expected the .partial of the running dump to exist before SIGTERM"
BK sh -c "kill -TERM $pid"
for i in $(seq 1 30); do [ -f "$W"/term.rc ] && break; sleep 0.5; done
if [ ! -f "$W"/term.rc ]; then
  procs="$(BK sh -c 'for p in /proc/[0-9]*; do printf "%s ppid=%s: " ${p#/proc/} $(awk "/^PPid/{print \$2}" $p/status); tr "\0" " " < $p/cmdline; echo; done' 2>&1 | grep -i 'backup\|pg_dump\|sleep' || true)"
  fail "backup.sh did not exit after SIGTERM (sent to pid $pid). processes: $procs; log: $(cat "$W"/term.log 2>/dev/null)"
fi
[ "$(cat "$W"/term.rc)" = 143 ] || fail "exit code after SIGTERM: $(cat "$W"/term.rc)"
left="$(BK sh -c 'ls -la /backups/pre-upgrade /run/pg')"
echo "$left" | grep -q "term1" && fail "dump files left after SIGTERM: $left"
[ "$(BK sh -c 'ls /run/pg | wc -l')" = 0 ] || fail "password file left after SIGTERM: $left"
echo "SIGTERM: exit 143, .partial and password file removed"

echo "== Sunday weekly copy: atomic, listable, and a failure is logged without stopping the shell"
BK sh -c 'sed "/^trap terminate TERM INT/,\$d" /scripts/backup.sh > /tmp/lib.sh'
okout="$(BK bash -c ". /tmp/lib.sh; mkdir -p /backups/weekly; weekly_copy \"$pre\"")" || fail "weekly_copy failed: $okout"
echo "$okout" | grep -q "WEEKLY OK" || fail "no WEEKLY OK: $okout"
BK pg_restore --list "/backups/weekly/$(basename "$pre")" >/dev/null || fail "weekly copy not listable"
[ "$(BK sh -c 'ls /backups/weekly | grep -c partial')" = 0 ] || fail "weekly .partial left behind"
badout="$(BK bash -c ". /tmp/lib.sh; BACKUP_ROOT=/nonexistent; weekly_copy \"$pre\"; echo still-running")" || fail "weekly_copy failure killed the shell: $badout"
echo "$badout" | grep -q "BACKUP FAILED: weekly copy" || fail "no BACKUP FAILED for a failing weekly copy: $badout"
echo "$badout" | grep -q "still-running" || fail "shell did not continue after a failing weekly copy"
echo "weekly copy: OK path atomic, failure logged, loop survives"
echo "== stale .partial files in daily/weekly are removed when the daemon (re)starts; pre-upgrade/ is not touched"
BK sh -c 'mkdir -p /backups/daily /backups/weekly /backups/pre-upgrade; : > /backups/daily/solar-stale.dump.partial; : > /backups/weekly/solar-stale.dump.partial; : > /backups/daily/solar-stale.dump.AbC123.partial; : > /backups/weekly/solar-stale.dump.XyZ789.partial; : > /backups/pre-upgrade/solar-keep.dump.partial'
# /backups is a tmpfs here (a container restart would wipe it), so start a second daemon for a few
# seconds instead: it performs the same start-up cleanup, then is stopped by `timeout` (SIGTERM).
BK timeout 3 /scripts/backup.sh daemon >/dev/null 2>&1 || true
left="$(BK sh -c 'ls /backups/daily /backups/weekly /backups/pre-upgrade')"
echo "$left" | grep -q "solar-stale" && fail "stale daily/weekly .partial survived a daemon restart: $left"
echo "$left" | grep -q "solar-keep.dump.partial" || fail "daemon restart touched pre-upgrade/: $left"
BK sh -c 'rm -f /backups/pre-upgrade/solar-keep.dump.partial'
echo "stale partials cleaned, pre-upgrade untouched"

echo "== daemon's scheduled dump (after the exec runs) succeeds and writes a world-unreadable dump + a group-readable last-success"
[ "$(BK sh -c 'ls /backups/daily | wc -l')" = 0 ] || fail "the daemon already dumped before the exec checks finished (schedule too early)"
for i in $(seq 1 60); do
  BK sh -c 'ls /backups/daily/solar-*.dump' >/dev/null 2>&1 && break; sleep 3
done
daily="$(BK sh -c 'ls /backups/daily/solar-*.dump')" || fail "daemon produced no daily dump by $BACKUP_TIME"
BK pg_restore --list "$daily" >/dev/null || fail "daily dump not listable"
mode="$(BK stat -c '%a' /backups/last-success)"
[ "$mode" = 644 ] || fail "last-success mode $mode, expected 644"
"${C[@]}" exec -T -u 568:568 db-backup cat /backups/last-success | grep -q "^20[0-9][0-9]-" || fail "uid 568 (the backend) cannot read last-success"
dmode="$(BK stat -c '%a' "$daily")"
[ "$dmode" = 600 ] || fail "dump mode $dmode, expected 600"
echo "daily dump listable; last-success 0$mode readable by uid 568; dump 0$dmode"

echo "== no password anywhere: logs, docker inspect"
logs_out="$("${C[@]}" logs --no-color 2>&1)" || fail "cannot read container logs"
[ -n "$logs_out" ] || fail "container logs were empty"
if grep -qF "$pw" <<<"$logs_out"; then fail "password in container logs"; fi
for s in db db-backup; do
  cid="$("${C[@]}" ps -q $s)" || fail "cannot resolve the $s container"
  [ -n "$cid" ] || fail "no container id for $s"
  insp="$(docker inspect "$cid")" || fail "cannot inspect $s"
  if grep -qF "$pw" <<<"$insp"; then fail "password in docker inspect of $s"; fi
  if grep -q '"PGPASSWORD=' <<<"$insp"; then fail "PGPASSWORD in docker inspect of $s"; fi
done
echo "V20 PASS"
