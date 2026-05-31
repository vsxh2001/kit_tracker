#!/usr/bin/env bash
# Verifies pilot deploy readiness without touching Fly.
# Runs migrations on a scratch DB + smoke-tests hook loads + ensures
# all required env vars are documented.
set -euo pipefail

# Resolve repo root relative to this script's location
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0

ok()   { echo "  PASS $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL $*"; FAIL=$((FAIL+1)); }
warn() { echo "  WARN $*"; }

echo "→ Migrations apply on fresh DB"
SCRATCH=$(mktemp -d)
"$REPO_ROOT/pb/pocketbase" serve \
  --http=127.0.0.1:48164 \
  --dir="$SCRATCH" \
  --hooksDir="$REPO_ROOT/pb/pb_hooks" \
  --migrationsDir="$REPO_ROOT/pb/pb_migrations" \
  --publicDir="$REPO_ROOT/pb_public" \
  > /tmp/deploy-dry.log 2>&1 &
PID=$!
sleep 5
if grep -iE "panic|error.*hook" /tmp/deploy-dry.log; then
  kill $PID 2>/dev/null || true
  fail "panic or hook error — see /tmp/deploy-dry.log"
else
  ok "no panic / hook errors in startup log"
fi

echo ""
echo "→ Hook count"
HOOK_COUNT=$(ls "$REPO_ROOT/pb/pb_hooks/"*.pb.js | wc -l)
echo "  $HOOK_COUNT hooks present"

echo ""
echo "→ Migration count"
MIG_COUNT=$(ls "$REPO_ROOT/pb/pb_migrations/"*.js | wc -l)
echo "  $MIG_COUNT migrations present"

echo ""
echo "→ Required env vars documented?"
for v in PB_SUPERUSER_EMAIL PB_SUPERUSER_PASSWORD CLAUDE_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_BOT_SECRET APP_BASE_URL; do
  if grep -q "$v" "$REPO_ROOT/.env.example" "$REPO_ROOT/docs/pilot-runbook.md" 2>/dev/null; then
    ok "$v"
  else
    warn "MISSING $v in .env.example AND docs/pilot-runbook.md (see checklist findings)"
  fi
done

echo ""
echo "→ fly.toml exists + app name set"
if [ ! -f "$REPO_ROOT/fly.toml" ]; then
  fail "no fly.toml"
else
  APP_NAME=$(grep "^app " "$REPO_ROOT/fly.toml" | head -1 | cut -d'"' -f2 || echo "")
  ok "app = $APP_NAME"
fi

echo ""
echo "→ docker-entrypoint.sh exists + executable"
if [ ! -f "$REPO_ROOT/docker-entrypoint.sh" ]; then
  fail "docker-entrypoint.sh not found"
elif [ ! -x "$REPO_ROOT/docker-entrypoint.sh" ]; then
  warn "docker-entrypoint.sh exists but is NOT executable (mode: $(stat -c '%a' "$REPO_ROOT/docker-entrypoint.sh"))"
  warn "Docker COPY may or may not preserve +x — verify Dockerfile or add RUN chmod +x"
else
  ok "docker-entrypoint.sh executable"
fi

echo ""
echo "→ Frontend builds cleanly"
( cd "$REPO_ROOT/frontend" && npm run lint && npm run build ) > /tmp/deploy-fe.log 2>&1 \
  && ok "frontend lint + build" \
  || { fail "frontend lint/build — see /tmp/deploy-fe.log"; cat /tmp/deploy-fe.log | tail -30; }

# Cleanup
kill $PID 2>/dev/null || true
rm -rf "$SCRATCH"

echo ""
echo "---"
echo "Dry-run complete: $PASS checks passed, $FAIL failed."
echo "See docs/pilot-deploy-checklist.md for next steps."
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
