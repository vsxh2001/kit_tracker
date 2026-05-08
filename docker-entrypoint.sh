#!/bin/sh
set -e

: "${PB_SUPERUSER_EMAIL:?PB_SUPERUSER_EMAIL must be set}"
: "${PB_SUPERUSER_PASSWORD:?PB_SUPERUSER_PASSWORD must be set}"

./pocketbase admin create "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
  --dir=/app/pb_data 2>/dev/null || true

exec ./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  --publicDir=/app/pb_public
