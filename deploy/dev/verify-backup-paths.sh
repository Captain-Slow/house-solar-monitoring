#!/usr/bin/env bash
# Synthetic check of the REAL deploy/truenas/backup.sh archive-path isolation (no Docker, no database):
#  - repeated and overlapping same-tag pre-upgrade runs each publish their own archive;
#  - publication never overwrites an existing archive, even on a forced name collision, and exactly one of
#    N runs that reach publication of the SAME final path at the same moment wins;
#  - a failing invocation removes only its own .partial, never another invocation's; last-success is untouched by failures;
#  - a foreign last-success.*.tmp survives failed, refused and successful runs (only a file the run created is removed);
#  - an existing directory at the final path is refused, nothing is linked into it;
#  - SIGTERM before the partial exists still removes the password file (the traps are installed first);
#  - prune keeps in-flight *.dump.XXXXXX.partial files and removes only the oldest solar-*.dump.
# pg_dump/pg_restore/mktemp are stubs; the script's own functions and ordering are used unmodified.
set -euo pipefail
cd "$(dirname "$0")"
W="$(mktemp -d "${TMPDIR:-/tmp}/backup-paths.XXXXXX")"
trap 'rm -rf -- "$W"' EXIT
fail() { echo "BACKUP-PATHS FAIL: $*" >&2; exit 1; }

mkdir -p "$W/bin" "$W/backups/pre-upgrade" "$W/run-pg"
printf 'secret' > "$W/secret"
# Stub pg_dump: writes "$STUB_CONTENT" to the -f target. Optional knobs (env):
#   STUB_DUMP_FAIL=1       fail after the optional foreign-file step
#   STUB_FOREIGN_DIR=<d>   first plant a "foreign" <d>/last-success.<pid of the dump subshell>.tmp, the exact
#                          name an old per-invocation temp file would have had
#   STUB_BARRIER=<d>       after writing, announce <d>/ready.<pid> and wait for <d>/go (N runs publish together)
#   STUB_PGPASS_LOG=<f>    record the password file's mode and content
cat > "$W/bin/pg_dump" <<'STUB'
#!/bin/bash
out=""; while [ $# -gt 0 ]; do [ "$1" = -f ] && { out=$2; shift; }; shift; done
[ -z "${STUB_FOREIGN_DIR:-}" ] || printf 'foreign\n' > "$STUB_FOREIGN_DIR/last-success.$PPID.tmp"
[ -z "${STUB_DUMP_FAIL:-}" ] || exit 1
[ -z "${STUB_PGPASS_LOG:-}" ] || { stat -c %a "$PGPASSFILE"; cat "$PGPASSFILE"; } > "$STUB_PGPASS_LOG"
printf '%s\n' "${STUB_CONTENT:-x}" > "$out"
if [ -n "${STUB_BARRIER:-}" ]; then
  : > "$STUB_BARRIER/ready.$$"
  n=0; while [ ! -e "$STUB_BARRIER/go" ] && [ "$n" -lt 400 ]; do sleep 0.05; n=$((n + 1)); done
  [ -e "$STUB_BARRIER/go" ] || exit 1
fi
sleep "${STUB_DUMP_SLEEP:-0}"
STUB
cat > "$W/bin/pg_restore" <<'STUB'
#!/bin/bash
[ "$1" = --list ] && [ -s "$2" ]
STUB
# Stub mktemp delegating to the real one. Optional knobs (env):
#   STUB_MKTEMP_LOG=<f>    append one line per last-success template, saying whether $STUB_FINAL exists yet
#   STUB_MKTEMP_HOLD=<d>   for a *.partial template: create the file, then wait for <d>/go before printing its
#                          name, i.e. a signal can arrive after creation but before the caller assigned it
cat > "$W/bin/mktemp" <<'STUB'
#!/bin/bash
case "${STUB_MKTEMP_LOG:-}:$1" in
  ?*:*/last-success.*.tmp) printf 'last-success final-%s\n' "$([ -e "$STUB_FINAL" ] && echo present || echo absent)" >> "$STUB_MKTEMP_LOG" ;;
esac
[ -z "${STUB_MKTEMP_FAIL_LAST:-}" ] || case "$1" in */last-success.*.tmp) exit 1 ;; esac
made=$("$REAL_MKTEMP" "$@") || exit
case "${STUB_MKTEMP_HOLD:-}:$1" in
  ?*:*.partial) n=0; while [ ! -e "$STUB_MKTEMP_HOLD/go" ] && [ "$n" -lt 400 ]; do sleep 0.05; n=$((n + 1)); done ;;
esac
printf '%s\n' "$made"
STUB
# Stub chmod / mv: real tools unless a knob asks them to fail the last-success step.
cat > "$W/bin/chmod" <<'STUB'
#!/bin/bash
[ -z "${STUB_CHMOD_FAIL:-}" ] || exit 1
exec "$REAL_CHMOD" "$@"
STUB
cat > "$W/bin/mv" <<'STUB'
#!/bin/bash
if [ -n "${STUB_MV_FAIL:-}" ]; then for last; do :; done; case "$last" in */last-success) exit 1 ;; esac; fi
exec "$REAL_MV" "$@"
STUB
chmod +x "$W/bin/pg_dump" "$W/bin/pg_restore" "$W/bin/mktemp" "$W/bin/chmod" "$W/bin/mv"
REAL_MKTEMP="$(command -v mktemp)"; REAL_CHMOD="$(command -v chmod)"; REAL_MV="$(command -v mv)"
export REAL_MKTEMP REAL_CHMOD REAL_MV
sed '/^trap terminate TERM INT/,$d' ../truenas/backup.sh > "$W/lib.sh"
# lib <content> <command> [VAR=value...]: runs the REAL functions with sandbox paths and stub binaries
lib() {
  local content=$1 cmd=$2; shift 2
  env STUB_CONTENT="$content" PATH="$W/bin:$PATH" "$@" bash -c ". '$W/lib.sh'; BACKUP_ROOT='$W/backups'; SECRET_FILE='$W/secret'; PGPASS_DIR='$W/run-pg'; trap terminate TERM INT; $cmd"
}
dir="$W/backups/pre-upgrade"

echo "== repeated same-tag runs keep every archive"
lib one "once_pre_upgrade t1" >/dev/null || fail "first run failed"
lib two "once_pre_upgrade t1" >/dev/null || fail "second run failed"
[ "$(ls "$dir"/solar-t1-*.dump | wc -l)" = 2 ] || fail "expected 2 archives: $(ls "$dir")"
grep -lx one "$dir"/solar-t1-*.dump >/dev/null || fail "first archive content overwritten"
grep -lx two "$dir"/solar-t1-*.dump >/dev/null || fail "second archive missing"

echo "== overlapping same-tag runs"
for n in a b c d; do
  ( lib "c-$n" "once_pre_upgrade t2" STUB_DUMP_SLEEP=1 >/dev/null ) &
done
wait
[ "$(ls "$dir"/solar-t2-*.dump | wc -l)" = 4 ] || fail "overlapping runs lost archives: $(ls "$dir")"
for n in a b c d; do grep -lx "c-$n" "$dir"/solar-t2-*.dump >/dev/null || fail "archive c-$n missing"; done
[ -z "$(ls "$dir"/*.partial 2>/dev/null)" ] || fail "partial left behind"

printf "2026-01-01T00:00:00Z\n" > "$W/backups/last-success"
SUCCESS_BEFORE="$(cat "$W/backups/last-success")"
echo "== forced name collision is refused and the existing archive and a foreign partial survive"
printf 'keep\n' > "$dir/solar-fixed.dump"
printf 'foreign\n' > "$dir/solar-fixed.dump.ZZZZZZ.partial"
if lib new "run_dump '$dir/solar-fixed.dump'" >/dev/null 2>&1; then fail "collision was accepted"; fi
[ "$(cat "$dir/solar-fixed.dump")" = keep ] || fail "existing archive overwritten"
[ "$(cat "$dir/solar-fixed.dump.ZZZZZZ.partial")" = foreign ] || fail "another invocation's partial was removed"
ls "$dir"/solar-fixed.dump.*.partial | grep -vq ZZZZZZ && fail "own partial left after refusal"

echo "== a failing dump removes only its own partial"
rm -f "$dir"/solar-fixed.dump
if lib x "run_dump '$dir/solar-fixed.dump'" STUB_DUMP_FAIL=1 >/dev/null 2>&1; then fail "failing dump reported success"; fi
[ "$(cat "$dir/solar-fixed.dump.ZZZZZZ.partial")" = foreign ] || fail "foreign partial removed by a failing run"
[ "$(ls "$dir"/solar-fixed.dump.*.partial | wc -l)" = 1 ] || fail "own partial not removed"
[ "$(cat "$W/backups/last-success")" = "$SUCCESS_BEFORE" ] || fail "last-success changed by a refused or failed run"

echo "== concurrent same-name publish: N runs reach publication of the SAME final path together, exactly one wins"
race="$dir/solar-race.dump"
barrier="$W/barrier"
mkdir -p "$barrier"
N=4
ready_count() { local f n=0; for f in "$barrier"/ready.*; do [ -e "$f" ] && n=$((n + 1)); done; echo "$n"; }
for n in $(seq 1 "$N"); do
  ( rc=0; lib "race-$n" "run_dump '$race'" STUB_BARRIER="$barrier" >"$W/race.$n.out" 2>&1 || rc=$?; echo "$rc" > "$W/race.$n.rc" ) &
done
for i in $(seq 1 200); do [ "$(ready_count)" = "$N" ] && break; sleep 0.1; done
: > "$barrier/go"   # also released after a missed barrier, so no stub is left waiting
wait
[ "$(ready_count)" = "$N" ] || fail "only $(ready_count) of $N runs reached the barrier"
wins=0; winner=""
for n in $(seq 1 "$N"); do
  [ -s "$W/race.$n.rc" ] || fail "race run $n did not finish"
  if [ "$(cat "$W/race.$n.rc")" = 0 ]; then wins=$((wins + 1)); winner=$n; fi
done
[ "$wins" = 1 ] || fail "expected exactly one of $N same-name runs to publish, $wins did"
[ "$(cat "$race")" = "race-$winner" ] || fail "archive is not exactly the winning run's content: $(cat "$race")"
[ "$(cat "$W"/race.*.out | grep -c 'BACKUP OK')" = 1 ] || fail "expected exactly one BACKUP OK"
[ "$(cat "$W"/race.*.out | grep -c 'refusing to overwrite')" = "$((N - 1))" ] || fail "the $((N - 1)) losers did not all refuse to overwrite"
[ "$(ls "$dir" | grep -c '^solar-race\.')" = 1 ] || fail "partial or extra file left by the race: $(ls "$dir" | grep '^solar-race\.')"
[ -z "$(ls "$W/backups" | grep '^last-success\..*\.tmp$')" ] || fail "last-success temp file left by the race"

echo "== a foreign last-success.*.tmp survives failed, refused and successful runs; the temp file exists only after publication"
reset_foreign() { rm -f -- "$W"/backups/last-success.*.tmp; printf 'foreign\n' > "$W/backups/last-success.ZZZZZZ.tmp"; }
# Both foreign files must be untouched: the static one and the one the pg_dump stub plants under the dump subshell's pid.
foreign_intact() {
  local f n=0
  for f in "$W"/backups/last-success.*.tmp; do
    [ -e "$f" ] || continue
    [ "$(cat "$f")" = foreign ] || fail "$1: $f was rewritten or is an own leftover"
    n=$((n + 1))
  done
  [ "$n" = 2 ] || fail "$1: a foreign last-success temp file was removed (found $n of 2)"
}
fe="$dir/solar-foreign.dump"
mlog="$W/mktemp.log"
foreign_env=(STUB_FOREIGN_DIR="$W/backups" STUB_MKTEMP_LOG="$mlog" STUB_FINAL="$fe")
reset_foreign; : > "$mlog"
if lib x "run_dump '$fe'" STUB_DUMP_FAIL=1 "${foreign_env[@]}" >/dev/null 2>&1; then fail "failing dump reported success"; fi
foreign_intact "failed run"
[ ! -s "$mlog" ] || fail "a failed run created a last-success temp file: $(cat "$mlog")"
printf 'keep\n' > "$fe"
reset_foreign; : > "$mlog"
if lib x "run_dump '$fe'" "${foreign_env[@]}" >/dev/null 2>&1; then fail "collision was accepted"; fi
foreign_intact "refused run"
[ "$(cat "$fe")" = keep ] || fail "existing archive overwritten by the refused run"
[ ! -s "$mlog" ] || fail "a refused run created a last-success temp file: $(cat "$mlog")"
rm -f -- "$fe"
reset_foreign; : > "$mlog"
printf '2026-01-01T00:00:00Z\n' > "$W/backups/last-success"
lib ok "run_dump '$fe'" "${foreign_env[@]}" >/dev/null 2>&1 || fail "successful run failed"
foreign_intact "successful run"
[ "$(cat "$mlog")" = "last-success final-present" ] || fail "last-success temp file not created exactly once, after the archive was published: $(cat "$mlog")"
[ "$(cat "$fe")" = ok ] || fail "archive content wrong after the successful run"
grep -q '^20[0-9][0-9]-' "$W/backups/last-success" && [ "$(cat "$W/backups/last-success")" != 2026-01-01T00:00:00Z ] || fail "last-success not refreshed by the successful run"
[ "$(stat -c %a "$W/backups/last-success")" = 644 ] || fail "last-success mode $(stat -c %a "$W/backups/last-success"), expected 644"
rm -f -- "$W"/backups/last-success.*.tmp

echo "== an existing directory at the final path is refused (ln -T); nothing is linked into it"
mkdir "$dir/solar-isdir.dump"
if lib x "run_dump '$dir/solar-isdir.dump'" >/dev/null 2>&1; then fail "a directory at the final path was accepted as a publish target"; fi
[ -z "$(ls -A "$dir/solar-isdir.dump")" ] || fail "the archive was linked into the directory: $(ls -A "$dir/solar-isdir.dump")"

echo "== SIGTERM after the partial exists but before it was assigned (traps are installed first): exit 143, nothing left"
hold="$W/hold"
mkdir -p "$hold"
term="$dir/solar-term.dump"
( rc=0; lib x "echo \$\$ > '$W/term.pid'; run_dump '$term'" STUB_MKTEMP_HOLD="$hold" >"$W/term.out" 2>&1 || rc=$?; echo "$rc" > "$W/term.rc" ) &
for i in $(seq 1 100); do compgen -G "$term.*.partial" >/dev/null && break; sleep 0.1; done
if ! compgen -G "$term.*.partial" >/dev/null; then : > "$hold/go"; wait; fail "the partial file was never created"; fi
kill -TERM "$(cat "$W/term.pid")"
sleep 0.5
: > "$hold/go"
wait
[ "$(cat "$W/term.rc")" = 143 ] || fail "exit code after SIGTERM: $(cat "$W/term.rc")"
[ -z "$(ls "$dir" | grep '^solar-term')" ] || fail "files left after SIGTERM: $(ls "$dir" | grep '^solar-term')"
[ -z "$(ls -A "$W/run-pg")" ] || fail "password file left after SIGTERM: $(ls -A "$W/run-pg")"

echo "== the password file is private (0600), holds the escaped password and is gone afterwards"
printf 'p:w\\d' > "$W/secret2"
lib pw "SECRET_FILE='$W/secret2'; run_dump '$dir/solar-pw.dump'" STUB_PGPASS_LOG="$W/pgpass.log" >/dev/null 2>&1 || fail "run with the escaped-password secret failed"
[ "$(sed -n 1p "$W/pgpass.log")" = 600 ] || fail "password file mode $(sed -n 1p "$W/pgpass.log"), expected 600"
[ "$(sed -n 2p "$W/pgpass.log")" = 'db:5432:solar:solar:p\:w\\d' ] || fail "password file content: $(sed -n 2p "$W/pgpass.log")"
[ -z "$(ls -A "$W/run-pg")" ] || fail "password file left in run-pg: $(ls -A "$W/run-pg")"

echo "== prune keeps in-flight *.dump.XXXXXX.partial files and removes only the oldest solar-*.dump"
pd="$W/backups/daily"
mkdir -p "$pd"
for d in 20260101 20260102 20260103; do printf '%s\n' "$d" > "$pd/solar-$d-0330.dump"; done
: > "$pd/solar-20260101-0330.dump.AbC123.partial"   # sorts before every archive
: > "$pd/solar-20260104-0330.dump.XyZ789.partial"   # sorts after every archive
printf 'note\n' > "$pd/README"
lib x "prune '$pd' 2" >/dev/null || fail "prune failed"
[ ! -e "$pd/solar-20260101-0330.dump" ] || fail "prune kept the oldest archive"
[ -e "$pd/solar-20260102-0330.dump" ] && [ -e "$pd/solar-20260103-0330.dump" ] || fail "prune removed a newer archive"
[ -e "$pd/solar-20260101-0330.dump.AbC123.partial" ] || fail "prune removed an in-flight partial that sorts before the archives"
[ -e "$pd/solar-20260104-0330.dump.XyZ789.partial" ] || fail "prune removed an in-flight partial that sorts after the archives"
[ -e "$pd/README" ] || fail "prune removed a non-archive file"
lib x "prune '$pd' 2" >/dev/null || fail "second prune failed"
[ "$(ls "$pd" | wc -l)" = 5 ] || fail "prune below the keep count removed something: $(ls "$pd")"

echo "== injected last-success failures: the run fails, the published archive stays valid, last-success is untouched, only this run's temp file is removed"
for knob in STUB_MKTEMP_FAIL_LAST STUB_CHMOD_FAIL STUB_MV_FAIL; do
  printf '2026-01-01T00:00:00Z\n' > "$W/backups/last-success"
  printf 'foreign\n' > "$W/backups/last-success.FOREIGN.tmp"
  if lib x "once_pre_upgrade ls-$knob" "$knob=1" > "$W/ls.out" 2>&1; then fail "$knob: the run reported success"; fi
  grep -q 'BACKUP FAILED' "$W/ls.out" || fail "$knob: no BACKUP FAILED logged: $(cat "$W/ls.out")"
  [ "$(ls "$dir"/solar-ls-"$knob"-*.dump 2>/dev/null | wc -l)" = 1 ] || fail "$knob: the published archive is missing"
  [ "$(cat "$W/backups/last-success")" = '2026-01-01T00:00:00Z' ] || fail "$knob: last-success changed"
  [ "$(ls "$W/backups"/last-success.*.tmp | wc -l)" = 1 ] || fail "$knob: temp files: $(ls "$W/backups")"
  [ -e "$W/backups/last-success.FOREIGN.tmp" ] || fail "$knob: a foreign temp file was removed"
  [ -z "$(ls "$dir"/solar-ls-"$knob"-*.partial 2>/dev/null)" ] || fail "$knob: partial left"
  rm -f "$W/backups/last-success.FOREIGN.tmp"
done
echo "BACKUP-PATHS PASS"
