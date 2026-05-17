# Backup Restore Drill

Run this BEFORE pilot kickoff to verify backups are usable. Repeat MONTHLY during pilot.

## Why

A backup you can't restore is decoration. This drill confirms:
1. The backup ZIP is intact and complete
2. The PB binary can boot against it
3. Migrations apply cleanly (no schema drift)
4. Key collections have expected row counts

## Prerequisites

- Local copy of `pb/pocketbase` binary (same version as production)
- A recent backup — download from GitHub releases:
  ```bash
  gh release list --limit 5
  gh release download <backup-YYYYMMDD-HHMM> -p '*.gpg' -D /tmp/restore-test
  ```

## Decrypt snapshot

```bash
export BACKUP_ENCRYPTION_KEY=$(... fetch from 1Password ...)
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
  -o pb-snapshot-YYYYMMDD-HHMMSS.zip \
  pb-snapshot-YYYYMMDD-HHMMSS.zip.gpg
```

If decryption fails, the snapshot is unusable — verify key matches what was set when backup ran.

## Steps

1. **Prepare scratch dir and extract:**
   ```bash
   RESTORE=/tmp/pb-restore-$(date +%s)
   mkdir -p "$RESTORE"
   cd "$RESTORE"
   unzip /tmp/restore-test/*.zip
   # The pocketbase backup command produces a ZIP whose top-level entries
   # are pb_data contents (not a pb_data/ wrapper directory).
   # Verify the extracted structure before booting:
   ls -la | head
   # Expect: data.db, logs.db, storage/ etc. at the top level.
   # If you see a pb_data/ subdirectory instead, adjust --dir below accordingly.
   # PB will fail to boot if pb_data/ is missing or mis-nested — check structure here.
   ```

2. **Boot PB against the restored data:**
   ```bash
   /path/to/kit_tracker/pb/pocketbase serve \
     --http=127.0.0.1:48190 \
     --dir="$RESTORE" \
     --hooksDir=/path/to/kit_tracker/pb/pb_hooks \
     --migrationsDir=/path/to/kit_tracker/pb/pb_migrations &
   PB_PID=$!
   sleep 5
   ```

   > If your `pocketbase backup` binary version produces a `pb_data/` wrapper
   > directory inside the ZIP, use `--dir="$RESTORE/pb_data"` instead.

3. **Run verify script (strict mode):**
   ```bash
   PB_ADMIN_EMAIL=admin@example.com \
   PB_ADMIN_PASSWORD=changeme123 \
   bash /path/to/kit_tracker/scripts/verify-restore.sh 48190
   ```

   For a fresh-DB drill where production-level row counts are not expected:
   ```bash
   PB_ADMIN_EMAIL=admin@example.com \
   PB_ADMIN_PASSWORD=changeme123 \
   bash /path/to/kit_tracker/scripts/verify-restore.sh --allow-empty 48190
   ```
   `--allow-empty` verifies collections exist and are queryable but skips minimum-row thresholds.

4. **Stop the PB instance:**
   ```bash
   kill $PB_PID
   rm -rf "$RESTORE"
   ```

## Success criteria

`verify-restore.sh` exits 0. Strict mode: all expected collections present with
pilot-realistic row counts (users ≥ 1, entities ≥ 1, kits ≥ 1, transactions ≥ 1,
audit_log ≥ 1). `--allow-empty` mode: all collections queryable regardless of count.

## Failure modes

- PB exits with "migration X failed" → schema mismatch between binary version and snapshot version. Check `pb_data/types.d.ts` migration history.
- `verify-restore.sh` reports zero rows in a critical collection → backup is incomplete; investigate the backup workflow output.
- `verify-restore.sh` exits with "superuser auth failed" → wrong `PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD` or the restored DB has no superuser record.
- PB hangs at startup → another process is on port 48190; pick a different port.

## Restore to production (DR scenario)

If you need to restore production:

1. **Scale Fly to zero:** `flyctl scale count 0 -a kit-tracker`
2. **SSH into machine OR mount the volume locally** via `flyctl volumes` workflow
3. **Extract backup ZIP into pb_data:** rm contents + unzip (verify structure as in Step 1 above)
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
