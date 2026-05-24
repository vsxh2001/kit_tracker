#!/usr/bin/env bash
#
# Replay a Meta-shaped WhatsApp webhook POST against a target URL.
# No real WhatsApp delivery needed — useful for local dev and prod debugging.
#
# Usage:
#   bash scripts/wa-meta-replay.sh [options]
#
# Options:
#   --url  <url>   Target URL (default: http://localhost:8090/api/wa/meta/webhook)
#   --from <phone> Sender phone number, no '+' prefix (default: 972527799932)
#   --body <text>  Message text (default: "where is kit 1")
#   --wamid <id>   Message ID (default: wamid.test.<epoch>.<random>)
#
set -eu

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
URL="http://localhost:8090/api/wa/meta/webhook"
FROM="972527799932"
BODY="where is kit 1"
WAMID=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)  URL="$2";  shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --body) BODY="$2"; shift 2 ;;
    --wamid) WAMID="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--url <url>] [--from <phone>] [--body <text>] [--wamid <id>]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Generate wamid if not provided
# ---------------------------------------------------------------------------
if [ -z "$WAMID" ]; then
  WAMID="wamid.test.$(date +%s).$RANDOM"
fi

# ---------------------------------------------------------------------------
# Build timestamp (Unix epoch seconds)
# ---------------------------------------------------------------------------
NOW="$(date +%s)"

# ---------------------------------------------------------------------------
# Build JSON payload (Meta v18 shape)
# ---------------------------------------------------------------------------
PAYLOAD=$(printf '{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "1012217101334902",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "+1 555-654-7786",
          "phone_number_id": "1059995567204667"
        },
        "contacts": [{ "profile": { "name": "Tester" }, "wa_id": "%s" }],
        "messages": [{
          "from": "%s",
          "id": "%s",
          "timestamp": "%s",
          "type": "text",
          "text": { "body": "%s" }
        }]
      },
      "field": "messages"
    }]
  }]
}' "$FROM" "$FROM" "$WAMID" "$NOW" "$BODY")

# ---------------------------------------------------------------------------
# Debug output
# ---------------------------------------------------------------------------
echo "--- Request ---"
echo "URL:  $URL"
echo "Body: $PAYLOAD"
echo ""

# ---------------------------------------------------------------------------
# Send request
# ---------------------------------------------------------------------------
HTTP_RESPONSE="$(curl -s -w "\n__STATUS__:%{http_code}" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

RESPONSE_BODY="$(printf '%s' "$HTTP_RESPONSE" | sed 's/__STATUS__:[0-9]*$//')"
STATUS_CODE="$(printf '%s' "$HTTP_RESPONSE" | grep -o '__STATUS__:[0-9]*' | cut -d: -f2)"

# ---------------------------------------------------------------------------
# Print results
# ---------------------------------------------------------------------------
echo "--- Response ---"
echo "HTTP status: $STATUS_CODE"
echo "Body: $RESPONSE_BODY"
echo ""

# ---------------------------------------------------------------------------
# Warnings
# ---------------------------------------------------------------------------
if [ "$STATUS_CODE" = "403" ] || [ "$STATUS_CODE" = "401" ]; then
  echo "WARNING: $STATUS_CODE — the webhook rejected the request."
  echo "  Unsigned POSTs are rejected when WHATSAPP_APP_SECRET is set."
  echo "  For local dev, set WA_SKIP_SIGNATURE_CHECK=1 in the PocketBase environment"
  echo "  (never set in prod — bypasses HMAC-SHA256 signature verification)."
fi

if [ "$STATUS_CODE" = "000" ] || [ -z "$STATUS_CODE" ]; then
  echo "WARNING: Could not reach $URL — is PocketBase running?"
fi
