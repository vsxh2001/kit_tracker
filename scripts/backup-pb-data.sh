#!/usr/bin/env bash
set -e

# Backup pb_data volume from running Fly app
# Usage: ./scripts/backup-pb-data.sh

TS=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

echo "→ Snapshot pb_data on Fly..."
if ! flyctl ssh console --command "cd /app/pb_data && tar czf /tmp/pb-snapshot-$TS.tar.gz ." 2>/dev/null; then
  echo "error: ssh failed; ensure flyctl auth is current and app is running" >&2
  exit 1
fi

echo "→ Download to backups/pb-snapshot-$TS.tar.gz"
flyctl ssh sftp get /tmp/pb-snapshot-$TS.tar.gz backups/

echo "→ Cleanup remote temp file"
flyctl ssh console --command "rm /tmp/pb-snapshot-$TS.tar.gz" >/dev/null

echo "✓ Backup saved to backups/pb-snapshot-$TS.tar.gz"
