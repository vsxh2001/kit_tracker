---
name: PocketBase v0.22 lacks rate limiting
description: PB v0.22.22 has no built-in rate limiter; auth endpoints (e.g. /api/collections/users/auth-with-password) are unprotected from brute force at the application layer
type: project
---

PocketBase v0.22.22 (the pinned server version per CLAUDE.md) does NOT ship with rate limiting on any endpoint. Rate limiting was added in PB v0.23+. Empirical verification: 20 sequential failed login attempts against https://kit-tracker.fly.dev returned 400 (invalid creds) with zero throttling responses.

**Why:** Without a rate limiter, an attacker can run unlimited credential-stuffing or password-spraying attacks at the unauthenticated `/api/collections/users/auth-with-password` endpoint. Fly.io's edge does not throttle by default for app-level POSTs.

**How to apply:** When reviewing auth flows or security posture, surface this as a HIGH-severity finding. Mitigation options without a PB version bump: (a) Fly.io edge rules / Cloudflare in front of the app, (b) a PB JS hook on `OnRecordBeforeAuthWithPasswordRequest` that tracks failures by IP in-memory with a cooldown, (c) bumping PB to v0.23+ (requires SDK lockstep upgrade per the SDK-pin memory). Do NOT recommend hand-rolled SQLite-based counters without considering write amplification.
