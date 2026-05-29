# Migration Spec: WhatsApp (Meta Cloud API + Twilio) → Telegram

**Status:** Draft for build kickoff
**Foundation already shipped:** Phase 1 (PR #173, commit `c820183`) — `pb/pb_hooks/tg_group_digest.pb.js` (group digest cron + `POST /api/tg/digest/run` manual/dry-run trigger) + `tests/hooks/tg_group_digest.test.js`. Env vars `TELEGRAM_BOT_TOKEN` / `TELEGRAM_GROUP_CHAT_ID` and the skip-silently pattern are established. **Do not re-plan Phase 1.**
**Hard rule:** Keep every WhatsApp hook running in parallel until Telegram is proven in prod. WA hooks are deleted only in the final deprecation phase.

---

## DECISIONS NEEDED FROM USER (blocks autonomous building)

These 4 product/UX choices gate Phase 3+. Phase 2 (the `users.telegram_chat_id` migration) can proceed regardless.

1. **Identity linking flow — which one?** Telegram has no phone field; we cannot reuse `users.phone`. Pick the binding mechanism for connecting a Telegram account to a kit_tracker user:
   - **(A)** User DMs the bot `/start <one-time-code>`, code generated in the web app. *(Recommended — secure, self-service, no admin toil.)*
   - **(B)** Admin pastes a user's `chat_id` into the Users page manually. *(Fast for staff bootstrap; doesn't scale.)*
   - **(C)** Both: admin fast-path for staff + `/start` code for self-service.

   **Question:** Do we build (A), (B), or (C)? (Recommendation: C — ship B in Phase 2 for staff, A in Phase 4.)

2. **Parallel-run vs hard-switch.** The safe path runs WhatsApp and Telegram side-by-side for a proving period, with a per-event channel preference. **Question:** Do you want a parallel-run period (recommended, ~2 weeks), or a hard cutover on a chosen date with WA removed immediately?

3. **Group digest vs per-user 1:1 notifications.** Phase 1 already delivers a *group* digest (one chat, `TELEGRAM_GROUP_CHAT_ID`). The WhatsApp system also does *per-user 1:1* transactional notifications (request fulfilled, kit moved, escalation). **Question:** Should the Telegram group digest **replace** per-user 1:1 notifications (simpler, one chat, no linking needed for notifications), or **supplement** them (we still build per-user 1:1, requiring the identity work in Phase 2–4)?
   - If **replace**: Phases 4/6 (per-user notify + auto-notify) shrink dramatically or drop. Identity linking is only needed for the *inbound bot* (Phase 5), not notifications.
   - If **supplement**: full identity + per-user routing is required.

4. **Keep email notifications?** `request_created_notify.pb.js` and `user_signup_notify.pb.js` are **email-only and transport-agnostic** — they are unaffected by this migration. **Question:** Confirm we keep SMTP email exactly as-is (recommended; they don't touch WA at all), so we never need to re-implement those paths.

---

## 1. Architecture Summary

### Transport-agnostic / reusable as-is (no Telegram rewrite)
- **`pb/pb_hooks/ai_chat.pb.js`** — the AI tool-use loop is the crown jewel. It accepts `message + sessionId + user auth token` and returns `reply + undo token`. It knows nothing about WhatsApp. **100% reusable** behind any transport. The Telegram inbound webhook just resolves identity, then POSTs to `/api/ai/chat` exactly like the WA webhooks do today.
- **`pb/pb_hooks/ai_mcp.pb.js`** — MCP server, unrelated to messaging transport. Untouched.
- **All 26 AI tools** (14 read / 12 write), including the 11 role-gated write tools and the 60s undo path. Untouched.
- **Email notifications** — `request_created_notify.pb.js`, `user_signup_notify.pb.js` are SMTP-only and never call Meta. Untouched (pending Decision #4).
- **On-call routing** — `on_call_shifts` lookup logic inside the notify/escalation hooks is transport-neutral; only the *delivery call* changes.
- **Scheduled-broadcast data model** — `scheduledBroadcasts.ts` service + cron loop logic translate directly (recipient field changes, loop structure identical).
- **Preference schema** — `1779700000_users_add_notification_prefs.js` (`prefs.channels`, `prefs.events.*`, `prefs.quiet_hours`) needs only a new value `'telegram'` in the `channels` array; **no structural migration**.

### WhatsApp-specific — must be re-implemented for Telegram
| WA concern | Telegram replacement |
|---|---|
| Identity = `users.phone` (E.164) | Identity = `users.telegram_chat_id` (numeric string) + a binding flow |
| HMAC-SHA256 (`X-Hub-Signature-256`) / HMAC-SHA1 (Twilio) signature verify | `X-Telegram-Bot-Api-Secret-Token` header equality check (set on `setWebhook`) |
| Inbound `POST /api/wa/meta/webhook` + `/api/wa/webhook` (`wa_meta_webhook.pb.js`, `wa_inbound.pb.js`) | New `POST /api/tg/webhook` |
| Outbound `graph.facebook.com/v18.0` Bearer call (`wa_meta_send.pb.js`, `wa_meta_broadcast.pb.js`) | `api.telegram.org/bot<TOKEN>/sendMessage` JSON `{chat_id, text, parse_mode}` |
| 1500-char multipart split + `formatForWA` markdown | 4096-char split (same algorithm, new constant) + Telegram MarkdownV2/HTML |
| Auto-notify Meta POST (`wa_meta_auto_notify.pb.js`) | `sendMessage` to user's `telegram_chat_id` |
| Escalation cron Meta batch (`wa_approval_escalation_cron.pb.js`) | `sendMessage` to admin `telegram_chat_id`s; on-call logic unchanged |
| Short-id approval via text-reply parsing | Telegram inline keyboard / `callback_query` (cleaner) |
| Frontend pages under `/settings/whatsapp/*` | New `/settings/telegram/*` (settings + broadcast + scheduled + conversations) |

### Becomes unnecessary under Telegram (do NOT port)
- **Template management** — `wa_meta_templates.pb.js`, `SubmitTemplateDialog.tsx`, `WhatsAppTemplatesPage.tsx`. Telegram has no pre-approval template workflow; all messages are free-form. **Drop entirely.**
- **Token-expiry health** — `whatsapp_token_health.pb.js`, `services/health.ts` token banner, the `ok→warn14→warn7→warn1→expired→never→missing` ladder. BotFather tokens **do not expire**. Collapses to a simple valid/invalid check via `getMe()`. **Drop the expiry machinery; keep a thin validity probe.**
- **24h service window / template-fallback on error 131047** — Telegram has no 24h window; proactive `sendMessage` to a linked `chat_id` works anytime. **Drop all window-gating logic.**
- **WABA subscription introspection** — `WHATSAPP_WABA_ID`, app-subscription listing in `wa_meta_status.pb.js`. No Telegram analog. **Drop.**
- **Twilio legacy path** — `wa_inbound.pb.js` and all `TWILIO_*` env. Not ported; deleted in deprecation phase.
- **Phone quality rating** display. No analog. **Drop.**

### Genuinely impossible / materially worse on Telegram
- **No conversation history backfill.** Telegram Bot API has **no fetch-history endpoint** — a bot only sees updates from when its webhook is live forward. `WhatsAppConversationsPage.tsx` (which today can reconstruct from `audit_log`) becomes **forward-only**: it can show inbound/outbound logged to `audit_log` (`tg_inbound` / `send_telegram`) but cannot retrieve past messages from Telegram. *Materially worse, but acceptable since we already log to `audit_log`.*
- **No phone-as-human-identifier.** WhatsApp phone is a real-world identifier an admin can type from a roster. Telegram `chat_id` is opaque and unknowable until the user interacts with the bot. This is **why a self-service `/start` linking flow is required** — admins generally cannot pre-populate `chat_id` from external knowledge (only Option B's manual paste works *after* the user has messaged the bot once and revealed their id). This is the single biggest UX regression and the reason Decision #1 is the critical path.
- **Cannot DM a user who has never started the bot.** Telegram forbids a bot from initiating a conversation with a user who hasn't pressed Start. So **per-user 1:1 notifications only reach users who have linked + started the bot.** Group digest (Phase 1) has no such limit. (Reinforces Decision #3.)
- **Identity is locked to a Telegram account**, not transferable like a phone number, and a user cannot "unlink by changing number." Mitigation: explicit unlink action in the linking UI.

---

## 2. IDENTITY — the central question

WhatsApp keys identity on `users.phone` (E.164). Lookup today:
`dao.findRecordsByFilter("users", "phone = {:phone}", "", 1, 0, {phone})` (`wa_inbound.pb.js:425-436`), with last-9-digit country-code normalization. Phone is mutable, admin-settable via the `update_user_phone` AI tool (`ai_chat.pb.js`).

Telegram keys identity on **`chat_id`** (the 1:1 conversation id, a numeric string; equals `from.id` for private chats). This **must** be stored on the user. New field via migration:

```
users.telegram_chat_id  — type: text, required: false, unique: false (optional for gradual rollout)
```
(Mirror onto `invites.telegram_chat_id` for pre-binding at invite acceptance, paralleling `invites.phone` from `1779900000_invites_add_phone.js`.)

Lookup becomes:
`dao.findRecordsByFilter("users", "telegram_chat_id = {:chat_id}", "", 1, 0, {chat_id})`.

### Linking-flow options

**Option A — `/start <one-time-code>` deep link (RECOMMENDED for self-service)**
1. In the web app, user opens a "Link Telegram" modal → backend mints a short-lived (e.g. 10-min) one-time code bound to `user.id`, stored in `$app.store()` or a small `tg_link_codes` collection.
2. User clicks `https://t.me/<botname>?start=<code>` (or DMs `/start <code>`). Telegram delivers `/start <code>` to the webhook with the sender's real `chat_id`.
3. Webhook validates the code, writes `chat_id` onto `users.telegram_chat_id`, replies "Linked ✅".
- **Pros:** secure (code proves web-session ownership), self-service, no admin toil, captures the otherwise-unknowable `chat_id` automatically. **Cons:** requires building code mint + redeem + a modal. **This is the only flow that solves "admin can't know chat_id in advance."**

**Option B — Admin sets `chat_id` manually (fast-path for staff)**
- Add a `telegram_chat_id` input on the Users page; admin pastes the id. But the admin must *get* the id first (user runs `/start`, bot echoes their `chat_id`, user reports it). Practical only for a handful of staff.
- **Pros:** trivial to build (reuses the `update_user_phone` tool pattern → new `update_user_telegram_chat_id` tool). **Cons:** doesn't scale; still depends on the user messaging the bot once.

**Option C — Phone-share deep link**
- Use a `KeyboardButton` with `request_contact` so the user shares their phone with the bot, then match against existing `users.phone`. **Pros:** reuses existing phone data, near-zero user friction for already-phone-linked users. **Cons:** still requires the user to start the bot; phone-share is a private-chat-only flow; ties Telegram identity to phone accuracy (which we noted is unvalidated/mutable). Useful as an *accelerator* on top of A, not a standalone.

**Recommendation:** Ship **B in Phase 2** (cheap staff bootstrap, unblocks testing) and **A in Phase 4** as the production self-service flow. Consider **C** later as a one-tap accelerator. This matches Decision #1 option (C).

---

## 3. Phased Plan (each phase = one mergeable PR)

> Ordering principle: schema first, then the smallest provable Telegram delivery path, then identity, then inbound bot (highest risk), then UI, then deprecation. WhatsApp stays live throughout Phases 2–7.

### Phase 2 — `telegram_chat_id` schema + admin manual bind
- **Scope:** Add `users.telegram_chat_id` (and `invites.telegram_chat_id`). Add a new AI/MCP write tool `update_user_telegram_chat_id` mirroring `update_user_phone`. Add `'telegram'` as an accepted value in `prefs.channels` validation (no structural change). Surface a `telegram_chat_id` field on the Users admin page (Option B fast-path).
- **Files add/change:**
  - add `pb/pb_migrations/178XXXXXXX_users_add_telegram_chat_id.js`
  - add `pb/pb_migrations/178XXXXXXX_invites_add_telegram_chat_id.js`
  - change `pb/pb_hooks/ai_chat.pb.js` + `pb/pb_hooks/ai_mcp.pb.js` (new write tool; update CLAUDE.md tool count)
  - change `frontend/src/types/index.ts` (`telegram_chat_id?` on PBUser), `frontend/src/services/users.ts`, Users page
- **Agent:** db-engineer (migrations) → implementer (tool + frontend field) → qa (hook test for new tool + migration applies)
- **Effort:** S–M · **Risk:** low (additive, optional field, nothing reads it yet)

### Phase 3 — Telegram outbound send primitive + single-send endpoint
- **Scope:** Build the reusable `sendTelegram(chatId, text)` primitive (4096-char chunk splitter, paragraph-preferring; `parse_mode` HTML; `api.telegram.org/bot<token>/sendMessage`; 15s timeout; serialized loop; audit-log `action='send_telegram'`). Expose admin `POST /api/tg/send` (single recipient) mirroring `wa_meta_send.pb.js`. Reuse the Phase-1 `TELEGRAM_BOT_TOKEN`. Skip-silently when token unset. **Goja isolation:** each `routerAdd`/`cronAdd` callback gets its own runtime — inline all helpers inside the callback (per `tg_group_digest.pb.js` precedent and `project_pb_module_state_isolation` memory).
- **Files add/change:** add `pb/pb_hooks/tg_send.pb.js`
- **Agent:** implementer (hook) → qa (hook test against ephemeral PB; mock/stub the HTTP send)
- **Effort:** M · **Risk:** medium (first proactive outbound; verify chunking + audit shape). WhatsApp send untouched.

### Phase 4 — Self-service `/start <code>` linking flow (Option A)
- **Scope:** One-time-code mint/redeem + the inbound `/start <code>` handler. First inbound webhook surface, but **scoped to linking only** (not the full AI loop yet) to de-risk. Add `POST /api/tg/webhook` that: verifies `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_BOT_SECRET`, parses `update.message`, and if text is `/start <code>` redeems the code → writes `telegram_chat_id`. Add a "Link Telegram" modal in the frontend (mint code, show deep link / QR). Register the webhook via `setWebhook` (document the one-time curl in CLAUDE.md).
- **Files add/change:**
  - add `pb/pb_hooks/tg_webhook.pb.js` (linking-only handler for now)
  - add `pb/pb_migrations/178XXXXXXX_tg_link_codes.js` *(or use `$app.store()`; prefer a collection for auditability)*
  - add `frontend/src/components/TelegramLinkDialog.tsx`, hook into profile/Users UI
  - new env: `TELEGRAM_BOT_SECRET`
- **Agent:** db-engineer (link-codes collection) → implementer (webhook + modal) → qa (e2e linking + hook test for code redeem/expiry)
- **Effort:** L · **Risk:** medium-high (webhook auth, code expiry, the unknowable-chat_id problem solved here)

### Phase 5 — Inbound AI bot over Telegram (reuse `ai_chat.pb.js`)
- **Scope:** Extend `tg_webhook.pb.js` so non-`/start` text messages run the full bot path: resolve `chat_id → user`, mint PB token (`$tokens.recordAuthToken`), role-gate writes (admin/technician — reuse `isWriteAuthorized`), optional 30s write-intent confirmation (pending store keyed by `chat_id`, user replies "yes"), POST to `/api/ai/chat`, reply via `sendTelegram`. Use Telegram **inline keyboard `callback_query`** for the confirm step instead of text-reply parsing (cleaner than WA). Audit `via='tg-bot'`. **No RETURN-shortcut port** (WA-specific warehouse paradigm). `ai_chat.pb.js` itself is unchanged.
- **Files add/change:** change `pb/pb_hooks/tg_webhook.pb.js`; CLAUDE.md (document `/api/tg/webhook`, secret-token verify, `setWebhook`)
- **Agent:** implementer (hook) → qa (hook test: identity resolve, role gate denies non-admin writes, confirm flow, undo)
- **Effort:** L · **Risk:** **high** (auth + role gate + write authorization — the security-critical surface). Mandatory reviewer pass before merge (per `feedback_reviewer_before_merge`). WA inbound stays live.

### Phase 6 — Per-user transactional notify + escalation over Telegram
> **Conditional on Decision #3.** If group digest *replaces* per-user 1:1, **skip the per-user notify parts** and only add the `'telegram'` channel switch where digest covers it.
- **Scope:** Add Telegram delivery to `wa_meta_auto_notify.pb.js` events (request_fulfilled, request_pending, kit_moved) and `wa_approval_escalation_cron.pb.js`, gated by `prefs.channels` containing `'telegram'` → `sendTelegram(user.telegram_chat_id, …)`. On-call routing (`on_call_shifts`) and quiet-hours gate reused verbatim. Replace short-id approval text parsing with inline-keyboard `callback_query`. Audit `action='send_telegram'`. **Only reaches users who linked + started the bot** (see §1 limitation).
- **Files add/change:** change `wa_meta_auto_notify.pb.js`, `wa_approval_escalation_cron.pb.js` (additive `'telegram'` branch — do **not** remove WA branch); inline a `sendTelegram` helper per Goja rules.
- **Agent:** implementer → qa (hook tests for each event type with `channels:['telegram']`, quiet-hours, on-call)
- **Effort:** M · **Risk:** high (touches live notify hooks; keep WA branch intact, parallel-run)

### Phase 7 — Telegram admin UI surface + status/health collapse
- **Scope:** New `/settings/telegram/*` pages: **Settings** (bot validity via `getMe()`, webhook info via `getWebhookInfo()`, linked-user count — **no phone/quality/WABA, no expiry ladder**); **Broadcast** (role/`chat_id`-list, free-form text only, no templates); **Scheduled Broadcasts** (reuse `scheduledBroadcasts.ts` model, recipient = `chat_id`); **Conversations** (forward-only, read from `audit_log` `tg_inbound`/`send_telegram` — document the no-history limitation). Add `GET /api/tg/admin/status` (`getMe`+`getWebhookInfo`+linked count) and `POST /api/tg/broadcast`. **Do not build a Templates page; do not build a token-expiry banner.** Sidebar nav entry. Dashboard health banner: thin valid/invalid only.
- **Files add/change:**
  - add `pb/pb_hooks/tg_status.pb.js`, `pb/pb_hooks/tg_broadcast.pb.js`, extend `scheduled_broadcasts` cron for telegram recipients (additive)
  - add `frontend/src/pages/TelegramSettingsPage.tsx`, `TelegramBroadcastPage.tsx`, `TelegramScheduledBroadcastsPage.tsx`, `TelegramConversationsPage.tsx`
  - add `frontend/src/services/telegram.ts`; change `frontend/src/components/Layout.tsx`, `frontend/src/services/health.ts`, `frontend/src/pages/DashboardPage.tsx`
- **Agent:** implementer (frontend XL) + implementer (hooks) → qa (admin-gating e2e, prod-build smoke per `feedback_prod_build_smoke` since URLs differ dev/prod)
- **Effort:** XL · **Risk:** high (largest surface; admin-gating + prod-URL smoke required)

### Phase 8 — Cutover validation + parallel-run soak
- **Scope:** Run Telegram + WhatsApp in parallel in prod for the agreed soak window (Decision #2). Verify: linking, inbound bot writes + undo, notifications reach linked users, broadcasts, digest (Phase 1) still green. Add a feature flag / `prefs.channels` default flip to make Telegram primary. No code deletion yet.
- **Files:** config/secrets (`flyctl secrets set TELEGRAM_*`), CLAUDE.md deployment section, soak checklist in `docs/`.
- **Agent:** qa (verification) + inline orchestration/docs
- **Effort:** S–M · **Risk:** medium

### Phase 9 — WhatsApp deprecation (final, gated on Phase 8 sign-off)
- **Scope:** Remove WA hooks and frontend once Telegram proven: delete `wa_meta_webhook.pb.js`, `wa_inbound.pb.js`, `wa_meta_send.pb.js`, `wa_meta_broadcast.pb.js`, `wa_meta_status.pb.js`, `whatsapp_token_health.pb.js`, `wa_meta_templates.pb.js`; remove WA branches from `wa_meta_auto_notify.pb.js` / `wa_approval_escalation_cron.pb.js` (rename to `auto_notify`/`approval_escalation_cron`); delete `WhatsApp*Page.tsx`, `SubmitTemplateDialog.tsx`, `services/whatsapp.ts`; remove `WHATSAPP_*` / `TWILIO_*` Fly secrets; keep `users.phone` (still useful for contact/`request_contact`) or drop per product call. Update CLAUDE.md (remove the WhatsApp Meta section, tool count, env table).
- **Agent:** implementer → reviewer (un-reviewed deletion risk) → qa (full e2e)
- **Effort:** M · **Risk:** medium (deletion; ensure nothing in Telegram path imported a WA helper)

---

## Cross-cutting build notes
- **Goja isolation (PB v0.22):** every `cronAdd`/`routerAdd` callback runs in its own runtime; no cross-file imports, no module-level shared state. Inline helpers inside each callback (see `tg_group_digest.pb.js`; memory `project_pb_module_state_isolation`). Use `$app.store()` for any cross-call state (e.g. pending-confirm map, link codes if not a collection).
- **Skip-silently env convention (from Phase 1):** all Telegram hooks must no-op when `TELEGRAM_BOT_TOKEN` is unset, keeping CI/local green.
- **Read tokens at runtime** via `$os.getenv("TELEGRAM_*")` — never hardcode (matches WA Meta convention).
- **Hook tests:** add a real `tests/hooks/*.test.js` for every new hook (`_smoke.test.js` only catches load failures). Authenticate as the seeded app admin, not the superuser panel token, for role-gated paths.
- **Schema-constraint briefs:** any phase writing to `users`/`requests`/`audit_log` must list select enums and forbid swallow-on-error for correctness ops (memory `feedback_brief_must_verify_schema`).
- **New env/secrets introduced:** `TELEGRAM_BOT_SECRET` (Phase 4 webhook verify). Reuses Phase-1 `TELEGRAM_BOT_TOKEN`. Per-user delivery uses `users.telegram_chat_id` (no new env). `TELEGRAM_GROUP_CHAT_ID` remains for the Phase-1 digest.

---

*Generated by the `telegram-migration-spec` design workflow (6 parallel subsystem mappers + synthesis). File paths verified against the working tree at the time of writing; re-verify before each phase build.*
