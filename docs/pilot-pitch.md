# Kit Tracker — Pilot Pitch

**Who it's for:** Field-service and IT-ops teams managing physical kit (hardware,
equipment, components) across multiple customer sites or internal labs — where "where
is the kit right now?" costs 10 minutes on a good day and a missed SLA on a bad one.

---

## The problem

Field techs don't open web apps mid-shift. Excel sheets don't capture the actual move
moment. By the time admin asks "where's KIT-007?", the answer is buried in three Slack
channels, a photo of a handwritten label, and one person's memory. End-of-quarter
reporting means a manual reconciliation that no one wants to own.

---

## The pitch

Tech sends a Telegram slash command: `/move KIT-007 ACME-LAB`

Move is logged immediately with a full audit trail — who, when, from where, to where,
via which channel. No confirmation prompt. No app to open.

Admin opens the web UI, pulls up KIT-007's timeline, filters audit log by `via=tg-command`,
exports CSV for the quarterly business review. No Slack archaeology required.

---

## What's in the pilot

- **Telegram slash commands** — tech types `/move`, `/kit`, `/find`, `/request` in the
  Telegram bot; writes execute immediately and are logged; read queries reply in seconds
- **Web admin — kit timeline** — every transaction in chronological order with source badge
  (Telegram, web, AI agent)
- **Audit filter + CSV export** — filter by source, date range, entity; one-click CSV per
  kit for QBR or compliance
- **Serial/entity resolution** — exact match with clear "not found" and "ambiguous" errors;
  no silent wrong moves
- **Append-only audit trail** — transactions are never edited or deleted; every move is
  permanent record (GDPR note: records can be hard-deleted by admin only, with a cascade
  preview and explicit confirmation)
- **Admin cascade hard-delete** — for genuine corrections (wrong record, test data); shows
  exactly what will be removed, requires typed-name confirmation, logs an audit row before
  cascade executes
- **Security baselines** — denied/removed users are force-logged-out on next request;
  Telegram commands are role-gated (viewer role blocked); admin-only endpoints enforced
  server-side; audit row written before any cascade so the action is traceable even on failure
- **Per-product component model** — products can hold serialized components (individual
  serial per item) or bulk components (quantity-tracked); kit contents are inspectable
  from the kit detail page

---

## What's NOT in the pilot (yet)

- **Daily automated backup** — snapshots are manual (`bash scripts/backup-pb-data.sh`);
  automated schedule is on the roadmap
- **Public QR scan landing** — scan a label → open kit detail page; designed but not
  shipped in this sprint
- **Maintenance schedule UX rebuild** — data model exists; the scheduling interface needs
  a proper rebuild before it's usable
- **Component reorder points / low-stock alerts** — bulk components track quantity but
  don't alert when stock drops below a threshold; that alert layer is not yet built

---

## The ask

- **Duration:** 1-2 weeks
- **Team:** 3-5 field techs + 1 admin / ops lead
- **Kickoff:** 30-minute call to walk through the Telegram linking flow, show the web UI,
  and answer questions
- **Check-in:** 15 minutes weekly to unblock and capture friction
- **End of pilot:** Honest assessment — what worked, what didn't, whether it's worth
  moving to a long-term deployment

No commitment beyond the two weeks. No contract. Feedback is the exchange.

---

## Stack + cost

- **Hosting:** Self-hostable on a $5/mo Fly.io machine (1 shared CPU, 256MB RAM, 1GB
  SQLite volume). No Kubernetes. One binary.
- **Telegram bot:** Free. No sandbox-to-production migration — the same bot token works
  from day one. No per-message fees.
- **AI (web sidebar + MCP only):** Anthropic Claude API — not on the slash-command path;
  used only for the in-app chat assistant and MCP tools. At expected pilot volume cost is
  well under $10/mo.
- **Total pilot cost:** ~$5/mo hosting. That's it.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Bot token compromised** | Rotate via @BotFather (`/revoke`) + update Fly secret — takes effect immediately |
| **No automated daily backup** | Run `bash scripts/backup-pb-data.sh` manually each day during pilot |

---

## Next steps

1. Approve pilot → I deploy a dedicated instance under
   `<your-name>.kit-tracker.com` or `kit-tracker-<your-name>.fly.dev`
2. Share `docs/pilot-onboarding.md` with techs (step-by-step: link Telegram, try a move,
   check the web UI)
3. Schedule 30-minute kickoff call
4. After 1-2 weeks: debrief call, decide on long-term hosting

Reply to this doc or email to kick it off.
