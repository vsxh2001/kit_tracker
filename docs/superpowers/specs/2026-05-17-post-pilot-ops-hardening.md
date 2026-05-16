# Post-Pilot Ops Hardening — Spec

Status: **APPROVED — ready for implementation**
Date: 2026-05-17
Owner: hadassi
Context: Pilot-Ready Sprint PR #1 merge-ready. Spec §6 risks called out "Ops hardening deferred (no backup cron, no monitoring) — if pilot's first week has data loss, trust gone." This mini-sprint closes that gap.

---

## 1. Goal

Eliminate the two highest-impact ops gaps before pilot week 1:

1. **Daily automated PocketBase backup** to an off-site location (not just on the Fly volume).
2. **Uptime + error monitoring** so a silent outage doesn't go undetected for hours.

No new features. Pure infrastructure + automation.

## 2. Scope

### In scope

- Daily backup cron (GitHub Actions schedule) running `scripts/backup-pb-data.sh` against the deployed Fly instance.
- Off-site upload of the resulting tarball to a durable store (default: GitHub release artifact under a private repo; alt: S3 / Backblaze B2 if user already has creds).
- Retention policy: keep last 14 daily snapshots + last 8 weekly + last 6 monthly = 28 total.
- Backup health check: cron job FAILs the run if the snapshot is <100KB or the upload step fails. Notifies via existing GitHub Actions notification (email).
- Uptime monitor pointing at `https://kit-tracker.fly.dev/api/health` — UptimeRobot free tier (50 monitors, 5-min intervals) — set up via documented runbook, no automation needed.
- Restore-drill runbook: `docs/backup-restore-drill.md` — steps to verify a snapshot tar restores cleanly into a fresh PB instance.

### Out of scope

- Sentry / Datadog APM (deferred — needs paid tier + key rotation infrastructure).
- Multi-region failover (Fly free tier doesn't support; needs paid plan).
- Real-time alerting integrations (Slack / PagerDuty — pilot is small enough that email is fine).
- Database replication (single-writer SQLite — covered by snapshot cadence, not replication).
- Automatic restore on detected corruption (too risky; manual restore via runbook).

## 3. Backup automation

### 3.1 GitHub Actions cron

New workflow: `.github/workflows/backup.yml`.

```yaml
name: Daily PB Backup
on:
  schedule:
    - cron: "23 4 * * *"   # 04:23 UTC daily (off the :00 spike)
  workflow_dispatch:        # manual trigger
permissions:
  contents: write           # to create release with artifact
jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master
      - name: Run snapshot via Fly SSH
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          mkdir -p backups
          flyctl ssh console -a kit-tracker -C "bash scripts/backup-pb-data.sh"
          flyctl ssh sftp get -a kit-tracker /app/backups/$(ls -t backups | head -1) backups/
      - name: Validate snapshot size
        run: |
          SIZE=$(stat -c %s backups/*.tar.gz | head -1)
          if [ "$SIZE" -lt 100000 ]; then
            echo "ERROR: snapshot is suspiciously small ($SIZE bytes)"
            exit 1
          fi
      - name: Upload as release artifact
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          TAG="backup-$(date -u +%Y%m%d-%H%M)"
          gh release create "$TAG" backups/*.tar.gz --title "Daily backup $TAG" --notes "Automated daily snapshot."
      - name: Prune old releases
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/prune-backup-releases.sh
```

### 3.2 Pruning script

New: `scripts/prune-backup-releases.sh`. Keeps 14 daily + 8 weekly + 6 monthly = 28 max. Older releases deleted via `gh release delete`.

### 3.3 Existing script verification

`scripts/backup-pb-data.sh` already exists per CLAUDE.md. Verify:
- Snapshots to `backups/pb-snapshot-YYYYMMDD-HHMMSS.tar.gz`
- Tar includes `pb_data/` directory only (NO logs.db / storage if they're outside pb_data)
- Compression level reasonable (~10MB for a small pilot instance)

## 4. Uptime monitoring

### 4.1 UptimeRobot setup runbook

New: `docs/uptime-monitor-setup.md`. Steps:

1. Sign up at uptimerobot.com (free tier)
2. Add monitor:
   - Type: HTTP(s)
   - URL: `https://kit-tracker.fly.dev/api/health`
   - Interval: 5 min
   - Alert contacts: admin email + (optional) Slack webhook
3. Verify by intentionally stopping the Fly app for 6 min, confirm email fires

No code automation. Pure runbook. Pilot owner does this once.

## 5. Restore drill

New: `docs/backup-restore-drill.md`. Steps:

1. Pick a recent backup release from GitHub
2. Download tarball locally
3. Start a fresh PocketBase locally with empty `/tmp/restore-test`
4. Extract tarball into it
5. Boot PB pointed at `/tmp/restore-test`
6. Verify schema matches expected (run `scripts/verify-restore.sh` — a sanity check that lists collections + counts)
7. Verify migrations applied cleanly (check `_migrations` table count)

Run drill BEFORE pilot kickoff. Repeat monthly thereafter.

### 5.1 Verify-restore script

New: `scripts/verify-restore.sh`. Simple sanity probe — boot PB on a temp port, query collection counts, exit 0 if all expected collections present + non-empty.

## 6. Implementation plan

Four tasks, all parallelizable (different files):

- **POH-T1** — `.github/workflows/backup.yml` + `scripts/prune-backup-releases.sh`
- **POH-T2** — `docs/uptime-monitor-setup.md` (pure docs runbook)
- **POH-T3** — `docs/backup-restore-drill.md` + `scripts/verify-restore.sh`
- **POH-T4** — End-to-end dry-run: trigger workflow_dispatch on a test branch, verify artifact uploaded, restore drill on the artifact, confirm contents

## 7. Risks

| Risk | Mitigation |
|---|---|
| Fly SSH SFTP token revocation mid-cron | Use long-lived `FLY_API_TOKEN` GitHub secret; rotate every 90 days; alert if cron fails 3 days in a row |
| Backup tar exceeds GitHub release size limit (2GB) | Pilot data << 100MB; document if size grows >500MB and revisit S3 path |
| GitHub Actions schedule drift / silent skip | Workflow_dispatch button means manual fallback always available; uptime monitor catches related app outages |
| Snapshot file is consistent (no SQLite WAL races) | PocketBase pauses writes during snapshot; verify the existing `backup-pb-data.sh` uses `.dump` or `vacuum into` (it does per CLAUDE.md "snapshot the pb_data volume"). If not, add the WAL-quiesce step. |

## 8. Out of band

After this mini-sprint:
- Add a `last_successful_backup_at` admin-only page showing the most recent release tag
- Sentry frontend errors when paid tier is signed off (~$26/mo Team plan)
- Datadog APM if scale grows past free tiers
