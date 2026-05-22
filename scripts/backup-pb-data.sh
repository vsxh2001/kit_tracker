#!/usr/bin/env bash
set -e

# Backup pb_data volume from running Fly app using PocketBase's atomic backup command.
# PB's backups command ensures a consistent point-in-time snapshot while the DB
# may be actively written (WAL mode), preventing partial-replay scenarios.
# Usage: ./scripts/backup-pb-data.sh

TS=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
SNAPSHOT_NAME="snapshot-$TS"

echo "→ Create consistent backup via PB on Fly..."
if ! flyctl ssh console --command "/app/pocketbase backups create $SNAPSHOT_NAME" 2>/dev/null; then
  echo "error: ssh failed; ensure flyctl auth is current and app is running" >&2
  exit 1
fi

echo "→ Tar the backup directory..."
if ! flyctl ssh console --command "cd /app/pb_data/backups && tar czf /tmp/$SNAPSHOT_NAME.tar.gz $SNAPSHOT_NAME/" 2>/dev/null; then
  echo "error: tar failed on remote" >&2
  exit 1
fi

echo "→ Download to backups/$SNAPSHOT_NAME.tar.gz"
flyctl ssh sftp get /tmp/$SNAPSHOT_NAME.tar.gz backups/$SNAPSHOT_NAME.tar.gz

echo "→ Cleanup remote temp files"
flyctl ssh console --command "rm /tmp/$SNAPSHOT_NAME.tar.gz && rm -rf /app/pb_data/backups/$SNAPSHOT_NAME" >/dev/null

echo "✓ Backup saved to backups/$SNAPSHOT_NAME.tar.gz"
