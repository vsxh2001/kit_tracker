# Telegram bot → deterministic slash-command app interface

**Date:** 2026-05-30
**Status:** Design — awaiting user approval before plan/implementation
**Supersedes:** the messaging/cron portions of `docs/telegram-migration-spec.md` (Phases 1, 7b, 7c). The identity-linking (Phase 2/4) and event-notification (Phase 6, minus escalation) portions remain.

## 1. Motivation

The Telegram bot's value is a **simple, deterministic interface to the kit-tracker app** — users issue slash commands to look up kit status and perform gated operations from chat. The original "cron message in a group" framing (digests, broadcasts, scheduled sends) is dropped. Open-ended AI Q&A over Telegram is also dropped (the AI engine `ai_chat.pb.js` stays for MCP + WhatsApp).

A specific high-value flow: **`/kit <serial>` must show the products contained in the kit** (e.g. a mat), derived generally from the data model — never hardcoded to a product type.

## 2. User decisions (confirmed 2026-05-30)

1. **Command set:** read + full gated writes.
2. **Writes via bot:** yes, now, role-gated (admin/technician; user-role for `/request`).
3. **AI role:** dropped from the Telegram path. Unknown/free-text → `Unknown command — try /help`.
4. **Cron features:** removed (group digest, broadcast, scheduled sends + the broadcast admin page).
5. **Notifications:** keep event-driven per-user notifs (request_fulfilled / request_pending / kit_moved); **cut** the time-based escalation cron's Telegram branch.
6. **`/kit` default view:** tracked products only (presence check); full contents via `/kit <serial> all`.
7. **Products of interest:** marked by a new boolean flag `products.track_in_status` (default false), toggled by admins in the product dialog. General — flag any product; the mat is just the first one flagged. No product-type hardcoding anywhere.

## 3. Architecture

Telegram delivers all inbound updates to one webhook (`POST /api/tg/webhook`), so all command routing lives in **`pb/pb_hooks/tg_webhook.pb.js`**. PB v0.22 Goja isolation: every helper is defined **inside** the `routerAdd` callback (no file-scope helpers, no cross-file import — `ai_chat.pb.js` executors are NOT reachable; queries are reimplemented inline).

### Dispatch order inside the callback
1. Secret-token verification (`X-Telegram-Bot-Api-Secret-Token`) — unchanged.
2. Extract `chatId` + `text`; ignore non-text / missing message (200 no-op) — unchanged.
3. `/start <code>` and bare `/start` — unchanged (account linking).
4. **New:** parse `cmd = first token lowercased`. `switch(cmd)` → command handler.
5. Default (unknown command, or text not starting with `/`) → `Unknown command — try /help`. **No AI call.**

Every non-`/start` command first **resolves the linked user** from `telegram_chat_id` (the existing Phase 5 resolution: filter `users` by `telegram_chat_id`, hard-stop on 0 or >1 matches, role-gate). Read commands require an approved role (non-empty, not `denied`); write commands require the specific role below.

### Command table

| Command | Args | Behaviour | Min role |
|---|---|---|---|
| `/help` | — | role-aware command list | linked |
| `/me` | — | name · email · role · linked chat id | linked |
| `/kits` | — | active kits + current holder (≤ N, note if truncated) | approved |
| `/kit <serial>` | serial | holder · notes · last move · **tracked products** (see §4) | approved |
| `/kit <serial> all` | serial + `all` | as above + full contents list | approved |
| `/requests` | — | open requests, each with a short handle (§5) | approved |
| `/find <text>` | text | fuzzy match active kits (serial/notes) + entities (name) | approved |
| `/move <kit> <entity>` | serial, entity name | append a kit transaction → entity | admin/technician |
| `/approve <h>` | request handle | set request status `approved` | admin/technician |
| `/reject <h>` | request handle | set request status `rejected` | admin/technician |
| `/request <kit> <entity> [YYYY-MM-DD]` | serial, entity, opt date | open a request | approved (user+) |

"approved" = role non-empty and not `denied`. Unknown role / awaiting approval → the existing awaiting-approval reply.

## 4. `/kit` — tracked products (default) + full contents (`all`)

A kit's contents are **derived**, not stored. Base derivation (mirrors `frontend/src/services/componentTransactions.ts::listComponentsInKit`):

1. Active components: `components` where `is_active = true`, `expand = product`.
2. For each, its **latest** `component_transactions` row (sort `-timestamp,-created`, limit 1).
3. Keep components whose latest transaction has `to_kit === kitId` (not subsequently moved to an entity). These are the kit's **contents**.

### `products.track_in_status` — the "of interest" flag (general, no hardcoding)

New boolean field `products.track_in_status` (default `false`), set by admins. A product flagged `true` is "of interest" and surfaced as a **presence check** in `/kit`. The mat is simply the first product flagged; nothing in code references "mat", a category, or a product name — generality is preserved because the *only* predicate is the boolean flag itself.

### Default `/kit <serial>` — Tracked section
For every product with `track_in_status = true`, compute its quantity **in this kit** from the contents set (sum `quantity` for bulk components of that product, count instances for serialized). Render presence:
- present → `<product.name> ✓ ×<qty>`
- absent → `<product.name> ✗ missing`

```
Kit FOO-01 — @ Warehouse
Tracked:
 • Mat ✓ ×1
(/kit FOO-01 all for full contents)
```
If no products are flagged → `Tracked: (none configured)`. The `✗ missing` line is the headline value: at a glance, does this kit still have its mat?

### `/kit <serial> all` — full contents
Same header + Tracked section, then the full flat contents list, one line per contained component:
```
Contents:
 • Mat ×1
 • Drill ·SN123
 • Cable ×5
```
- serialized → `·SN<serial>`, bulk → `×<quantity>`, neither → bare `product.name`.
- empty kit → `Contents: (empty)`.

**Generality guarantee:** tracked = `products.track_in_status === true`; contents query filters only on `to_kit` + `is_active`. No `=== "mat"`, no category filter, no removed `type` field. Category grouping of contents is a later, still-general enhancement.

**Side benefit (out of scope, follow-up issue):** the AI `get_kit` executor (`ai_chat.pb.js`) filters a non-existent `components.kit` field, so its `active_components` is always empty. The Telegram command implements the correct derivation independently.

## 5. Request handles for `/approve` / `/reject` / `/requests`

Requests have no human-facing number. `/requests` renders each open request with a **short handle = last 6 chars of the record id**, plus requester + kit + delivery date. `/approve <handle>` / `/reject <handle>` resolve by matching the id **suffix** among open requests; **ambiguous suffix (>1 match) → hard-stop error**, 0 matches → "not found". Decisions set `status` (+ optional trailing `decision_notes` text) mirroring `frontend/src/services/requests.ts::decideRequest`. Server rules already gate updates (admin OR owner&open); the command additionally requires admin/technician.

## 6. Writes — execution + audit

Write commands execute directly via `$app.dao()` inside the hook (privileged), setting ownership fields explicitly:
- `/move`: create a `transactions` row `{ kit, from_entity: <current holder or empty>, to_entity, timestamp: now, created_by: user.id }`. Current holder derived from the kit's latest transaction.
- `/request`: create a `requests` row `{ requester: user.id, date: now, delivery_date: <arg or today>, status: "open", designated_kit: <kit>, target_entity: <entity> }`. `delivery_date` is **required** in schema → default to today (UTC date) when the optional arg is omitted.
- `/approve` / `/reject`: patch the request `status` (+ `decision_notes` if trailing text).

Each write writes an `audit_log` row: `actor = user.id` (**required** relation — see `project_audit_log_actor_required`), `changes.via = "tg-command"`, action = the existing enum value for that op. v1 executes immediately (no inline-keyboard confirmation); transactions are append-only, so a wrong `/move` is corrected with another `/move`. Reply states exactly what happened (`Moved FOO-01 → Warehouse`).

**Resolution rules:** kit by exact `serial` (active); entity by exact `name` (active), case-insensitive; ambiguous/none → clear error, no mutation. No fuzzy resolution on writes (fuzzy is `/find` only) to avoid acting on the wrong record.

## 7. Command menu (`setMyCommands`)

Add `scripts/tg-set-commands.sh` — calls `https://api.telegram.org/bot<TOKEN>/setMyCommands` with the read+write command list so Telegram shows the menu. One-time operator run (reads `TELEGRAM_BOT_TOKEN` from env/arg). v1 uses a single global command scope; per-role scoped menus are a later enhancement.

## 8. Removals (scope-cut)

**Delete:**
- `pb/pb_hooks/tg_group_digest.pb.js` (daily group digest cron + `/api/tg/digest/run`).
- `pb/pb_hooks/tg_broadcast.pb.js` (`/api/tg/broadcast`).
- Telegram path in any scheduled-broadcast hook (the `scheduled_broadcasts` TG branch, if present); leave the WhatsApp scheduled path untouched (WhatsApp is removed separately in migration Phase 9).
- `frontend/src/pages/TelegramBroadcastPage.tsx` + its route + nav link.
- The Telegram **escalation** branch in `pb/pb_hooks/wa_approval_escalation_cron.pb.js` (stop sending escalation over Telegram). The WhatsApp escalation logic + the #185 audit-actor fix stay.

**Keep:**
- `tg_webhook.pb.js` (now the command router), `tg_link.pb.js` (linking), `tg_status.pb.js` + `/settings/telegram` (webhook/linked-count health — useful for a command bot).
- `wa_meta_auto_notify.pb.js` event notifs: `request_fulfilled` / `request_pending` / `kit_moved` Telegram branches.
- `ai_chat.pb.js` + `ai_mcp.pb.js` (MCP + WhatsApp consumers) — only the `tg_webhook → /api/ai/chat` call is removed.
- CLAUDE.md docs: prune the digest/broadcast/AI-bot Telegram sections; add the command reference.

## 9. Phasing (one PR each, reviewer-gated, CI hook-tests is the authoritative test gate)

- **P0 — `track_in_status` flag:** migration adding `products.track_in_status` (bool, default false) via `pb/pb_migrations/`; `products` type + service updated. Admin toggle UI: add a checkbox to the existing product create/edit dialog **if one exists** (plan phase confirms the file); if products have no dedicated edit dialog, expose the flag wherever products are managed (e.g. the components/product surface) and rely on the existing `update_product` MCP/AI tool as the interim admin path. Small, independent (db-engineer + frontend). Lands before P1 so `/kit` can read the flag. CI: migration applies clean, build green, a `@smoke` create-flow still passes.
- **P1 — read commands + `/kit` tracked/all:** dispatch refactor; `/help /me /kits /kit /kit … all /requests /find`; remove the AI fallback; `setMyCommands` script. Hook tests assert each command's reply for seeded data, incl. a kit containing a flagged product (tracked ✓/✗ presence) and the `all` full list. (Highest value.)
- **P2 — gated writes:** `/move /approve /reject /request` with role gates + audit (`via:"tg-command"`, `actor` set). Hook tests assert: gate rejects non-role, happy-path mutates + writes audit row, ambiguous resolution hard-stops, write audit `actor` present (the swallow-trap).
- **P3 — removals:** delete digest/broadcast/scheduled-TG + broadcast page + nav; cut TG escalation branch; prune CLAUDE.md. `_smoke.test.js` still green; no dangling routes/imports; `npm run build` clean.

Each phase: worktree → implementer → reviewer (devil's advocate) → push → PR → CI hook-tests + build + e2e → merge squash. Hook callbacks keep all helpers inlined (Goja). Local hook tests can't boot PB on this host (inotify exhausted) → CI `hook-tests` is the gate.

## 10. Non-goals (YAGNI)

- No inline-keyboard confirmations (v1 executes + reports).
- No per-role `setMyCommands` scopes.
- No category grouping of the `/kit … all` contents list (flat list).
- No fix of the unrelated `get_kit` AI executor bug (follow-up issue).
- No removal of WhatsApp paths (separate migration Phase 9).
- One additive migration only (`products.track_in_status` bool). No new collections; kit contents still derive from existing `component_transactions`.
