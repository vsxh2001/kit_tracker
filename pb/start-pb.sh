#!/usr/bin/env bash
# Single source of truth for starting PocketBase across local dev, CI, and docker.
# Override via env vars; defaults match local dev.
#
# Env vars:
#   PB_HTTP        — bind address (default 127.0.0.1:8090 or 0.0.0.0:8090 based on PB_HOST)
#   PB_DATA_DIR    — data directory (default pb/pb_data)
#   PB_HOOKS_DIR   — hooks directory (default pb/pb_hooks)
#   PB_MIGRATIONS_DIR — migrations directory (default pb/pb_migrations)
#
# Auto-detection:
#   If ./pb/pocketbase exists, use it (local dev, CI).
#   If /app/pb/pocketbase exists, use it (docker container).
#
# Usage:
#   bash pb/start-pb.sh                              # local dev
#   PB_HTTP=0.0.0.0:8090 PB_DATA_DIR=/tmp/pb_data bash pb/start-pb.sh &  # CI
#   bash pb/start-pb.sh                              # docker-entrypoint (env set externally)

set -e

# Auto-detect pocketbase binary location
if [ -x ./pb/pocketbase ]; then
  PB_BIN=./pb/pocketbase
elif [ -x /app/pb/pocketbase ]; then
  PB_BIN=/app/pb/pocketbase
else
  echo "ERROR: pocketbase binary not found at ./pb/pocketbase or /app/pb/pocketbase" >&2
  exit 1
fi

# Set defaults
PB_HTTP="${PB_HTTP:-127.0.0.1:8090}"
PB_DATA_DIR="${PB_DATA_DIR:-pb/pb_data}"
PB_HOOKS_DIR="${PB_HOOKS_DIR:-pb/pb_hooks}"
PB_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-pb/pb_migrations}"
# Default publicDir to ./pb_public (CWD-relative). Override via PB_PUBLIC_DIR.
# Without this flag PB resolves "dir of executable", which for a symlinked
# binary follows the symlink target (e.g. /usr/local/bin/pb_public) — wrong
# location in containers. Explicit flag prevents that.
PB_PUBLIC_DIR="${PB_PUBLIC_DIR:-pb_public}"

exec "$PB_BIN" serve \
  --http="$PB_HTTP" \
  --dir="$PB_DATA_DIR" \
  --hooksDir="$PB_HOOKS_DIR" \
  --migrationsDir="$PB_MIGRATIONS_DIR" \
  --publicDir="$PB_PUBLIC_DIR"
