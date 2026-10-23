#!/usr/bin/env bash
# Database backups for the house-solar app. Runs inside the postgres image (db-backup service).
#
#   backup.sh daemon                      nightly loop: dump at BACKUP_TIME (default 03:30 local)
#   backup.sh once pre-upgrade <tag>      one dump to /backups/pre-upgrade before an upgrade
#
# Authentication (plan: Deployment, db-backup): every dump creates its OWN private libpq password
# file on tmpfs (/run/pg, mode 0600, never on disk) and removes only that file on exit. The password
# is read from /run/secrets/db_password and written with the printf builtin: it is never in an
# environment variable, argv, `set -x` trace or log line. pg_dump runs with -w, so a missing or
# ignored password file fails instead of prompting. Never add `set -x` or `echo "$pw"` here.
set -euo pipefail
umask 077

DB_HOST=db
DB_PORT=5432
DB_USER=solar
DB_NAME=solar
BACKUP_ROOT=/backups
SECRET_FILE=/run/secrets/db_password
PGPASS_DIR=/run/pg
BACKUP_TIME="${BACKUP_TIME:-03:30}"
KEEP_DAILY=7
KEEP_WEEKLY=4

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Cancellation: SIGTERM/SIGINT forwards to the running dump and waits for its cleanup (partial file
# and password file removed by its EXIT trap) instead of leaving them behind.
dump_pid=
terminate() {
  trap '' TERM INT
  if [ -n "$dump_pid" ]; then kill -TERM "$dump_pid" 2>/dev/null || true; wait "$dump_pid" 2>/dev/null || true; fi
  log "interrupted"
  exit 143
}

# One dump into "$1" (final path ending in .dump), run as a child so that a signal can be forwarded.
run_dump() {
  dump_to "$1" &
  dump_pid=$!
  local rc=0
  wait "$dump_pid" || rc=$?
  dump_pid=
  return "$rc"
}

# The dump itself. run_dump starts it in the background, i.e. in its own subshell, so that the EXIT
# trap removes exactly this invocation's password file, partial dump and last-success temp file; do
# not give this function a second subshell body or a signal would reach only the outer one. Every
# step is checked explicitly: callers use it in an `if`, which disables errexit inside the function,
# so nothing here may rely on `set -e`.
dump_to() {
  final=$1
  # Each variable below is set only once the file/process it names has actually been created, so the
  # traps (installed first, before anything is created) are safe at any point and never remove a
  # file this invocation did not create.
  f=
  partial=
  lst=
  child=
  trap 'for x in "$f" "$partial" "$lst"; do [ -z "$x" ] || rm -f -- "$x"; done' EXIT
  trap 'if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi; exit 143' TERM INT
  [ -d "$PGPASS_DIR" ] || { log "BACKUP FAILED: $PGPASS_DIR (tmpfs) is missing"; exit 1; }
  f=$(mktemp "$PGPASS_DIR/pgpass.XXXXXX") || { log "BACKUP FAILED: cannot create password file"; exit 1; }
  partial=$(mktemp "$final.XXXXXX.partial") || { log "BACKUP FAILED: cannot create partial file for $final"; exit 1; }
  IFS= read -r pw < "$SECRET_FILE" || [ -n "${pw:-}" ] || { log "BACKUP FAILED: empty password secret"; exit 1; }
  pw=${pw//\\/\\\\}
  pw=${pw//:/\\:}
  printf '%s:%s:%s:%s:%s\n' "$DB_HOST" "$DB_PORT" "$DB_NAME" "$DB_USER" "$pw" > "$f" || { log "BACKUP FAILED: cannot write password file"; exit 1; }
  unset pw
  export PGPASSFILE=$f
  pg_dump -w -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc -Z 6 -f "$partial" &
  child=$!
  wait "$child" || { log "BACKUP FAILED: pg_dump"; exit 1; }
  child=
  pg_restore --list "$partial" > /dev/null || { log "BACKUP FAILED: archive not listable"; exit 1; }
  # Publish without clobbering: a hard link fails if $final already exists (another invocation's
  # archive), and -T never treats an existing directory at $final as a link destination.
  ln -T -- "$partial" "$final" || { log "BACKUP FAILED: refusing to overwrite or cannot publish $final"; exit 1; }
  rm -f -- "$partial" && partial=
  # Timestamp for the backend's lastBackupAt, created only after a successful publish. World-readable
  # on purpose (it holds no secret); the backups directory itself (0750, group 568) is what limits
  # who can reach it.
  lst=$(mktemp "$BACKUP_ROOT/last-success.XXXXXX.tmp") || { log "BACKUP FAILED: cannot create last-success temp file"; exit 1; }
  date -u +%Y-%m-%dT%H:%M:%SZ > "$lst" || { log "BACKUP FAILED: cannot write last-success"; exit 1; }
  chmod 0644 "$lst" || { log "BACKUP FAILED: chmod last-success"; exit 1; }
  mv -f -- "$lst" "$BACKUP_ROOT/last-success" || { log "BACKUP FAILED: cannot publish last-success"; exit 1; }
  lst=
  log "BACKUP OK $final"
}

# Keep the newest $2 files matching "$1"/solar-*.dump (names sort chronologically).
prune() {
  local dir=$1 keep=$2 f
  local -a files=()
  shopt -s nullglob
  files=("$dir"/solar-*.dump)
  shopt -u nullglob
  [ "${#files[@]}" -gt "$keep" ] || return 0
  while IFS= read -r f; do rm -f -- "$f"; done < <(printf '%s\n' "${files[@]}" | sort -r | tail -n +"$((keep + 1))")
}

# Sunday copy. Never leaves a truncated .dump behind: copy to a temp name, check the archive is
# listable, then rename. A failure here is logged and must not stop the daemon loop (errexit would).
weekly_copy() {
  local src=$1 dst tmp
  dst="$BACKUP_ROOT/weekly/$(basename -- "$src")"
  tmp="$dst.partial"
  if cp -- "$src" "$tmp" && pg_restore --list "$tmp" > /dev/null && mv -- "$tmp" "$dst"; then
    log "WEEKLY OK $dst"
  else
    rm -f -- "$tmp"
    log "BACKUP FAILED: weekly copy of $src"
  fi
}

seconds_until_next() {
  local now target
  now=$(date +%s)
  target=$(date -d "today $BACKUP_TIME" +%s)
  [ "$target" -gt "$now" ] || target=$(date -d "tomorrow $BACKUP_TIME" +%s)
  echo $((target - now))
}

daemon() {
  mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/pre-upgrade"
  # The daemon is the only writer of daily/ and weekly/: a .partial there is left over from a dump or
  # weekly copy that was killed (container stop past the grace period, power loss). pre-upgrade/ is
  # not touched: a `docker exec` run may be writing there right now.
  rm -f -- "$BACKUP_ROOT"/daily/*.partial "$BACKUP_ROOT"/weekly/*.partial
  log "backup daemon started; next dump at $BACKUP_TIME local"
  while true; do
    sleep "$(seconds_until_next)" &
    wait $! || true
    stamp=$(date +%Y%m%d-%H%M)
    final="$BACKUP_ROOT/daily/solar-$stamp.dump"
    if run_dump "$final"; then
      if [ "$(date +%u)" = 7 ]; then weekly_copy "$final"; fi
      prune "$BACKUP_ROOT/daily" "$KEEP_DAILY"
      prune "$BACKUP_ROOT/weekly" "$KEEP_WEEKLY"
    fi
    sleep 1 # never fire twice in the same minute
  done
}

once_pre_upgrade() {
  local tag=${1:-}
  [[ "$tag" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { log "usage: backup.sh once pre-upgrade <tag> (letters, digits . _ -)"; exit 2; }
  mkdir -p "$BACKUP_ROOT/pre-upgrade"
  run_dump "$BACKUP_ROOT/pre-upgrade/solar-$tag-$(date +%Y%m%d-%H%M%S)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n').dump"
}

trap terminate TERM INT
case "${1:-}" in
  daemon) daemon ;;
  once)
    [ "${2:-}" = pre-upgrade ] || { log "usage: backup.sh once pre-upgrade <tag>"; exit 2; }
    once_pre_upgrade "${3:-}"
    ;;
  *) log "usage: backup.sh daemon | once pre-upgrade <tag>"; exit 2 ;;
esac
