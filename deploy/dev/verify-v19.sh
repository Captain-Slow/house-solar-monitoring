#!/usr/bin/env bash
# V19 (plan): built image + internal network only + db_password secret (+ / = in the password).
#  1. correct secret: migrate applies all migrations and exits 0, backend starts, /readyz is 200.
#  2. wrong secret:   migrate exits non-zero and backend never starts.
# Needs Docker and the image house-solar-backend:dev. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .secrets
P=(docker compose -p v19 -f compose.v19.yaml)
cleanup() { "${P[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf .secrets; }
trap cleanup EXIT
fail() { echo "V19 FAIL: $*" >&2; "${P[@]}" logs --no-color 2>&1 | tail -40 >&2; exit 1; }

# 32 random bytes as base64: contains + / = with high probability; force at least one of each.
pw="$(openssl rand -base64 24)+/=x"
printf '%s' "$pw" > .secrets/db_password
printf '%s\n' "$pw" > .secrets/app_password   # trailing newline must be stripped by buildDatabaseUrl

echo "== 1. correct password"
"${P[@]}" up -d backend >/dev/null 2>&1 || fail "stack did not start"
for i in $(seq 1 60); do
  s="$("${P[@]}" ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | tr '\n' ';')"
  case "$s" in *"migrate exited 0"*) break;; esac
  sleep 2
done
case "$s" in *"migrate exited 0"*) echo "migrate exited 0";; *) fail "migrate did not exit 0: $s";; esac
"${P[@]}" logs --no-color migrate | grep -q "have been successfully applied" || fail "no applied message"
for i in $(seq 1 60); do
  h="$("${P[@]}" ps --format '{{.Service}} {{.Health}}' | grep '^backend ' || true)"
  case "$h" in *healthy*) break;; esac
  sleep 2
done
case "$h" in *healthy*) echo "backend healthy";; *) fail "backend not healthy: $h";; esac
"${P[@]}" exec -T backend node -e "
const https=require('https');
https.get({host:'127.0.0.1',port:8443,path:'/readyz',rejectUnauthorized:false},r=>{console.log('readyz',r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',e=>{console.error(e.message);process.exit(1)})" || fail "readyz not 200"
if "${P[@]}" logs --no-color 2>&1 | grep -qF "$pw"; then fail "password leaked into logs"; fi

echo "== 2. wrong password"
"${P[@]}" down -v --remove-orphans >/dev/null 2>&1
printf '%s' "$pw" > .secrets/db_password
printf '%s' "not-the-password" > .secrets/app_password
"${P[@]}" up -d backend >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  s="$("${P[@]}" ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | tr '\n' ';')"
  case "$s" in *"migrate exited "[1-9]*) break;; esac
  sleep 2
done
case "$s" in *"migrate exited "[1-9]*) echo "migrate failed as required";; *) fail "migrate did not fail: $s";; esac
sleep 3
b="$("${P[@]}" ps -a --format '{{.Service}} {{.State}}' | grep '^backend ' || true)"
case "$b" in *running*) fail "backend started despite failed migrate";; *) echo "backend never started ($b)";; esac
echo "V19 PASS"
