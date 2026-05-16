# Backup Restore Drill

Run this BEFORE pilot kickoff to verify backups are usable. Repeat MONTHLY during pilot.

## Why

A backup you can't restore is decoration. This drill confirms:
1. The snapshot tarball is intact and complete
2. The PB binary can boot against it
3. Migrations apply cleanly (no schema drift)
4. Key collections have expected row counts

## Prerequisites

- Local copy of `pb/pocketbase` binary (same version as production)
- A recent backup tarball — download from GitHub releases:
  ```bash
  gh release list --limit 5
  gh release download <backup-YYYYMMDD-HHMM> -p '*.tar.gz' -D /tmp/restore-test
  ```

## Steps

1. **Prepare scratch dir:**
   ```bash
   RESTORE=/tmp/pb-restore-$(date +%s)
   mkdir -p "$RESTORE"
   cd "$RESTORE"
   tar -xzf /tmp/restore-test/*.tar.gz
   # Expect: pb_data/ extracted
   ls pb_data | head
   ```

2. **Boot PB against the restored data:**
   ```bash
   /path/to/kit_tracker/pb/pocketbase serve --http=127.0.0.1:48190 --dir="$RESTORE/pb_data" --hooksDir=/path/to/kit_tracker/pb/pb_hooks --migrationsDir=/path/to/kit_tracker/pb/pb_migrations &
   PB_PID=$!
   sleep 5
   ```

3. **Run verify script:**
   ```bash
   bash /path/to/kit_tracker/scripts/verify-restore.sh 48190
   ```

4. **Stop the PB instance:**
   ```bash
   kill $PB_PID
   rm -rf "$RESTORE"
   ```

## Success criteria

`verify-restore.sh` exits 0. All expected collections present with non-zero row counts (except `audit_log` which may be empty on a fresh seed).

## Failure modes

- PB exits with "migration X failed" → schema mismatch between binary version and snapshot version. Check `pb_data/types.d.ts` migration history.
- `verify-restore.sh` reports zero rows in a critical collection → backup is incomplete; investigate `backup-pb-data.sh` output.
- PB hangs at startup → another process is on port 48190; pick a different port.

## Restore to production (DR scenario)

If you need to restore production:

1. **Scale Fly to zero:** `flyctl scale count 0 -a kit-tracker`
2. **SSH into machine OR mount the volume locally** via `flyctl volumes` workflow
3. **Replace pb_data:** rm + extract tarball
4. **Scale back:** `flyctl scale count 1 -a kit-tracker`
5. **Tail logs:** `flyctl logs -f` — confirm "Server started" + migrations applied
6. **Verify on web:** `/audit` shows historical rows; `/kits` returns expected count

## Cadence

| When | Action |
|---|---|
| Pre-pilot | Full drill — extract latest backup, boot, verify |
| Monthly during pilot | Same drill |
| After each schema migration | Quick drill (extract + boot only) |
| After DR event | Drill + post-mortem |
