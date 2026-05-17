# Kit Tracker — 4-Week Pilot-Ready Roadmap

Status: **APPROVED — ready for implementation plan**
Date: 2026-05-16
Owner: hadassi
Supersedes: ROADMAP.md (uncommitted draft, 2026-05-12)

---

## 1. Context + decisions

### What's already shipped (since the 2026-05-12 ROADMAP draft, 116 commits)

| Area | Status |
|---|---|
| Audit log security hardening (delete/superadmin coverage) | Shipped (b85faa0, 7ce6818) |
| Soft-delete + active-unique compliance sweep | Shipped (5cb9530, f5b63f3, 3a2cc3b, e9c513a) |
| AI Phase 2C writes (update_entity/kit/product) + 5 report tools | Shipped (4c9bec2, bbc4239) |
| MCP server (20 tools, JSON-RPC) | Shipped (`pb/pb_hooks/ai_mcp.pb.js`) |
| WhatsApp Phase A (inbound webhook) + Phase B (confirm flow, sig verify, multi-msg, idempotency) | Shipped (4b9a09a, 848a918, b62d971, 9d8beaf, 51042b1) |
| Entity category (storage/field) | Shipped (7876554) |
| Per-kit calendar + on-call calendar | Shipped (5db8f70, 0caf04b, e4ffada) |
| Attachment MIME whitelist | Shipped (migration 1778599044) |
| Maintenance schema + on-call shifts schema | Shipped (migrations 1778615063, 1778615380) |

### What this roadmap decides

- **Goal:** consolidate + ship to a real pilot team
- **Pilot persona:** field-service / IT ops team (kits ship to customer sites, return to warehouse)
- **Pilot status:** interested-not-committed → need polish before pitch
- **Primary surface:** **WhatsApp bot** (sandbox), web is admin oversight only
- **No approval gate:** technician initiates `move_kit` directly via WA, admin sees log
- **Twilio plan:** sandbox for pilot (join-code OK for small known team); production deferred post-commit
- **Timeline:** 4 weeks, fix-only sprint
- **Ops hardening:** deferred (pilot tolerates rough ops; documented as risk)

---

## 2. Wedge

The single workflow that must work end-to-end, mobile-first via WhatsApp, with full audit trail visible to admin on web.

### Flow

1. **Intake.** Tech receives a kit at warehouse. Kit already exists in PB with QR sticker printed.
2. **Outbound.** Tech sends WhatsApp message: `move DEMO-KIT-005 to ACME-LAB`. Bot replies with confirmation summary. Tech replies `YES` within 30s. Bot calls `move_kit`, replies done + link. `transactions` row created with `created_by = tech` and `audit_log.changes.via = "wa-bot"`. (Current code may tag as `"ai-agent"` since WA proxies through `ai_chat.pb.js`; W1/D14 verifies + patches `wa_inbound.pb.js` to override `via` to `"wa-bot"` after the proxied call.)
3. **Field life.** Kit sits at customer entity. No bot interaction needed.
4. **Return.** Tech sends `return DEMO-KIT-005` (or `move DEMO-KIT-005 to Warehouse`). Same confirm flow. Bot moves kit to default warehouse entity.
5. **Audit closed.** Admin opens web `/kits/:id` → sees full timeline with "moved via WhatsApp by +972…" per transaction. Filters audit log by `via=wa-bot`. Exports CSV.

### Personas

- **Technician** — WhatsApp primary, no web access required
- **Admin** — Web desktop primary, oversight + audit + export
- **(No public/customer scan in pilot scope)**

### In-scope surface

- `pb/pb_hooks/wa_inbound.pb.js` — confirm flow correctness
- `pb/pb_hooks/ai_chat.pb.js` — `toolsUsed` field return
- `pb/pb_hooks/audit_log.pb.js` — `via=wa-bot` source tag
- `frontend/src/pages/AuditLogPage.tsx` — filter by `via` source
- `frontend/src/pages/KitDetailPage.tsx` — timeline shows WA origin + Deactivate button
- `scripts/seed_demo_data.mjs` — field-service-flavored seed
- `README.md` — pilot pitch + setup
- New: `docs/pilot-onboarding.md` — WA sandbox join + command cheat-sheet
- New: `docs/pilot-runbook.md` — Fly deploy + Twilio sandbox setup + escalation

### Out of scope (defer post-pilot)

- Public QR scan landing page
- Requests workflow polish (UX bugs known, not in wedge)
- Components / products catalog UX
- Maintenance schedule UX rebuild
- Calibration cron
- On-call rotation editing
- Web AI chat UX improvements
- Bulk select / bulk actions
- Server-side pagination
- Stats / sparklines polish
- Dark mode
- Bin codes / BOM templates / reorder points
- Hook unit tests
- PB SDK upgrade to 0.22.x
- Type generation from PB schema
- `KitDetailPage.tsx` 638-line refactor
- Daily backup cron + monitoring + Sentry (ops hardening — user accepted risk)
- Twilio production number + template approval

---

## 3. 4-week sprint plan

### Week 1 — WhatsApp wedge correctness

| Day | Task | Done when |
|---|---|---|
| D1-2 | Verify Phase B confirm flow on sandbox: `move_kit`, `move_component`, all write tools. Verify `ai_chat.pb.js` returns `toolsUsed` array. Fix if not (`wa_inbound.pb.js:detectWriteTool` depends on it — flagged in source comments) | Three live tests: move kit, fail to confirm, double-YES, all behave per spec |
| D3 | Idempotency stress: re-send same `MessageSid` within 1h → no duplicate; send conflicting commands → most recent wins; double-YES → only first executes | E2E or scripted curl test green |
| D4 | "Return" natural-language coverage. Test: `return X`, `send back X`, `X is back`. If AI fails to map, add explicit intent shortcut: `return <serial>` → `move_kit(<serial>, <DEFAULT_WAREHOUSE_ENTITY>)`. Default warehouse = env var `DEFAULT_WAREHOUSE_ENTITY_ID` (Fly secret), resolved at hook init | All three phrasings move kit to default warehouse |
| D5 | Write `docs/pilot-onboarding.md` — sandbox join-code, command cheat-sheet (5-10 examples), FAQ ("what if I don't get YES prompt", "what if I YES too late") | Doc committed, reviewed |

### Week 2 — Admin web oversight polish

| Day | Task | Done when |
|---|---|---|
| D6-7 | `/audit` filter by `changes.via`. Dropdown: all / web / wa-bot / ai-agent / mcp. Search by kit serial + actor phone | Filter works on 100+ row dataset, UI responsive |
| D8-9 | `/kits/:id` timeline — each transaction surfaces origin badge ("WhatsApp +972…" / "Web by admin@…"). Mobile-responsive verified | Three transactions of different origins display correctly on desktop + 375px viewport |
| D10 | CSV export of single-kit timeline. One button on `/kits/:id` Actions card. No N+1 fetch | Click → CSV downloads with full audit columns |

### Week 3 — Bug sweep + security

| Day | Task | Done when |
|---|---|---|
| D11 | **U-01** denied-bypass mid-session fix. `RequireRole` + `Layout` treat `role="denied"` as `hasRole=false`. Realtime subscription forces logout if role changes to "denied". Add e2e | Manual repro: admin denies user mid-session → user redirected to login within 5s |
| D12 | **B-B6-1** add Deactivate button to `/kits/:id` Actions card. Soft-delete via `is_active=false`. Confirm dialog | Button visible to admin, click → kit removed from default list, restorable via PB admin |
| D13 | WA-flow bugs surfaced in W1 (one buffer day) | All W1 regressions resolved |
| D14 | Verify `audit_log.pb.js` writes `via=wa-bot` on every WA-initiated move. Patch if missing | Live test: WA move → audit row has `changes.via="wa-bot"` and actor phone in metadata |
| D15 | Buffer / overflow | — |

### Week 4 — Pilot-ready

| Day | Task | Done when |
|---|---|---|
| D16-17 | Rebuild `scripts/seed_demo_data.mjs` field-service flavor: 1 warehouse entity, 3 customer entities, 5 technicians (one with `phone` seeded for WA), 20 kits in mixed states (5 intake / 10 at-customer / 3 returning / 2 retired) | Fresh seed → demo flow runs end-to-end |
| D18 | README rewrite. Lead paragraph: "WhatsApp-based kit tracker for field-service ops — log moves from your phone, audit from your desk". Three screenshots: WA move, web timeline, audit filter | README renders cleanly, screenshots embedded |
| D19 | `docs/pilot-runbook.md` — Fly deploy, Twilio sandbox setup, pilot user creation, escalation contacts, known-issues list | Runbook executes successfully against a fresh Fly app + Twilio sandbox |
| D20 | Pitch one-pager (`docs/pilot-pitch.md`) + 30-second screen recording of WA flow → admin timeline. Both ready to send | Materials ready for pilot pitch |

---

## 4. Bugs in scope

### P0 (must fix this sprint)

| ID | Source | Description | Fix in |
|---|---|---|---|
| U-01 | puppet user findings | Denied users bypass `RequireRole` mid-session because `role="denied"` is truthy. PB listRules `role != ""` also pass. Security. | D11 |
| WA-confirm | wa_inbound.pb.js source comment | `detectWriteTool` reads `parsedAi.toolsUsed` but `ai_chat.pb.js` did not return it — post-hoc telemetry path silently broken. Real gate is the **pre-flight write-intent regex** added in b62d971 (`wa_inbound.pb.js` checks inbound text BEFORE calling ai_chat). The `toolsUsed` field is defense-in-depth for cases the regex misses; fixed in 93adc5d so consumer can read it. Note: by the time ai_chat returns, write has already executed — `toolsUsed` is for audit/detection, not gating. | D1-2 (fix shipped) |

### P1 (fix if it touches wedge)

| ID | Source | Description | Fix in |
|---|---|---|---|
| B-B6-1 | puppet admin findings | No Deactivate button on `/kits/:id`, only hard Delete | D12 |
| Audit-via-tag | self | Verify `via=wa-bot` is written; admin filter depends on it | D14 |
| RETURN intent | self | "return X" may not map to `move_kit` without explicit shortcut | D4 |

### Deferred (explicit, named, post-pilot)

| ID | Source | Reason for defer |
|---|---|---|
| B-C3-1 | puppet admin | "Save & Fulfill" misleading label — requests not in wedge |
| B-E1-1 | puppet admin | `kms_type` silently dropped — maintenance not in wedge |
| B-G1-1 | puppet admin | AI read-tool intermittent failure (admin only) — flaky, web AI not pilot-critical |
| U-02 | puppet user | Non-deterministic on-call sort — on-call read OK, editing not in wedge |
| B-V-1 / B-V-2 | puppet viewer | AI UX nits — web AI not pilot-critical |
| B-T-1 | puppet tech | Duplicate serial allowed by design (migration 1778880000) — known design choice, may revisit |
| OAuth client_secret in repo root | ROADMAP P2 | Security — rotate as separate task, but defer roadmap-level inclusion |

---

## 5. Definition of "pilot-ready"

Sprint is done when **all** of:

1. A new tech joins WA sandbox, sends `move <serial> to <entity>`, gets confirm prompt, replies `YES`, sees confirmation. Kit moved. No undocumented surprises.
2. Tech sends `return <serial>` (or any of three natural phrasings). Kit moves to default warehouse.
3. Admin opens web, filters audit log by `via=wa-bot`, sees the moves with actor phone + timestamp. Exports CSV.
4. Admin opens `/kits/:id`, sees full timeline with origin badges per transaction.
5. Admin can Deactivate a kit from the detail page.
6. Denied users cannot access the app mid-session (security).
7. `docs/pilot-onboarding.md`, `docs/pilot-runbook.md`, `docs/pilot-pitch.md` all merged.
8. Demo seed produces a state matching the pitch screenshots.
9. README rewritten with WA-first pitch + 3 screenshots.

If any of 1-6 fails, sprint is not done. Items 7-9 may slip by 2-3 days but block pitch.

---

## 6. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Twilio sandbox per-user join-code is a real friction for pilot team | Medium | Medium | `docs/pilot-onboarding.md` walks through join in ≤2 min. If pilot pushes back, fast-track production approval (1-2 weeks extra) |
| Phase B confirm flow has latent bug (detectWriteTool / toolsUsed mismatch) hiding behind happy-path tests | High | High | D1-2 verifies first — if broken, fix early. If can't fix in W1, fall back to "no confirm, all writes immediate" with explicit warning in cheat-sheet |
| Pilot uses kit serials with spaces / special chars that bot can't parse | Medium | Medium | Test in W1 with weird serials. Document allowed chars in onboarding |
| Twilio sandbox sends from shared number — looks unprofessional | Medium | Low | Onboarding doc explains; if dealbreaker, fast-track production |
| Ops hardening deferred (no backup cron, no monitoring) — if pilot's first week has data loss, trust gone | Low (4 weeks) | Critical | Manual `scripts/backup-pb-data.sh` run daily by hadassi during pilot. Add cron post-commit |
| AI hallucination on entity resolve — moves kit to wrong "lab" when two labs exist | Medium | High | Already mitigated by puppet G6 (asks disambiguation). Re-verify in W1 with two same-name entities |
| Solo dev hits sick day / blocker mid-sprint | Medium | Medium | Buffer day D15. Out-of-scope list deliberately conservative |
| User expectations creep ("can we add maintenance reminders too?") | High | Medium | Show this doc, point at out-of-scope list. Anything not in section 2 is post-pilot |

---

## 7. What this does NOT decide

- **Post-pilot roadmap.** Once pilot commits, the next 8-12 week plan likely includes: Twilio production migration, ops hardening (backup cron + Sentry + UptimeRobot), maintenance UX rebuild, public QR landing, bulk actions. Out of scope here.
- **Monetization.** Stays self-host OSS. Managed tier deferred per original ROADMAP guidance.
- **Pricing for the pilot.** Free / informal. Negotiate post-commit.

---

## 8. Implementation handoff

Next step: invoke `superpowers:writing-plans` to break this spec into a day-by-day implementation plan with concrete tasks, agent dispatches, and verification commands. Execution will use parallel agent dispatch (`superpowers:dispatching-parallel-agents`) where work is independent — likely candidates: bug fixes (W3) and doc writes (W4) can run parallel to feature work.

Critical path: W1 verification → W2 admin polish → W3 security → W4 packaging. Buffer at D15.
