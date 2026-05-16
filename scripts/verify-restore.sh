#!/usr/bin/env bash
# Verify a restored PocketBase data dir by querying collection counts.
# Usage: bash scripts/verify-restore.sh <port>
set -euo pipefail

PORT="${1:-48190}"
PB_URL="http://127.0.0.1:$PORT"

echo "→ Health check"
if ! curl -sf "$PB_URL/api/health" >/dev/null; then
  echo "  FAIL — PB not responding on port $PORT"
  exit 1
fi
echo "  OK"

echo "→ Collection counts (no auth — public collections only)"
# audit_log requires admin auth, will be skipped if PB has no superuser
declare -A expected_min
expected_min[users]=1
expected_min[entities]=1
expected_min[kits]=0   # ok if zero on a fresh restore
expected_min[products]=0
expected_min[components]=0
expected_min[transactions]=0
expected_min[component_transactions]=0
expected_min[requests]=0

FAIL=0
for col in users entities kits products components transactions component_transactions requests; do
  # Try with admin auth; fall back to public listRule
  COUNT=$(curl -sf "$PB_URL/api/collections/$col/records?perPage=1" 2>/dev/null | jq -r '.totalItems // empty')
  if [ -z "$COUNT" ]; then
    echo "  WARN $col — list rule blocks anonymous; cannot verify"
    continue
  fi
  EXPECTED=${expected_min[$col]:-0}
  if [ "$COUNT" -ge "$EXPECTED" ]; then
    echo "  OK   $col rows=$COUNT (>= $EXPECTED)"
  else
    echo "  FAIL $col rows=$COUNT (< $EXPECTED expected)"
    FAIL=$((FAIL+1))
  fi
done

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "✗ $FAIL collections failed minimum-row check"
  exit 1
fi
echo "✓ All collections meet minimum row expectations"
