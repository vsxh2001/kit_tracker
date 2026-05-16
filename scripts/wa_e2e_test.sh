#!/usr/bin/env bash
#
# Manual end-to-end test of WhatsApp Phase B confirm flow against local PB.
#
# Usage:
#   PB_URL=http://127.0.0.1:8090 \
#   PB_ADMIN_EMAIL=admin@example.com \
#   PB_ADMIN_PASSWORD=changeme123 \
#   TECH_PHONE=+972501234567 \
#   TWILIO_ACCOUNT_SID=ACxxxx \
#   WA_SKIP_SIGNATURE_CHECK=1 \
#   bash scripts/wa_e2e_test.sh
#
# Prereqs:
#   - PocketBase running at $PB_URL WITH WA_SKIP_SIGNATURE_CHECK=1 in its environment
#   - Demo seed loaded: node scripts/seed_demo_data.mjs
#   - $TECH_PHONE linked to a user with role admin or technician
#   - WA_SKIP_SIGNATURE_CHECK=1 exported to the script (triggers pre-flight probe)
#
# Env vars:
#   PB_URL                  PocketBase base URL (default: http://127.0.0.1:8090)
#   PB_ADMIN_EMAIL          Superuser email (required)
#   PB_ADMIN_PASSWORD       Superuser password (required)
#   TECH_PHONE              Tech's WhatsApp phone number (default: +972501234567)
#   TWILIO_ACCOUNT_SID      Any non-empty value works with WA_SKIP_SIGNATURE_CHECK=1 (required)
#   WA_SKIP_SIGNATURE_CHECK Must be "1" for local dev (required, must equal 1)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PB_URL="${PB_URL:-http://127.0.0.1:8090}"
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:?ERROR: PB_ADMIN_EMAIL is required}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:?ERROR: PB_ADMIN_PASSWORD is required}"
TECH_PHONE="${TECH_PHONE:-+972501234567}"
TWILIO_ACCOUNT_SID="${TWILIO_ACCOUNT_SID:?ERROR: TWILIO_ACCOUNT_SID is required}"
WA_SKIP_SIGNATURE_CHECK="${WA_SKIP_SIGNATURE_CHECK:-}"

# Validate WA_SKIP_SIGNATURE_CHECK explicitly
if [[ "${WA_SKIP_SIGNATURE_CHECK}" != "1" ]]; then
  echo "ERROR: WA_SKIP_SIGNATURE_CHECK must be set to '1' for local testing"
  echo "  Without it the webhook will reject the POST with 401 (HMAC mismatch)."
  echo "  Re-run with: WA_SKIP_SIGNATURE_CHECK=1 bash scripts/wa_e2e_test.sh"
  exit 1
fi
export WA_SKIP_SIGNATURE_CHECK

# ---------------------------------------------------------------------------
# Pre-flight: tool requirements
# ---------------------------------------------------------------------------
command -v jq >/dev/null || { echo "ERROR: jq is required"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 is required for safe URL encoding"; exit 1; }

# Unique MessageSid prefix per run (epoch + random)
RUN_ID="$(date +%s)-${RANDOM}"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[$(date +%T)] $*"; }

pass() {
  local label="$1"
  log "[PASS] ${label}"
  RESULTS+=("PASS: ${label}")
  (( PASS_COUNT++ )) || true
}

fail() {
  local label="$1"
  local reason="${2:-}"
  log "[FAIL] ${label}${reason:+ — ${reason}}"
  RESULTS+=("FAIL: ${label}${reason:+ — ${reason}}")
  (( FAIL_COUNT++ )) || true
}

# URL-encode a string using python3.
url_encode() {
  python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

# POST a Twilio-shaped webhook payload.
# Args: <MessageSid> <From> <Body>
# Prints HTTP response body.
send_wa() {
  local sid="$1"
  local from_phone="$2"
  local body="$3"
  curl -s -X POST "${PB_URL}/api/wa/webhook" \
    -H "WA_SKIP_SIGNATURE_CHECK: 1" \
    --data-urlencode "MessageSid=${sid}" \
    --data-urlencode "AccountSid=${TWILIO_ACCOUNT_SID}" \
    --data-urlencode "From=whatsapp:${from_phone}" \
    --data-urlencode "To=whatsapp:+14155238886" \
    --data-urlencode "Body=${body}" \
    --data-urlencode "NumMedia=0" \
    --data-urlencode "SmsStatus=received"
}

# Count transactions matching kit serial and to_entity name, created after $1 (unix epoch ms).
# Args: <after_epoch_ms> <kit_serial> <entity_name>
# Prints the count as integer.
count_transactions_after() {
  local after_ms="$1"
  local kit_serial="$2"
  local entity_name="$3"
  # Convert epoch ms → ISO timestamp for PB filter (PB uses YYYY-MM-DD HH:MM:SS format)
  local after_iso
  after_iso="$(date -d "@$(( after_ms / 1000 ))" "+%Y-%m-%d %H:%M:%S" 2>/dev/null \
    || date -r "$(( after_ms / 1000 ))" "+%Y-%m-%d %H:%M:%S")"

  local filter="kit.serial='${kit_serial}' && to_entity.name='${entity_name}' && created>='${after_iso}'"
  local encoded_filter
  encoded_filter="$(url_encode "${filter}")"

  local resp
  resp="$(curl -s \
    -H "Authorization: ${ADMIN_TOKEN}" \
    "${PB_URL}/api/collections/transactions/records?filter=${encoded_filter}&sort=-timestamp&perPage=1&expand=kit,to_entity")"

  echo "${resp}" | jq -r '.totalItems // 0'
}

# ---------------------------------------------------------------------------
# Pre-flight: PocketBase health check
# ---------------------------------------------------------------------------
log "Pre-flight: checking PocketBase health at ${PB_URL} ..."
health_resp="$(curl -sf "${PB_URL}/api/health" 2>&1)" || {
  echo "ERROR: PocketBase is not responding at ${PB_URL}/api/health"
  echo "  Start it with: bash pb/start-pb.sh"
  exit 1
}
log "PocketBase up: ${health_resp}"

# ---------------------------------------------------------------------------
# Pre-flight: Admin auth — get token
# ---------------------------------------------------------------------------
log "Pre-flight: authenticating as admin ..."
auth_resp="$(curl -s -X POST "${PB_URL}/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"${PB_ADMIN_EMAIL}\",\"password\":\"${PB_ADMIN_PASSWORD}\"}")"

ADMIN_TOKEN="$(echo "${auth_resp}" | jq -r '.token // empty')"

if [[ -z "${ADMIN_TOKEN}" ]]; then
  # Try newer PB endpoint
  auth_resp="$(curl -s -X POST "${PB_URL}/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "{\"identity\":\"${PB_ADMIN_EMAIL}\",\"password\":\"${PB_ADMIN_PASSWORD}\"}")"
  ADMIN_TOKEN="$(echo "${auth_resp}" | jq -r '.token // empty')"
fi

if [[ -z "${ADMIN_TOKEN}" ]]; then
  echo "ERROR: Admin auth failed. Check PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD."
  echo "  Response: ${auth_resp}"
  exit 1
fi
log "Admin auth OK (token length: ${#ADMIN_TOKEN})"

# ---------------------------------------------------------------------------
# Pre-flight: Verify tech user exists with correct phone and role
# ---------------------------------------------------------------------------
log "Pre-flight: looking up tech user with phone=${TECH_PHONE} ..."
phone_encoded="$(url_encode "${TECH_PHONE}")"

user_resp="$(curl -s \
  -H "Authorization: ${ADMIN_TOKEN}" \
  "${PB_URL}/api/collections/users/records?filter=phone%3D%27${phone_encoded}%27&perPage=1")"

user_total="$(echo "${user_resp}" | jq -r '.totalItems // 0')"
if [[ "${user_total}" -eq 0 ]]; then
  echo "ERROR: No user found with phone='${TECH_PHONE}'."
  echo "  Set the tech user's phone via the Users page in the app, or:"
  echo "  curl -X PATCH ${PB_URL}/api/collections/users/records/<USER_ID> \\"
  echo "    -H 'Authorization: <admin-token>' \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"phone\":\"${TECH_PHONE}\"}'"
  exit 1
fi

user_role="$(echo "${user_resp}" | jq -r '.items[0].role // empty')"
if [[ "${user_role}" != "admin" && "${user_role}" != "technician" ]]; then
  echo "ERROR: User with phone='${TECH_PHONE}' has role='${user_role}'."
  echo "  Must be 'admin' or 'technician' to use WhatsApp bot."
  echo "  Update via: curl -X PATCH ${PB_URL}/api/collections/users/records/<USER_ID> \\"
  echo "    -H 'Authorization: <admin-token>' \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"role\":\"technician\"}'"
  exit 1
fi
log "Tech user found (role=${user_role})"

# ---------------------------------------------------------------------------
# Pre-flight: Verify demo entities and kits exist
# ---------------------------------------------------------------------------
log "Pre-flight: verifying demo fixtures ..."
MISSING_FIXTURES=()

check_entity() {
  local name="$1"
  local name_enc
  name_enc="$(url_encode "${name}")"
  local resp total
  resp="$(curl -s \
    -H "Authorization: ${ADMIN_TOKEN}" \
    "${PB_URL}/api/collections/entities/records?filter=name%3D%27${name_enc}%27%26%26is_active%3Dtrue&perPage=1")"
  total="$(echo "${resp}" | jq -r '.totalItems // 0')"
  if [[ "${total}" -eq 0 ]]; then
    MISSING_FIXTURES+=("entity:${name}")
  fi
}

check_kit() {
  local serial="$1"
  local serial_enc
  serial_enc="$(url_encode "${serial}")"
  local resp total
  resp="$(curl -s \
    -H "Authorization: ${ADMIN_TOKEN}" \
    "${PB_URL}/api/collections/kits/records?filter=serial%3D%27${serial_enc}%27%26%26is_active%3Dtrue&perPage=1")"
  total="$(echo "${resp}" | jq -r '.totalItems // 0')"
  if [[ "${total}" -eq 0 ]]; then
    MISSING_FIXTURES+=("kit:${serial}")
  fi
}

check_entity "DEMO-Customer-Alpha"
check_kit "DEMO-KIT-003"
check_kit "DEMO-KIT-005"
check_kit "DEMO-KIT-006"
check_kit "DEMO-KIT-007"

if [[ "${#MISSING_FIXTURES[@]}" -gt 0 ]]; then
  echo "ERROR: Required demo fixtures not found (active):"
  for f in "${MISSING_FIXTURES[@]}"; do
    echo "  - ${f}"
  done
  echo ""
  echo "  Load demo data with:"
  echo "    PB_URL=${PB_URL} PB_SUPERUSER_EMAIL=${PB_ADMIN_EMAIL} PB_SUPERUSER_PASSWORD=<pass> \\"
  echo "    node scripts/seed_demo_data.mjs"
  exit 1
fi
log "Demo fixtures OK"

# ---------------------------------------------------------------------------
# Pre-flight: WA signature-check probe
# ---------------------------------------------------------------------------
log "Pre-flight: probing webhook signature-check bypass (WA_SKIP_SIGNATURE_CHECK in PB env) ..."
PROBE_SID="SM-probe-$(date +%s)"
probe_http_code="$(curl -s -o /tmp/wa_probe_body.txt -w "%{http_code}" -X POST "${PB_URL}/api/wa/webhook" \
  --data-urlencode "MessageSid=${PROBE_SID}" \
  --data-urlencode "AccountSid=${TWILIO_ACCOUNT_SID}" \
  --data-urlencode "From=whatsapp:${TECH_PHONE}" \
  --data-urlencode "To=whatsapp:+14155238886" \
  --data-urlencode "Body=hello" \
  --data-urlencode "NumMedia=0" \
  --data-urlencode "SmsStatus=received")"

if [[ "${probe_http_code}" == "401" ]]; then
  echo "ERROR: PB rejected the unsigned webhook POST (HTTP 401)."
  echo "  PB itself must be started with WA_SKIP_SIGNATURE_CHECK=1 in its environment."
  echo "  Restart PB with:"
  echo "    WA_SKIP_SIGNATURE_CHECK=1 ./pb/pocketbase serve --http=127.0.0.1:8090 ..."
  echo "  (or include WA_SKIP_SIGNATURE_CHECK=1 in your Fly secrets / docker-compose env)"
  exit 1
elif [[ "${probe_http_code}" == "200" ]]; then
  log "Signature-check probe OK (HTTP 200)"
else
  echo "ERROR: Unexpected HTTP ${probe_http_code} from webhook probe."
  cat /tmp/wa_probe_body.txt
  exit 1
fi

# ---------------------------------------------------------------------------
# Scenario A: Move + YES → expect transaction
# ---------------------------------------------------------------------------
log ""
log "=== Scenario A: move DEMO-KIT-005 to DEMO-Customer-Alpha + YES ==="

SID_A1="SM-${RUN_ID}-A1"
SID_A2="SM-${RUN_ID}-A2"
BEFORE_A_MS="$(date +%s%3N)"

log "A1: sending move command ..."
resp_a1="$(send_wa "${SID_A1}" "${TECH_PHONE}" "move DEMO-KIT-005 to DEMO-Customer-Alpha")"
log "A1 response: ${resp_a1:0:200}"

# The hook should have stored a pending confirmation and replied with "Confirm: ..."
# Now send YES
log "A2: sending YES ..."
resp_a2="$(send_wa "${SID_A2}" "${TECH_PHONE}" "YES")"
log "A2 response: ${resp_a2:0:200}"

# Poll up to 30s for the transaction to appear (Anthropic calls can exceed 5s on cold start)
log "A: waiting for transaction to appear (up to 30s) ..."
found_a=0
for i in $(seq 1 15); do
  sleep 2
  tx_count_a="$(count_transactions_after "${BEFORE_A_MS}" "DEMO-KIT-005" "DEMO-Customer-Alpha")"
  if [[ "${tx_count_a}" -gt 0 ]]; then
    found_a=1
    break
  fi
done

log "A: transactions found after run start: ${tx_count_a}"

if [[ "${found_a}" -eq 1 ]]; then
  pass "Scenario A: Move + YES created transaction (found ${tx_count_a}, after $((i*2))s)"
else
  fail "Scenario A: Move + YES" "no transaction found for DEMO-KIT-005 → DEMO-Customer-Alpha after 30s"
fi

# ---------------------------------------------------------------------------
# Scenario B: Move without YES (timeout)
# ---------------------------------------------------------------------------
log ""
log "=== Scenario B: move DEMO-KIT-006 to DEMO-Customer-Alpha (no YES, wait for 30s timeout) ==="

SID_B1="SM-${RUN_ID}-B1"
BEFORE_B_MS="$(date +%s%3N)"

log "B1: sending move command (will NOT send YES) ..."
resp_b1="$(send_wa "${SID_B1}" "${TECH_PHONE}" "move DEMO-KIT-006 to DEMO-Customer-Alpha")"
log "B1 response: ${resp_b1:0:200}"

log "B: waiting 35s for pending confirmation to expire ..."
sleep 35

log "B: verifying NO transaction was created ..."
tx_count_b="$(count_transactions_after "${BEFORE_B_MS}" "DEMO-KIT-006" "DEMO-Customer-Alpha")"
log "B: transactions found: ${tx_count_b}"

if [[ "${tx_count_b}" -eq 0 ]]; then
  pass "Scenario B: No YES timeout — no transaction created (correct)"
else
  fail "Scenario B: No YES timeout" "unexpected transaction found (${tx_count_b} rows) — move should have been blocked"
fi

# ---------------------------------------------------------------------------
# Scenario C: Move + non-YES reply (cancel)
# ---------------------------------------------------------------------------
log ""
log "=== Scenario C: move DEMO-KIT-007 to DEMO-Customer-Alpha + 'no' (cancel) ==="

SID_C1="SM-${RUN_ID}-C1"
SID_C2="SM-${RUN_ID}-C2"
BEFORE_C_MS="$(date +%s%3N)"

log "C1: sending move command ..."
resp_c1="$(send_wa "${SID_C1}" "${TECH_PHONE}" "move DEMO-KIT-007 to DEMO-Customer-Alpha")"
log "C1 response: ${resp_c1:0:200}"

log "C2: sending 'no' to cancel ..."
resp_c2="$(send_wa "${SID_C2}" "${TECH_PHONE}" "no")"
log "C2 response: ${resp_c2:0:200}"

sleep 3

log "C: verifying NO transaction was created ..."
tx_count_c="$(count_transactions_after "${BEFORE_C_MS}" "DEMO-KIT-007" "DEMO-Customer-Alpha")"
log "C: transactions found: ${tx_count_c}"

# Note: "no" itself contains no write-verb match so it falls through to /api/ai/chat.
# That's a query about cancellation, not a move command, so no transaction should appear.
if [[ "${tx_count_c}" -eq 0 ]]; then
  pass "Scenario C: Move + cancel — no transaction created (correct)"
else
  fail "Scenario C: Move + cancel" "unexpected transaction found (${tx_count_c} rows)"
fi

# ---------------------------------------------------------------------------
# Scenario D: Duplicate MessageSid idempotency
# ---------------------------------------------------------------------------
log ""
log "=== Scenario D: Duplicate MessageSid — re-POST Scenario A's first message ==="

log "D: re-posting SID ${SID_A1} (same MessageSid as Scenario A step 1) ..."
BEFORE_D_MS="$(date +%s%3N)"
http_code_d="$(curl -s -o /dev/null -w "%{http_code}" -X POST "${PB_URL}/api/wa/webhook" \
  -H "WA_SKIP_SIGNATURE_CHECK: 1" \
  --data-urlencode "MessageSid=${SID_A1}" \
  --data-urlencode "AccountSid=${TWILIO_ACCOUNT_SID}" \
  --data-urlencode "From=whatsapp:${TECH_PHONE}" \
  --data-urlencode "To=whatsapp:+14155238886" \
  --data-urlencode "Body=move DEMO-KIT-005 to DEMO-Customer-Alpha" \
  --data-urlencode "NumMedia=0" \
  --data-urlencode "SmsStatus=received")"

log "D: HTTP response code from duplicate POST: ${http_code_d}"

# The hook should return 200 (ack) but NOT process the message again.
# We can't intercept Twilio outbound to count replies — rely on PB log + best-effort check.
# Verification: no additional transaction for DEMO-KIT-005 created AFTER scenario D started.
sleep 2
tx_count_d_new="$(count_transactions_after "${BEFORE_D_MS}" "DEMO-KIT-005" "DEMO-Customer-Alpha")"
log "D: new transactions after duplicate POST: ${tx_count_d_new} (expected 0)"

if [[ "${http_code_d}" == "200" ]]; then
  if [[ "${tx_count_d_new}" -eq 0 ]]; then
    pass "Scenario D: Duplicate MessageSid — returned 200, no new transaction (idempotency OK)"
  else
    # New transactions appeared — could be coincidence (race) but flag it
    fail "Scenario D: Duplicate MessageSid" \
      "returned ${http_code_d} but ${tx_count_d_new} new transaction(s) appeared — possible idempotency gap (review PB log)"
  fi
else
  fail "Scenario D: Duplicate MessageSid" \
    "expected HTTP 200 but got ${http_code_d} — duplicate not absorbed"
fi

# ---------------------------------------------------------------------------
# Scenario E: viewer attempting RETURN shortcut → permission denied
# ---------------------------------------------------------------------------
log ""
log "=== Scenario E: viewer RETURN shortcut → permission denied (no transaction) ==="

VIEWER_PHONE="${VIEWER_PHONE:-+972500000099}"

# Find a viewer user in DB
VIEWER_ID="$(curl -s \
  -H "Authorization: ${ADMIN_TOKEN}" \
  "${PB_URL}/api/collections/users/records?filter=role%3D%27viewer%27&perPage=1" \
  | jq -r '.items[0].id // empty')"

if [[ -z "${VIEWER_ID}" ]]; then
  log "E: SKIP — no viewer user found in DB"
  pass "Scenario E: viewer RETURN — SKIPPED (no viewer in DB)"
else
  # Assign VIEWER_PHONE to the viewer user
  curl -s -X PATCH "${PB_URL}/api/collections/users/records/${VIEWER_ID}" \
    -H "Authorization: ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"${VIEWER_PHONE}\"}" >/dev/null

  log "E: assigned phone=${VIEWER_PHONE} to viewer user ${VIEWER_ID}"

  SID_E1="SM-${RUN_ID}-E1"
  BEFORE_E_SEC="$(date +%s)"
  BEFORE_E_ISO="$(date -u "+%Y-%m-%d %H:%M:%S")"

  log "E: sending 'return DEMO-KIT-005' as viewer ..."
  resp_e1="$(send_wa "${SID_E1}" "${VIEWER_PHONE}" "return DEMO-KIT-005")"
  log "E: response: ${resp_e1:0:200}"

  sleep 3

  # Verify no new transaction was created for DEMO-KIT-005 since we started.
  # Use plain second-precision ISO timestamp (date +%s is universally supported).
  filter_e="kit.serial='DEMO-KIT-005'&&created>='${BEFORE_E_ISO}'"
  filter_e_enc="$(url_encode "${filter_e}")"
  tx_count_e="$(curl -s \
    -H "Authorization: ${ADMIN_TOKEN}" \
    "${PB_URL}/api/collections/transactions/records?filter=${filter_e_enc}&perPage=1" \
    | jq -r '.totalItems // 0')"

  log "E: new transactions for DEMO-KIT-005 after viewer RETURN: ${tx_count_e} (expected 0)"

  if [[ "${tx_count_e}" -eq 0 ]]; then
    pass "Scenario E: viewer RETURN did not create transaction (role gate OK)"
  else
    fail "Scenario E: viewer RETURN" "${tx_count_e} transaction(s) created — privilege escalation NOT blocked"
  fi
fi

# ---------------------------------------------------------------------------
# Scenario F: RETURN + YES → audit_log row has via=wa-bot (T13 regression)
# ---------------------------------------------------------------------------
log ""
log "=== Scenario F: RETURN + YES → audit_log via=wa-bot ==="

# Use DEMO-KIT-003 (untouched by scenarios A-E).
# We need a kit that is NOT already at the warehouse so the move is real.
# If it happens to already be there the transaction still writes and the
# audit_log row is still expected with via=wa-bot — the check is on the
# audit_log, not the transaction destination.
SID_F1="SM-${RUN_ID}-F1"
SID_F2="SM-${RUN_ID}-F2"
BEFORE_F_MS="$(date +%s%3N)"
BEFORE_F_ISO="$(date -u "+%Y-%m-%d %H:%M:%S")"

log "F1: sending 'return DEMO-KIT-003' ..."
resp_f1="$(send_wa "${SID_F1}" "${TECH_PHONE}" "return DEMO-KIT-003")"
log "F1 response: ${resp_f1:0:200}"

sleep 2

log "F2: sending YES ..."
resp_f2="$(send_wa "${SID_F2}" "${TECH_PHONE}" "YES")"
log "F2 response: ${resp_f2:0:200}"

sleep 3

# Query audit_log for a transaction row created after F started with via=wa-bot.
# Filter: collection_name='transactions' && created >= BEFORE_F_ISO.
filter_f="collection_name='transactions'&&created>='${BEFORE_F_ISO}'"
filter_f_enc="$(url_encode "${filter_f}")"
audit_f_resp="$(curl -s \
  -H "Authorization: ${ADMIN_TOKEN}" \
  "${PB_URL}/api/collections/audit_log/records?filter=${filter_f_enc}&sort=-created&perPage=5")"

log "F: raw audit_log response (first 400): ${audit_f_resp:0:400}"

# Extract all .via values from changes JSON in matching rows
audit_f_via_list="$(echo "${audit_f_resp}" | jq -r '[.items[] | (.changes | fromjson | .via)] | .[]' 2>/dev/null || true)"
log "F: via values in new audit_log rows: ${audit_f_via_list:-<none>}"

if echo "${audit_f_via_list}" | grep -qx "wa-bot"; then
  pass "Scenario F: audit_log row with via=wa-bot found after RETURN+YES"
else
  fail "Scenario F: audit_log via=wa-bot" \
    "no audit_log row with via='wa-bot' found for DEMO-KIT-003 return (got: ${audit_f_via_list:-<none>})"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log ""
log "====================================================="
log "  Test Results"
log "====================================================="
for r in "${RESULTS[@]}"; do
  log "  ${r}"
done
log "-----------------------------------------------------"
log "  PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}"
log "====================================================="

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  log "OVERALL: FAIL (${FAIL_COUNT} scenario(s) failed)"
  exit 1
else
  log "OVERALL: PASS"
  exit 0
fi
