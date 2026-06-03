# Uptime Monitor Setup — UptimeRobot Free Tier

## 1. Why

Single Fly machine + single region + no replication = silent outage detection is the
highest-value monitor for ~$0. UptimeRobot free tier (50 monitors, 5-min interval) is
enough for the pilot.

---

## 2. Setup (admin one-time)

1. Sign up at <https://uptimerobot.com> (Google sign-in works).
2. Click **Add New Monitor** → type **HTTP(s)**.
3. URL: `https://kit-tracker.fly.dev/api/health`
   (replace `kit-tracker` with your pilot's Fly app name if different).
4. Friendly name: `Kit Tracker Pilot Prod`.
5. Monitoring interval: **5 minutes** (free tier maximum).
6. Alert contacts: add the admin email address.
   Optional: add Slack via incoming webhook (see Alert Routing below).
7. Click **Save**. The monitor should turn green within 5 minutes.

---

## 3. Alert routing

- **Default:** UptimeRobot emails on the first confirmed failure. The service requires
  2 consecutive failed checks before alerting (~10-minute delay at 5-min interval).
- **Recommended:** enable both "alert when down" and "alert when up" so recovery
  is confirmed automatically.
- **Slack:** UptimeRobot's native Slack integration is paid tier only. Use IFTTT or
  Zapier free tier as a bridge, or route via an incoming webhook from the UptimeRobot
  notification email if your Slack workspace supports email-to-channel.

---

## 4. Verification (do once after setup)

Run this after first setup to confirm alerts actually fire end-to-end:

1. Scale the app to zero: `flyctl scale count 0 -a kit-tracker`
2. Wait ~10 minutes (two consecutive failed checks).
3. Confirm UptimeRobot dashboard status flips to **Down**.
4. Confirm the alert email arrives in the admin inbox.
5. Restore the app: `flyctl scale count 1 -a kit-tracker`
6. Wait ~5 minutes.
7. Confirm UptimeRobot flips back to **Up** and the recovery email arrives.

---

## 5. Maintenance windows

When taking the app down for more than 10 minutes (planned deploy, migration, etc.):

- **Pause** the monitor first: UptimeRobot dashboard → monitor → Pause.
- Re-enable after the deploy or maintenance completes.
- Alternatively, accept the false alert and log it in the incident log to avoid
  normalising ignored alerts.

---

## 6. What NOT to monitor (yet)

The following add noise without actionable signal at pilot scale:

- **Per-page performance** — no baseline established; noise > signal until user base grows.
- **Database row counts** — no automated rebalance; alert without action is noise.
- **Telegram webhook reachability** — covered by `/api/health` (same process).

---

## 7. Upgrade path

When the pilot grows to >50 active users or adds a second Fly region:

- **UptimeRobot paid tier** ($7/mo): 1-min check interval, 24/7 phone alerts, hosted
  status page for users.
- **Sentry**: add frontend error tracking (`@sentry/react`) + source maps.
- **Datadog APM**: backend latency, PocketBase request traces, alerting on p95 regressions.
