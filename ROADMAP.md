# Kit Tracker — Roadmap (next 3–6 months)

_Draft prepared 2026-05-12 against HEAD `5587df1`. Not committed — for review._

This roadmap synthesises what has shipped in the recent build cycle (auth, role hierarchy, kits + tags + attachments + QR, components, transactions + timeline, requests + calendar + notifications + overdue reminders, stats, audit log, sparklines, mobile responsive, Fly deployment) and lays out a 12-week horizon plus a 3–6 month strategic direction.

---

## Section 1 — Strategic positioning

### Who is the target user?

Kit Tracker has grown well past "personal kit inventory". The current feature surface — role hierarchy with technician tier, request fulfilment workflow, overdue reminders, utilisation dashboard, audit log, CSV import/export, QR labels — is overkill for a single user but well-aligned with a **small-to-mid lab, field-services team, or hardware ops team of 5–50 people moving 50–1,000 physical kits between people, customer sites, storage and maintenance**. The "kit" framing (multi-part assets with components, serialised + bulk inventory) is a meaningful differentiator from generic asset trackers that assume one-asset-one-row. My recommendation is to lock the persona as **"small hardware ops team that ships kits to customers / between sites and needs an audit trail" (think AV rental, biotech field deployment, IT field engineering, broadcasting / film loaners, university labs)**. Personal use is a side-effect, not the target. Commercial SaaS is plausible but not where the next two quarters should be spent — distribution and onboarding are not built yet.

### Differentiator vs Shelf.nu / Snipe-IT / Asset Panda

Snipe-IT is the dominant open-source player but is opinionated about **IT assets** (laptops, licences, accessories, consumables) with a workflow that pivots on check-out to a user. Shelf.nu is the modern open-source SaaS contender, polished UI, free-forever personal tier, $34–67/mo team tiers, strong booking calendar; positions itself as "spreadsheets for assets" with universal asset scope. Asset Panda is enterprise SaaS, no self-host, high price.

Kit Tracker's wedge is **the kit-as-aggregate model**: a kit has serial, tags, attachments, components (serialised + bulk), and moves between entities (not just users) — people, storage, customers, maintenance, lab. That entity model is closer to a lightweight CMMS / field-service tool than to Snipe-IT's IT-asset model. Lean into it. The pitch is:

> "Snipe-IT for teams who don't think in terms of laptops. Lighter than Shelf, sharper than a spreadsheet, opinionated about kit movement between sites and customers, with an append-only audit trail you can defend in front of a compliance reviewer."

Concretely, defensible differentiators worth investing in over the next quarter:

- **Components-within-kits** with implicit-move semantics (already shipped — under-marketed; needs a demo page and docs)
- **Entity-typed movement** (storage / customer / maintenance / lab) — most tools only model person↔location, not customer-out / RMA-in
- **Append-only transactions + audit log** — easy compliance story (SOX / ISO 9001 / ISO 13485 traceability)
- **Self-hostable single binary** — PocketBase makes the "docker run + done" pitch real in a way Shelf (Postgres + Remix) struggles to match

### Monetisation

Recommendation: stay **OSS self-host first, optional managed hosting later**. The single-binary PocketBase architecture means a hobbyist can `docker run` and be productive — that drives adoption and feedback. A managed tier (Fly-hosted, custom domain, daily backups, email delivery included) at ~$20–40/mo is the obvious second step, but only after onboarding is friction-free and there is documented demand. Avoid per-seat pricing (Shelf has correctly identified that this is anti-team); team-based flat tier is the path.

Do **not** monetise the next two quarters. Monetise once there are ≥20 self-hosters reporting back, an onboarding flow that doesn't require a CLI, and at least one paid pilot.

---

## Section 2 — Next-quarter features (12 weeks, prioritised)

Effort key: S ≤ 2 days, M ≤ 1 week, L > 1 week. Dependencies noted where relevant.

### P0 — must ship this quarter

| # | Feature | One-liner | User benefit | Effort | Depends on |
|---|---|---|---|---|---|
| P0-1 | **Maintenance schedules + calibration tracking** | Per-kit recurring maintenance / calibration dates with email reminders and overdue flag on KitDetail | Field-service / lab teams operate on calibration cycles; without this Kit Tracker is half a CMMS | M | extends existing reminder cron in `overdue_return_reminder.pb.js`; new `kit_schedules` collection |
| P0-2 | **Kit lifecycle states** | `received → in-service → maintenance → retired (EOL)` as a first-class field on kits, with state-transition log and filters | Currently `is_active` is a binary that hides retired kits; ops teams need to see EOL inventory and what is in maintenance vs. in service | S | adds `lifecycle_state` enum field on `kits`; audit hook already picks up changes |
| P0-3 | **Public QR scan landing page** | `/scan/:kitId` unauthenticated route showing kit name, current holder (entity), tags, public-safe notes; opens when a non-logged-in phone scans a printed QR | The whole point of QR labels — currently scanning lands a stranger on `/login` which is useless on a customer site or shipping dock | M | new public route + `kits.scanRule` (or signed token); requires deciding which fields are public-safe |
| P0-4 | **Bulk select + bulk actions on /kits and /entities** | Checkbox column, "transfer to entity", "tag", "activate / retire", "export selected" | Power users with 100+ kits cannot do common operations one at a time; reviewer surfaced this gap | M | UI work; transaction batching for bulk transfer must preserve atomicity per kit |
| P0-5 | **Audit log gap closure (deletes, superadmin actions)** | Hook on delete events + superadmin auth events; UI filter for "deletes only" | Reviewer P2 — current audit log covers create/update only; compliance pitch breaks if deletes are silent | S | extend `audit_log.pb.js`; new event types |
| P0-6 | **Scheduled email digest** | Weekly summary email to admins: new kits, transactions count, open requests, overdue, low-utilisation kits | Stats page is pull-only; weekly digest pushes the value back to busy admins who never visit `/stats` | S | reuses email infra; new cron in hooks |

### P1 — should ship this quarter

| # | Feature | One-liner | User benefit | Effort | Depends on |
|---|---|---|---|---|---|
| P1-1 | **Slack / Teams webhook notifications** | Outbound webhook on new request, request approved/fulfilled, overdue | Most teams live in Slack; email notifications get filtered out | S | new `webhooks` table or simple env-var URL; reuses notification trigger points |
| P1-2 | **Server-side pagination + search on /kits, /entities, /transactions** | Replace `getFullList` with paged `getList` and a debounced search input that filters on the server | At 500+ kits the pages get slow and the LIKE-based client filter is wrong | M | touches every service file; performance investment |
| P1-3 | **Photo upload from phone (mobile)** | "Add photo" button on KitDetail that opens device camera; same attachment field, image-optimised | Field engineers want to document kit condition on receipt / return; current 5MB attachment field supports this UI-side only | S | leverage `<input type="file" capture="environment">`; image resize client-side |
| P1-4 | **MIME whitelist + scanning on attachments** | Block executables, validate magic bytes, cap per-file at 5MB, total per-kit at 50MB | Reviewer P1 — current attachment field has no MIME whitelist, public-facing instance is an XSS / malware vector | S | PB hook on `kits.update` validating attached files |
| P1-5 | **CSV import: dry-run preview + per-row error report** | Show diff before commit, per-row reason for skipped rows, downloadable error CSV | Current CSV import "skip on duplicate" is opaque; users with bad data abandon | M | extends `exportKitsCsv` / `importKitsCsv` pattern |
| P1-6 | **REST API public docs page** | Auto-generated PB API docs page at `/docs/api` with examples; document the public read paths a customer might use | Adopters who want to script imports / build mobile clients need a docs surface that isn't "read the SDK source" | S | PB already exposes OpenAPI-ish data; host static page |
| P1-7 | **Dark mode** | Tailwind class-based dark toggle, persisted in localStorage | Frequently-asked UX polish; cheap with current CSS variable theming | S | extend `index.css` palette |
| P1-8 | **Keyboard shortcuts on lists** | `k`/`j` row navigation, `/` to focus search, `Enter` to open detail | Power-user retention | S | small util module |

### P2 — nice-to-have / spillover

| # | Feature | One-liner | Effort |
|---|---|---|---|
| P2-1 | Undo for destructive ops (delete kit / entity, retire kit) — 10-second toast | S |
| P2-2 | Offline PWA shell with read-only cached kit list + queued transaction submit | L |
| P2-3 | Saved filter views ("show me overdue at customer X") | S |
| P2-4 | Custom fields per kit / entity (Shelf has this on the paid tier) | M |
| P2-5 | ERP / CMMS connector — at minimum a webhook spec; Maximo / Fiix later | L |
| P2-6 | SOX / ISO 9001 documentation pack — markdown explaining append-only model, audit retention, role separation | S (doc work) |
| P2-7 | Granular permissions ("technician can only act on entity X") — beyond current role-based scheme | L |

---

## Section 3 — Architectural / tech debt (P1)

These were surfaced by reviewers during the recent build cycle and should be scheduled alongside feature work, not deferred indefinitely.

| Item | Risk if deferred | Effort |
|---|---|---|
| N+1 in `exportKitsCsv` | CSV export gets slow / times out at 500+ kits | S — batch fetch latest transactions with single `getList` filtered by `kit ~ "..."` |
| Attachment MIME whitelist | Security — see P1-4 above | S |
| Audit log gaps (deletes, superadmin) | Compliance pitch loses credibility — see P0-5 | S |
| `avgFulfillmentDays` uses updated-created proxy | Stat is wrong when a request is updated after fulfilment | S — record `fulfilled_at` explicitly on fulfilment |
| Sparkline `var()` HSL not resolving | Cosmetic — sparklines render with fallback colour | S |
| Phase C per-worker PB isolation (deferred) | E2E flakiness, can't parallelise tests | M — revisit when test runtime hurts |
| `/stats` route gating internal-only | Currently admin + technician; non-internal data exposure if positioning shifts to multi-tenant | S |
| **No automated test suite for hooks** (only Playwright UI) | PB hooks (`role_change_check`, `last_admin_check`, audit, notifications) have no unit tests; the next regression there is a foot-gun | M — add a thin Node test runner that hits the PB REST API against a fresh ephemeral DB |
| **No type generation from PB schema** | Every schema change requires manual `types/index.ts` edits | S — adopt `pocketbase-typegen` or similar |
| **OAuth client secret committed to repo** | The `client_secret_*.json` at repo root should not be there | S — `.gitignore` + rotate the credential |
| **PB SDK pinned to ^0.21.x while server is 0.22** | Documented in CLAUDE.md; ticking time-bomb when PB releases 0.23 and SDK 0.22 lands on npm | M — coordinated bump |

### When to introduce a proper test suite

The hook layer now has six PB hooks doing security-critical work (role-change, last-admin, audit, validation, notifications, overdue). Playwright covers user-facing flows but says nothing about hook behaviour under bad inputs. **Recommend adding a lightweight integration test runner (vitest + REST calls against a docker-compose PB instance) before P0-1/P0-5 ship** — both touch hook surface area and the absence of tests will compound.

---

## Section 4 — Risks / known issues

| Risk | Mitigation |
|---|---|
| **Single Fly machine, single region (Frankfurt)** — any zone-level Fly outage = total downtime; ~10 min/yr ish for Fly | Add a second `min_machines_running` machine in a different region (`auto_stop_machines = false` is fine), or accept the SLA and document it. PB itself supports read-replica but not multi-master, so true HA is non-trivial. |
| **`pb_data` backup is manual** — script exists but no cron, no off-site copy | Schedule daily backup via Fly cron / GitHub Actions to push the SQLite snapshot to S3 / Backblaze B2. Add restore drill to runbook. |
| **No monitoring / alerting** — Fly health check exists but no Sentry / log aggregation / uptime monitor | Add UptimeRobot or BetterStack on `/api/health`, wire Sentry for frontend errors. Cheap (free tiers cover this). |
| **Google OAuth URLs hardcoded for one project** | Move OAuth client config to env vars (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` are already env-driven per `setup_oauth.sh`); document multi-environment setup. |
| **Committed OAuth `client_secret_*.json` file** | Listed in repo root. Rotate the secret, delete the file, add to `.gitignore`. |
| **Fly machine is 512 MB / 1 shared CPU** | Fine for now; will need bumping past ~50 concurrent users or large CSV imports. Add a perf-test step to CI before bumping prices on a managed tier. |
| **PB SQLite single-writer** | At 100s of writes/sec this matters; at the current scale it does not. Document the ceiling so it doesn't surprise anyone. |

---

## Section 5 — Suggested next 3 features to ship

These maximise (user value) × (low effort) × (alignment with the lab/field-service persona).

### 1 — Maintenance schedules + calibration tracking (P0-1)

**Why this wins:** The biggest gap between Kit Tracker today and "the thing a lab manager will adopt instead of a spreadsheet" is recurring maintenance / calibration. Every regulated environment (medical, broadcast, scientific instruments, AV rental) tracks this and it is the #1 use case that justifies an audit log. Shelf does not have it. Snipe-IT has a half-built maintenance module that is widely complained about. The infra is already in place: cron hook pattern from overdue-return reminder, audit log, KitDetail card layout.

**Effort:** M. New `kit_schedules` collection (kit, schedule_type, interval_days, last_done, next_due, notes), a cron hook that flips next_due dates, a UI card on KitDetail, and an email reminder.

### 2 — Public QR scan landing page (P0-3)

**Why this wins:** Kit Tracker invested in QR labels and bulk print, but scanning today lands on `/login`, which is useless. A public landing page with `kit name / current holder / tags / public notes / "contact owner" button` makes every printed label suddenly useful: a customer can confirm what they received, a courier can confirm the right kit, a stranger who finds it on a train can return it. This is the single feature that turns a printed QR into a real-world artefact. Effort is modest (one new route + a PB rule).

**Effort:** M. New unauthenticated route, a `public_view_token` field on kits (signed or random nonce baked into the QR URL), and a stripped-down KitDetail UI.

### 3 — Bulk select + bulk actions on /kits and /entities (P0-4)

**Why this wins:** Every user with >50 kits hits this wall. "Tag these 30 kits as 'Q3 deployment'", "transfer these 12 kits to storage", "export the selected 200 as CSV". This is the single UX gap that separates a hobby tool from a tool you can use at scale, and it is well-defined work. Bulk transfer is the only piece with real risk (must preserve transaction atomicity per kit), but the pattern is already proven in `fulfillRequest`.

**Effort:** M. Checkbox column on list views, an action bar that appears when ≥1 row is selected, server logic that iterates per-kit and reports per-kit success/failure.

**Why not the others first?**
- Maintenance schedules + QR landing + bulk actions together represent ~3 weeks of work, fit one focused milestone, and produce a coherent demo: "calibration-tracked lab kits, scannable for non-users, manageable at scale".
- Slack webhooks (P1-1) are tempting but only relevant once there is a team using it day-to-day — defer until usage justifies it.
- Pagination + search (P1-2) is a performance investment that only matters at scale we don't have yet — schedule when the first user reports list slowness.
- Dark mode / shortcuts (P1-7, P1-8) are polish — quarter-end spillover if time allows.

---

## Appendix — 3–6 month strategic direction

By August 2026, Kit Tracker should be:

1. **Adopted by ≥3 external self-hosters** with a documented setup story (one-command Docker, env-var-driven OAuth, optional managed-hosting waitlist)
2. **Demonstrating the audit / compliance pitch** — append-only, gap-free audit log, retention policy doc, restore drill documented
3. **Mobile-first for field use** — PWA installable, camera capture for photos, public QR scan landing
4. **Differentiated** — components-within-kits + entity-typed movement marketed as the wedge, not buried in the changelog
5. **Backed by a real test suite** — hook integration tests + Playwright smoke + container-e2e; pre-push gate keeps regressions out

What to **not** do in this horizon:

- Build a custom-fields engine (Shelf already does this; chase persona, not feature parity)
- Build native iOS / Android (PWA is enough until usage justifies the cost)
- Build multi-tenancy (a single PB instance per tenant is fine for self-host; multi-tenant is a SaaS-only problem and SaaS is post-this-horizon)
- Build SAML / SCIM (enterprise table-stakes; not needed for the persona we're chasing yet)
