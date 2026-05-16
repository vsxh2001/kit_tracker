#!/usr/bin/env bash
# Verify a restored PocketBase data dir by querying collection counts.
# Usage: bash scripts/verify-restore.sh [--allow-empty] <port>
#
# --allow-empty  Skip minimum-row check; only verify collections exist + are queryable.
#                Use for fresh-DB drills without real data.
#
# Env vars:
#   PB_ADMIN_EMAIL     (default: admin@example.com)
#   PB_ADMIN_PASSWORD  (default: changeme123)
set -euo pipefail

ALLOW_EMPTY=0
PORT=""

for arg in "$@"; do
  if [ "$arg" = "--allow-empty" ]; then
    ALLOW_EMPTY=1
  else
    PORT="$arg"
  fi
done

PORT="${PORT:-48190}"
PB_URL="http://127.0.0.1:$PORT"
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-admin@example.com}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-changeme123}"

echo "→ Health check"
if ! curl -sf "$PB_URL/api/health" >/dev/null; then
  echo "  FAIL — PB not responding on port $PORT"
  exit 1
fi
echo "  OK"

echo "→ Superuser auth"
TOKEN=$(curl -sf -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$PB_ADMIN_EMAIL\",\"password\":\"$PB_ADMIN_PASSWORD\"}" \
  2>/dev/null | jq -r '.token // empty')
if [ -z "$TOKEN" ]; then
  # Fallback for older PB v0.21 endpoint
  TOKEN=$(curl -sf -X POST "$PB_URL/api/admins/auth-with-password" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$PB_ADMIN_EMAIL\",\"password\":\"$PB_ADMIN_PASSWORD\"}" \
    2>/dev/null | jq -r '.token // empty')
fi
if [ -z "$TOKEN" ]; then
  echo "  FAIL — superuser auth failed; cannot verify"
  exit 1
fi
echo "  OK"

echo "→ Collection counts"
declare -A expected_min=(
  [users]=1
  [entities]=1
  [kits]=1
  [products]=0
  [components]=0
  [transactions]=1
  [component_transactions]=0
  [requests]=0
  [audit_log]=1
)

FAIL=0
for col in users entities kits products components transactions component_transactions requests audit_log; do
  COUNT=$(curl -sf \
    -H "Authorization: $TOKEN" \
    "$PB_URL/api/collections/$col/records?perPage=1" \
    2>/dev/null | jq -r '.totalItems // empty')
  if [ -z "$COUNT" ]; then
    echo "  FAIL $col — query failed (collection missing or auth rejected)"
    FAIL=$((FAIL+1))
    continue
  fi
  EXPECTED=${expected_min[$col]:-0}
  if [ "$ALLOW_EMPTY" = "1" ]; then
    echo "  OK   $col rows=$COUNT (--allow-empty: threshold skipped)"
  elif [ "$COUNT" -ge "$EXPECTED" ]; then
    echo "  OK   $col rows=$COUNT (>= $EXPECTED)"
  else
    echo "  FAIL $col rows=$COUNT (< $EXPECTED expected)"
    FAIL=$((FAIL+1))
  fi
done

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "✗ $FAIL collections failed check"
  exit 1
fi
if [ "$ALLOW_EMPTY" = "1" ]; then
  echo "✓ All collections queryable (--allow-empty mode; row thresholds skipped)"
else
  echo "✓ All collections meet minimum row expectations"
fi
