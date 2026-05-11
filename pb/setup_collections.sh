#!/usr/bin/env bash
# Run once after first PocketBase startup to create collections via admin API.
# Usage: ./setup_collections.sh [admin-email] [admin-password]
# Falls back to PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD env vars if args omitted.

set -euo pipefail

PB_URL="${PB_URL:-http://127.0.0.1:8090}"

if [ $# -ge 2 ]; then
  ADMIN_EMAIL="$1"
  ADMIN_PASSWORD="$2"
else
  if [ -z "${PB_SUPERUSER_EMAIL:-}" ] || [ -z "${PB_SUPERUSER_PASSWORD:-}" ]; then
    echo "ERROR: provide credentials as positional args or set PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD" >&2
    exit 1
  fi
  ADMIN_EMAIL="$PB_SUPERUSER_EMAIL"
  ADMIN_PASSWORD="$PB_SUPERUSER_PASSWORD"
fi

echo "Authenticating with PocketBase at $PB_URL..."
TOKEN=$(curl -s -X POST "$PB_URL/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Auth failed. Check credentials and that PocketBase is running."
  exit 1
fi
echo "Authenticated."

create_collection() {
  local body="$1"
  curl -s -X POST "$PB_URL/api/collections" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# Fetch a collection's id by name. Returns empty string if not found.
get_collection_id() {
  local name="$1"
  curl -s "$PB_URL/api/collections/$name" \
    -H "Authorization: $TOKEN" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

echo "Adding 'name' and 'role' fields to users collection..."
USERS_COL=$(curl -s "$PB_URL/api/collections/_pb_users_auth_" -H "Authorization: $TOKEN")
curl -s -X PATCH "$PB_URL/api/collections/_pb_users_auth_" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(echo "$USERS_COL" | jq '
    (.schema // []) as $schema |
    if ($schema | map(.name) | index("name")) then . else .schema += [{"name":"name","type":"text","required":false}] end |
    if ($schema | map(.name) | index("role")) then . else .schema += [{"name":"role","type":"select","required":false,"options":{"values":["","admin","technician","user","viewer"],"maxSelect":1}}] end
  ')" >/dev/null
echo "Users collection updated."

echo "Creating 'entities' collection..."
create_collection '{
  "name": "entities",
  "type": "base",
  "schema": [
    {"name":"name","type":"text","required":true},
    {"name":"description","type":"text"},
    {"name":"is_active","type":"bool","required":true}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.role = \"admin\"",
  "updateRule": "@request.auth.role = \"admin\"",
  "deleteRule": null
}' >/dev/null

echo "Creating 'kits' collection..."
create_collection '{
  "name": "kits",
  "type": "base",
  "schema": [
    {"name":"serial","type":"text","required":true},
    {"name":"notes","type":"text"},
    {"name":"is_active","type":"bool","required":true}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.role = \"admin\"",
  "updateRule": "@request.auth.role = \"admin\"",
  "deleteRule": null
}' >/dev/null

# Resolve real collection IDs before creating collections that reference them.
KITS_ID=$(get_collection_id "kits")
ENTITIES_ID=$(get_collection_id "entities")
USERS_ID=$(get_collection_id "users")

if [ -z "$KITS_ID" ] || [ -z "$ENTITIES_ID" ] || [ -z "$USERS_ID" ]; then
  echo "ERROR: failed to resolve collection IDs (kits=$KITS_ID entities=$ENTITIES_ID users=$USERS_ID)"
  exit 1
fi
echo "Resolved IDs: kits=$KITS_ID entities=$ENTITIES_ID users=$USERS_ID"

# Create requests first so transactions can reference its real id.
echo "Creating 'requests' collection..."
create_collection "$(cat <<EOF
{
  "name": "requests",
  "type": "base",
  "schema": [
    {"name":"requester","type":"relation","required":true,"options":{"collectionId":"$USERS_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"date","type":"date","required":true},
    {"name":"status","type":"select","required":true,"options":{"values":["open","approved","rejected","fulfilled","cancelled"],"maxSelect":1}},
    {"name":"designated_kit","type":"relation","options":{"collectionId":"$KITS_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"target_entity","type":"relation","options":{"collectionId":"$ENTITIES_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"notes","type":"text"},
    {"name":"decision_notes","type":"text"},
    {"name":"expected_return","type":"date","required":false,"options":{"min":"","max":""}},
    {"name":"delivery_date","type":"date","required":true,"options":{"min":"","max":""}}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.role = \"admin\" || @request.auth.role = \"technician\" || (requester = @request.auth.id && status = \"open\")",
  "deleteRule": "@request.auth.role = \"admin\" || (requester = @request.auth.id && status = \"open\")"
}
EOF
)" >/dev/null

REQUESTS_ID=$(get_collection_id "requests")
if [ -z "$REQUESTS_ID" ]; then
  echo "ERROR: failed to resolve requests collection ID"
  exit 1
fi
echo "Resolved IDs: requests=$REQUESTS_ID"

echo "Creating 'transactions' collection..."
create_collection "$(cat <<EOF
{
  "name": "transactions",
  "type": "base",
  "schema": [
    {"name":"kit","type":"relation","required":true,"options":{"collectionId":"$KITS_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"from_entity","type":"relation","options":{"collectionId":"$ENTITIES_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"to_entity","type":"relation","required":true,"options":{"collectionId":"$ENTITIES_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"timestamp","type":"date","required":true},
    {"name":"notes","type":"text"},
    {"name":"created_by","type":"relation","required":true,"options":{"collectionId":"$USERS_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"request","type":"relation","options":{"collectionId":"$REQUESTS_ID","cascadeDelete":false,"maxSelect":1,"minSelect":0}}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "(@request.auth.role = \"admin\" || @request.auth.role = \"technician\") && @request.data.created_by = @request.auth.id",
  "updateRule": null,
  "deleteRule": null
}
EOF
)" >/dev/null

echo ""
echo "Done. Collections created with resolved relation IDs."
echo ""
echo "IMPORTANT: Go to $PB_URL/_/ and:"
echo "  1. Add 'name' (text) and 'role' (select: admin,technician,user,viewer) fields to the 'users' collection."
echo "  2. Set up your first admin account."
