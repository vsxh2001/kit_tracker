# Pilot-Ready 4-Week Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kit Tracker pitch-ready for a field-service / IT ops pilot by polishing the WhatsApp wedge end-to-end, fixing one security bug + one UI gap, and shipping pilot-facing docs + demo seed.

**Architecture:** WhatsApp (Twilio sandbox) is the primary surface for technicians; the existing AI tool layer (`ai_chat.pb.js`) handles move/return intents; PocketBase audit log captures every transaction with a `via` source tag; the web app is admin-only oversight (timeline, audit filter, CSV export).

**Tech Stack:** PocketBase v0.22 (Go + SQLite + Goja JS hooks), React 18 + Vite + TypeScript, Tailwind + Radix UI, Twilio WhatsApp sandbox, Anthropic Claude API (Haiku 4.5), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-05-16-roadmap-design.md`

---

## File map

### Backend (PocketBase hooks + migrations)
- Modify: `pb/pb_hooks/ai_chat.pb.js` — return `toolsUsed` in response object
- Modify: `pb/pb_hooks/wa_inbound.pb.js` — verify detection wiring; add `RETURN <serial>` shortcut; tag audit via `wa-bot`
- Modify: `pb/pb_hooks/audit_log.pb.js` — accept `via` field from request context; persist into `changes` JSON
- Create: `pb/pb_migrations/<ts>_add_via_to_audit_log.js` — schema for explicit `via` column on `audit_log` collection (optional; can stay inside `changes` JSON — decided per Task 8)

### Frontend
- Modify: `frontend/src/components/Layout.tsx` — `hasRole` excludes `"denied"`
- Modify: `frontend/src/context/AuthContext.tsx` — realtime subscription forces logout when own role flips to `"denied"`
- Modify: `frontend/src/pages/AuditLogPage.tsx` — filter dropdown by `changes.via`
- Modify: `frontend/src/pages/KitDetailPage.tsx` — origin badge per transaction
- Modify: `frontend/src/services/kits.ts` — add `exportKitTimelineCsv(kitId)`
- Modify: `frontend/src/types/index.ts` — add `AuditLogEntry.via` typing
- Verify (no-op if shipped): `frontend/src/pages/KitDetailPage.tsx:165-166` Deactivate button — confirmed shipped, will only e2e-cover

### Tests
- Create: `frontend/e2e/wa-confirm-flow.spec.ts` — sandbox curl tests
- Create: `frontend/e2e/denied-mid-session.spec.ts` — U-01 regression
- Create: `frontend/e2e/audit-via-filter.spec.ts` — filter dropdown
- Create: `frontend/e2e/kit-timeline-csv.spec.ts` — export
- Modify: `frontend/e2e/helpers/api.ts` — helper for posting fake WA webhook

### Scripts + docs
- Modify: `scripts/seed_demo_data.mjs` — field-service flavor
- Create: `docs/pilot-onboarding.md` — sandbox join + command cheat-sheet
- Create: `docs/pilot-runbook.md` — Fly + Twilio sandbox setup
- Create: `docs/pilot-pitch.md` — one-pager
- Modify: `README.md` — WhatsApp-first lead

---

## Execution rhythm

- **One task per "day-slot"** in spec; some days have one task, some have multiple sub-steps.
- **TDD where code changes behavior.** Doc tasks skip TDD.
- **Commit per task.** Push after every commit (pre-push hook runs lint + build + test:smoke — keep diffs small).
- **Verify-before-fix.** Several spec items (Deactivate UI, RequireRole gate) may already work. Each "fix" task starts with a verification step.

---

# Week 1 — WhatsApp wedge correctness

---

## Task 1: Verify `ai_chat.pb.js` does NOT return `toolsUsed` (P0 confirm flow bug)

**Files:**
- Inspect: `pb/pb_hooks/ai_chat.pb.js`
- Inspect: `pb/pb_hooks/wa_inbound.pb.js`

- [ ] **Step 1: Read the response object construction in ai_chat**

Open `pb/pb_hooks/ai_chat.pb.js` and find line ~2370-2383. Confirm `responseObj` only contains `reply`, `sessionId`, `done`, optional `tool_result`, optional `undo_token`. No `toolsUsed`.

- [ ] **Step 2: Read detectWriteTool in wa_inbound**

Open `pb/pb_hooks/wa_inbound.pb.js`, find `detectWriteTool`. Confirm it reads `parsed.toolsUsed || parsed.tools_used || parsed.toolsCalled`.

- [ ] **Step 3: Document the gap in a one-line commit message draft**

Record finding: "wa_inbound.detectWriteTool reads `toolsUsed` which ai_chat does not return → write tools (move_kit etc.) execute without WA confirm prompt. Fix in Task 2."

No file changes, no commit. Just verification.

---

## Task 2: Add `toolsUsed` to `ai_chat.pb.js` response (P0 fix)

**Files:**
- Modify: `pb/pb_hooks/ai_chat.pb.js:~2360-2383`

- [ ] **Step 1: Find the tool-use loop, track tool names**

Find the loop where `tool_use` content blocks are handled (search for `tool_use` in `ai_chat.pb.js`). Identify the place where each invoked tool name is known.

- [ ] **Step 2: Accumulate `toolsUsed` array across the loop**

Pseudo-code (engineer adapts to actual loop variable names):

```javascript
// Near the top of the routerAdd handler, alongside other accumulators:
var toolsUsed = [];

// Inside the tool-use loop, after a tool runs successfully:
toolsUsed.push(toolName);

// Where responseObj is built (around line 2370):
var responseObj = {
  reply: finalReply,
  sessionId: sessionId,
  done: true,
  toolsUsed: toolsUsed   // ADD THIS
};
```

- [ ] **Step 3: Restart PB locally and curl-test**

```bash
bash pb/start-pb.sh &
sleep 2
# Use a real auth token (admin or technician). Get one via:
TOKEN=$(curl -s -X POST http://127.0.0.1:8090/api/collections/users/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"logistics@kit.local","password":"Pass1234!"}' | jq -r .token)
curl -s -X POST http://127.0.0.1:8090/api/ai/chat \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"List 3 kits"}' | jq '.toolsUsed'
```

Expected: `["list_kits"]` (or similar non-empty array). FAIL = response missing the field.

- [ ] **Step 4: Re-curl with a write-tool prompt**

```bash
curl -s -X POST http://127.0.0.1:8090/api/ai/chat \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"Move DEMO-KIT-005 to DEMO-Entity-002"}' | jq '.toolsUsed, .tool_result'
```

Expected: `toolsUsed` includes `"move_kit"` (or `"resolve_kit"` if disambiguation), AND `tool_result.tool === "move_kit"`.

- [ ] **Step 5: Commit**

```bash
git add pb/pb_hooks/ai_chat.pb.js
git commit -m "fix(ai_chat): return toolsUsed array so wa_inbound can detect writes"
git push
```

---

## Task 3: Verify WhatsApp Phase B confirm flow end-to-end on sandbox

**Files:**
- Inspect: `pb/pb_hooks/wa_inbound.pb.js`
- Create test fixture: `scripts/wa_e2e_test.sh`

- [ ] **Step 1: Set required env vars locally (or use sandbox secrets via Fly)**

```bash
export TWILIO_ACCOUNT_SID="<sandbox-sid>"
export TWILIO_BASIC_AUTH="<base64-sid:auth>"
export TWILIO_AUTH_TOKEN="<sandbox-auth-token>"
export TWILIO_WA_FROM="whatsapp:+14155238886"
export APP_BASE_URL="http://127.0.0.1:8090"
export WA_SKIP_SIGNATURE_CHECK=1   # local dev only
```

- [ ] **Step 2: Seed a phone-equipped technician**

Use PB admin or:

```bash
curl -X PATCH "http://127.0.0.1:8090/api/collections/users/records/<tech-id>" \
  -H "Authorization: <admin-token>" -H 'Content-Type: application/json' \
  -d '{"phone":"+972501234567"}'
```

- [ ] **Step 3: Create `scripts/wa_e2e_test.sh`**

```bash
#!/usr/bin/env bash
# Manual end-to-end test of WA Phase B confirm flow against local PB.
# Usage: bash scripts/wa_e2e_test.sh
set -euo pipefail

PB_URL="${PB_URL:-http://127.0.0.1:8090}"
TECH_PHONE="${TECH_PHONE:-+972501234567}"
MSG_SID=$(date +%s)

# 1. send "move ..." — expect confirm prompt
curl -s -X POST "$PB_URL/api/wa/webhook" \
  -d "From=whatsapp:$TECH_PHONE" \
  -d "Body=Move DEMO-KIT-005 to DEMO-Entity-002" \
  -d "MessageSid=SM$MSG_SID-1" \
  -d "AccountSid=$TWILIO_ACCOUNT_SID"

# 2. send YES — expect execution
sleep 2
curl -s -X POST "$PB_URL/api/wa/webhook" \
  -d "From=whatsapp:$TECH_PHONE" \
  -d "Body=YES" \
  -d "MessageSid=SM$MSG_SID-2" \
  -d "AccountSid=$TWILIO_ACCOUNT_SID"

# 3. verify transaction created
echo "---" && curl -s "$PB_URL/api/collections/transactions/records?filter=kit.serial='DEMO-KIT-005'&sort=-timestamp&perPage=1" | jq '.items[0]'
```

- [ ] **Step 4: Run it and verify**

```bash
chmod +x scripts/wa_e2e_test.sh
bash scripts/wa_e2e_test.sh
```

Expected: PB log shows `[wa_inbound] write-tool detected (move_kit) — sending confirmation prompt` on first call, `[wa_inbound] confirm received — executing` on second, and the transaction record has the expected `to_entity`.

- [ ] **Step 5: Commit the test script**

```bash
git add scripts/wa_e2e_test.sh
git commit -m "test(wa): manual end-to-end sandbox script for Phase B confirm flow"
git push
```

---

## Task 4: Add `RETURN <serial>` shortcut intent

**Files:**
- Modify: `pb/pb_hooks/wa_inbound.pb.js`
- Modify: `.env.example` — add `DEFAULT_WAREHOUSE_ENTITY_ID`

- [ ] **Step 1: Add env var to `.env.example`**

```bash
echo "
# WhatsApp shortcut intent: where 'return <serial>' moves kits to.
# Must be a valid entities record ID. Required only if you use the shortcut.
DEFAULT_WAREHOUSE_ENTITY_ID=
" >> .env.example
```

- [ ] **Step 2: Patch wa_inbound.pb.js — detect RETURN intent BEFORE handing to AI**

Find the place where the inbound `Body` is parsed. Add early branch:

```javascript
// Early intent: "return <serial>" or "send back <serial>" — explicit shortcut.
// Bypasses AI; calls move_kit directly to DEFAULT_WAREHOUSE_ENTITY_ID.
var returnMatch = body.trim().match(/^(?:return|send\s+back)\s+(\S+)$/i);
if (returnMatch) {
  var serial = returnMatch[1];
  var warehouseId = process.env.DEFAULT_WAREHOUSE_ENTITY_ID || "";
  if (!warehouseId) {
    sendWaReply(phone, "Cannot process RETURN — server has no default warehouse configured.");
    return c.json(200, {});
  }
  // Re-use the same confirm-flow path: store pending op, send confirm prompt.
  // (Engineer: factor the existing pending-confirm code into a small helper if not already.)
  storePending(phone, { tool: "move_kit", args: { kit_serial: serial, to_entity_id: warehouseId } });
  sendWaReply(phone, "Confirm: return " + serial + " to warehouse? Reply YES within 30s.");
  return c.json(200, {});
}
```

Note: `process.env` in Goja is exposed via `$os.getenv()` in some PB JS versions. Engineer should check existing env access pattern in the file (search for `getenv`) and use the same.

- [ ] **Step 3: Add YES handler for the stored shortcut**

Confirm the existing YES handler already executes the stored `tool` + `args`. If it only knows how to re-invoke the AI, refactor so the stored payload includes a direct-execution flag.

- [ ] **Step 4: Extend `scripts/wa_e2e_test.sh` to cover RETURN**

```bash
# Append to scripts/wa_e2e_test.sh
echo "
# 4. send RETURN shortcut — expect confirm prompt
curl -s -X POST \"\$PB_URL/api/wa/webhook\" \\
  -d \"From=whatsapp:\$TECH_PHONE\" \\
  -d \"Body=return DEMO-KIT-005\" \\
  -d \"MessageSid=SM\$MSG_SID-3\" \\
  -d \"AccountSid=\$TWILIO_ACCOUNT_SID\"
" >> scripts/wa_e2e_test.sh
```

- [ ] **Step 5: Run + verify both phrasings ("return X", "send back X") prompt confirm**

```bash
bash scripts/wa_e2e_test.sh
```

Expected: PB log shows two confirm prompts (one for each phrasing if you run twice with different bodies).

- [ ] **Step 6: Commit**

```bash
git add pb/pb_hooks/wa_inbound.pb.js .env.example scripts/wa_e2e_test.sh
git commit -m "feat(wa): RETURN <serial> shortcut → move to DEFAULT_WAREHOUSE_ENTITY_ID with confirm"
git push
```

---

## Task 5: Write `docs/pilot-onboarding.md`

**Files:**
- Create: `docs/pilot-onboarding.md`

- [ ] **Step 1: Draft the doc**

```markdown
# Pilot Onboarding — WhatsApp Kit Tracker

## What this is
Kit Tracker tracks every move of every kit in your fleet. You move kits by sending a WhatsApp message; the system logs it; your admin sees a full audit trail on the web.

## Step 1: Join the WhatsApp sandbox
1. Save this number in your phone contacts: **+1 415 523 8886** (Twilio sandbox)
2. From WhatsApp on your phone, send the message: `join <code>` (we'll share the code separately — it's tied to our sandbox account)
3. You should receive a confirmation: "Twilio Sandbox: ✅ You are all set..."

## Step 2: Give your phone number to the admin
Your phone number is your identity. The admin links it to your user account. Until that's done, the bot won't recognize you.

## Step 3: Try a kit move
Send: `move <KIT-SERIAL> to <ENTITY-NAME>`

Example: `move DEMO-KIT-005 to ACME-LAB`

The bot will reply with a confirmation summary. Reply `YES` within 30 seconds to execute. Reply anything else (or wait) to cancel.

## Step 4: Try a return
Send: `return <KIT-SERIAL>`

The bot moves the kit to the default warehouse and asks for confirmation.

## Command cheat-sheet

| You send | Bot does |
|---|---|
| `move KIT-X to LAB-Y` | Confirm prompt → move on YES |
| `return KIT-X` | Confirm prompt → return to warehouse on YES |
| `where is KIT-X?` | Reply with current location (no confirm — read only) |
| `what open requests are there?` | Reply with list |
| `YES` (within 30s of confirm) | Execute pending op |
| Anything else after a prompt | Cancel pending op |

## FAQ

**I sent a move and got no confirm prompt.**
The bot only confirms write operations. Read-only queries reply immediately. If you expected a confirm and didn't get one, check the serial — the bot may have failed to resolve it and replied with an error.

**I missed the 30-second window.**
The pending op was cancelled. Just re-send the original message.

**The bot says "ambiguous — which X?"**
You have two kits or entities with similar names. Use the full serial / exact name. Or ask the bot: `list kits starting with KIT-` to see them.

**I'm not authorized.**
Your phone number isn't linked to a user with `admin` or `technician` role. Ask your admin to set your role on the web app `/users` page.

**The bot is silent / errors.**
- Check WhatsApp sandbox is still active (sandbox expires after 3 days of inactivity — re-send the join code).
- Contact your admin; the admin can check the audit log on the web.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pilot-onboarding.md
git commit -m "docs(pilot): WhatsApp onboarding cheat-sheet for technicians"
git push
```

---

# Week 2 — Admin web oversight polish

---

## Task 6: Add `via` source tag to audit log writes from each surface

**Files:**
- Modify: `pb/pb_hooks/audit_log.pb.js` — read `c.get("audit_via")` (or similar context key) and persist into `changes`
- Modify: `pb/pb_hooks/wa_inbound.pb.js` — set context key `"wa-bot"` before delegating to ai_chat
- Modify: `pb/pb_hooks/ai_chat.pb.js` — set context key `"ai-agent"` if not set
- Modify: `pb/pb_hooks/ai_mcp.pb.js` — set context key `"mcp"` if not set

Decision: keep `via` inside the `changes` JSON object (no schema migration) for the sprint.

- [ ] **Step 1: Define a helper convention**

Document in a comment in `audit_log.pb.js`:

```javascript
// `via` source detection priority:
//   1. e.httpContext.get("audit_via") if set by caller hook
//   2. e.record.get("created_by") matches a known agent user → "ai-agent"
//   3. fallback "web"
function detectVia(e) {
  try {
    var v = e.httpContext.get("audit_via");
    if (v) return String(v);
  } catch (_) {}
  return "web";
}
```

- [ ] **Step 2: Update each `audit_log.pb.js` create/update handler**

Add `via: detectVia(e)` to the saved `changes` JSON object. Example for kits-create:

```javascript
var log = new Record(auditCol, {
  collection_name: "kits",
  record_id: e.record.id,
  actor: actorId,
  action: "create",
  changes: JSON.stringify({ after: data, via: detectVia(e) }),
});
```

Repeat for every `new Record(auditCol, ...)` block in the file.

- [ ] **Step 3: In `wa_inbound.pb.js`, set the context key before any DB write**

Find the place where the request proceeds to call `ai_chat` (or executes a direct write). Before that, set:

```javascript
c.set("audit_via", "wa-bot");
```

Note: PB Goja exposes context.set via `c.set(key, value)` — engineer confirms by checking existing `c.set`/`c.get` usage.

- [ ] **Step 4: Same in `ai_chat.pb.js` and `ai_mcp.pb.js`**

In `ai_chat.pb.js`, if the request did not come from WA (no `audit_via` already set), set `c.set("audit_via", "ai-agent")` before any DAO write.

In `ai_mcp.pb.js`, set `c.set("audit_via", "mcp")` similarly.

- [ ] **Step 5: Verify via curl**

```bash
# Trigger an MCP move
curl -X POST http://127.0.0.1:8090/api/mcp \
  -H "Authorization: <token>" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"move_kit","arguments":{"kit_serial":"DEMO-KIT-005","to_entity_id":"<id>"}}}'

# Check audit log
curl "http://127.0.0.1:8090/api/collections/audit_log/records?sort=-created&perPage=1" \
  -H "Authorization: <admin-token>" | jq '.items[0].changes | fromjson | .via'
```

Expected: `"mcp"` (or `"wa-bot"`/`"ai-agent"`/`"web"` depending on the trigger path).

- [ ] **Step 6: Commit**

```bash
git add pb/pb_hooks/audit_log.pb.js pb/pb_hooks/wa_inbound.pb.js pb/pb_hooks/ai_chat.pb.js pb/pb_hooks/ai_mcp.pb.js
git commit -m "feat(audit): tag every audit row with via (web|wa-bot|ai-agent|mcp)"
git push
```

---

## Task 7: Add `via` filter dropdown to `/audit` page

**Files:**
- Modify: `frontend/src/pages/AuditLogPage.tsx`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/audit.ts` — add `via` to listing query helper

- [ ] **Step 1: Extend the AuditLogEntry type**

Open `frontend/src/types/index.ts`. Find or add `AuditLogEntry`:

```typescript
export type AuditVia = "web" | "wa-bot" | "ai-agent" | "mcp";

export interface AuditLogEntry {
  id: string;
  collection_name: string;
  record_id: string;
  actor: string;
  action: "create" | "update" | "delete";
  changes: string;  // JSON string with .via, .before, .after
  created: string;
  updated: string;
}
```

- [ ] **Step 2: Add `via` filter state + dropdown to AuditLogPage**

```tsx
const [viaFilter, setViaFilter] = useState<"" | AuditVia>("");

// In the filter row JSX:
<Select value={viaFilter} onValueChange={(v) => setViaFilter(v as any)}>
  <SelectTrigger className="w-[180px]"><SelectValue placeholder="All sources" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="">All sources</SelectItem>
    <SelectItem value="web">Web</SelectItem>
    <SelectItem value="wa-bot">WhatsApp</SelectItem>
    <SelectItem value="ai-agent">AI chat</SelectItem>
    <SelectItem value="mcp">MCP</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 3: Filter client-side after fetch (no server filter on JSON sub-field)**

```tsx
const filtered = useMemo(() => {
  if (!viaFilter) return rows;
  return rows.filter((r) => {
    try { return JSON.parse(r.changes)?.via === viaFilter; }
    catch { return false; }
  });
}, [rows, viaFilter]);
```

- [ ] **Step 4: Add a column "Source" to the table**

```tsx
<TableHead>Source</TableHead>
{/* ... */}
<TableCell>
  {(() => {
    try { return JSON.parse(row.changes)?.via || "—"; }
    catch { return "—"; }
  })()}
</TableCell>
```

- [ ] **Step 5: Write the e2e test**

Create `frontend/e2e/audit-via-filter.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { loginAsAdmin, seedAuditRows, cleanup } from "./helpers/api";

test.describe("audit log via-filter", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuditRows([
      { via: "web", action: "create" },
      { via: "wa-bot", action: "update" },
      { via: "mcp", action: "create" },
    ]);
    await loginAsAdmin(page);
  });
  test.afterEach(cleanup);

  test("filter narrows to wa-bot rows only", async ({ page }) => {
    await page.goto("/audit");
    await page.getByRole("combobox", { name: /source/i }).click();
    await page.getByRole("option", { name: /whatsapp/i }).click();
    await expect(page.getByRole("row")).toHaveCount(2); // header + 1
  });
});
```

- [ ] **Step 6: Add seedAuditRows helper**

In `frontend/e2e/helpers/api.ts`, add:

```typescript
export async function seedAuditRows(rows: Array<{ via: string; action: string }>) {
  const token = await getSuperuserToken();
  for (const r of rows) {
    await fetch(`${PB_URL}/api/collections/audit_log/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        collection_name: "kits",
        record_id: "test",
        actor: TEST_ADMIN_ID,
        action: r.action,
        changes: JSON.stringify({ via: r.via, after: {} }),
      }),
    });
  }
}
```

- [ ] **Step 7: Run the test**

```bash
cd frontend
npx playwright test e2e/audit-via-filter.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/AuditLogPage.tsx frontend/src/services/audit.ts frontend/e2e/audit-via-filter.spec.ts frontend/e2e/helpers/api.ts
git commit -m "feat(audit): filter dropdown + source column on /audit"
git push
```

---

## Task 8: Kit timeline shows origin badge per transaction

**Files:**
- Modify: `frontend/src/components/KitTimeline.tsx` (or wherever timeline rows render)
- Modify: `frontend/src/services/transactions.ts` — fetch audit_log entries joined by `record_id` to get `via`

- [ ] **Step 1: Locate the timeline rendering**

```bash
grep -rn "KitTimeline\|timeline" frontend/src/components frontend/src/pages | head
```

Find the file that renders each transaction row.

- [ ] **Step 2: Add a service helper to bulk-fetch via tags by transaction ID**

In `frontend/src/services/transactions.ts`:

```typescript
export async function getTransactionVia(transactionIds: string[]): Promise<Record<string, string>> {
  if (transactionIds.length === 0) return {};
  // audit_log rows for transactions: collection_name='transactions', record_id IN (...)
  const filter = transactionIds.map((id) => `record_id="${id}"`).join("||");
  const rows = await pb.collection("audit_log").getFullList({
    filter: `collection_name="transactions" && (${filter})`,
    requestKey: `audit-via-${transactionIds.length}`,
  });
  const out: Record<string, string> = {};
  for (const r of rows) {
    try {
      const via = JSON.parse(r.changes)?.via;
      if (via && !out[r.record_id]) out[r.record_id] = via;
    } catch { /* skip */ }
  }
  return out;
}
```

- [ ] **Step 3: Render the badge in timeline**

```tsx
// In KitTimeline.tsx, alongside the from→to display:
{viaMap[tx.id] && (
  <span className="ml-2 text-xs text-muted-foreground">
    via {viaMap[tx.id] === "wa-bot" ? "WhatsApp" : viaMap[tx.id]}
  </span>
)}
```

- [ ] **Step 4: Mobile-responsive check (375px viewport)**

```bash
cd frontend
npx playwright test e2e/mobile.spec.ts --project=chromium --grep "kit timeline"
```

If no such test exists, add a quick visual check:

```bash
npm run dev &
# Open browser at 375px and inspect /kits/<id>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/KitTimeline.tsx frontend/src/services/transactions.ts
git commit -m "feat(kit-detail): timeline shows origin badge (WhatsApp / web / MCP) per move"
git push
```

---

## Task 9: CSV export of single-kit timeline

**Files:**
- Modify: `frontend/src/services/kits.ts` — add `exportKitTimelineCsv`
- Modify: `frontend/src/pages/KitDetailPage.tsx` — add button to Actions card

- [ ] **Step 1: Write the service function**

```typescript
// In frontend/src/services/kits.ts
export async function exportKitTimelineCsv(kitId: string, kitSerial: string): Promise<void> {
  const txs = await pb.collection("transactions").getFullList({
    filter: `kit="${kitId}"`,
    sort: "-timestamp",
    expand: "from_entity,to_entity,created_by,request",
    requestKey: `tl-${kitId}`,
  });
  const viaMap = await getTransactionVia(txs.map((t: any) => t.id));
  const rows = [
    ["Timestamp", "From", "To", "By", "Via", "Notes", "Request"],
    ...txs.map((t: any) => [
      t.timestamp,
      t.expand?.from_entity?.name || "",
      t.expand?.to_entity?.name || "",
      t.expand?.created_by?.email || "",
      viaMap[t.id] || "web",
      (t.notes || "").replace(/"/g, '""'),
      t.expand?.request?.id || "",
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kitSerial}-timeline.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Add the button to KitDetailPage Actions card**

```tsx
<Button variant="outline" size="sm" onClick={() => exportKitTimelineCsv(kit.id, kit.serial)}>
  <Download className="h-4 w-4 mr-1" /> Export timeline
</Button>
```

- [ ] **Step 3: Write the e2e test**

`frontend/e2e/kit-timeline-csv.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { loginAsAdmin, seedKit, seedTx, cleanup } from "./helpers/api";

test("export kit timeline CSV", async ({ page }) => {
  const kit = await seedKit({ serial: "CSV-TEST-001" });
  await seedTx({ kit: kit.id, to_entity: "<storage-id>" });
  await loginAsAdmin(page);
  await page.goto(`/kits/${kit.id}`);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /export timeline/i }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe("CSV-TEST-001-timeline.csv");
  await cleanup();
});
```

- [ ] **Step 4: Run + commit**

```bash
cd frontend
npx playwright test e2e/kit-timeline-csv.spec.ts --project=chromium
git add frontend/src/services/kits.ts frontend/src/pages/KitDetailPage.tsx frontend/e2e/kit-timeline-csv.spec.ts
git commit -m "feat(kit-detail): export single-kit timeline as CSV"
git push
```

---

# Week 3 — Bug sweep + security

---

## Task 10: Fix U-01 denied-user mid-session bypass

**Files:**
- Modify: `frontend/src/components/Layout.tsx:22` — `hasRole` excludes `"denied"`
- Modify: `frontend/src/context/AuthContext.tsx` — realtime subscription forces logout when own user.role flips to "denied"

- [ ] **Step 1: Tighten Layout.tsx**

```tsx
// frontend/src/components/Layout.tsx:22
const hasRole = !!user?.role && user.role !== "denied";
```

- [ ] **Step 2: Add realtime self-watch in AuthContext**

In `frontend/src/context/AuthContext.tsx`, find where `pb.authStore.onChange` is wired. Add:

```typescript
useEffect(() => {
  if (!user?.id) return;
  const unsub = pb.collection("users").subscribe(user.id, (e) => {
    if (e.record?.role === "denied") {
      pb.authStore.clear();
      window.location.href = "/login?reason=denied";
    }
  });
  return () => { unsub.then((fn) => fn()); };
}, [user?.id]);
```

- [ ] **Step 3: Write e2e**

`frontend/e2e/denied-mid-session.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { loginAs, setRole, TEST_USER, TEST_ADMIN, cleanup } from "./helpers/api";

test("denied user mid-session is forced to login", async ({ page, context }) => {
  await loginAs(page, TEST_USER);
  await page.goto("/kits");
  await expect(page.getByRole("heading", { name: /kits/i })).toBeVisible();

  // Admin denies the user via a separate context
  const adminApi = await context.newPage();
  await loginAs(adminApi, TEST_ADMIN);
  await setRole(TEST_USER.id, "denied");

  // Within 5s the user page should redirect to login
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  await cleanup();
});
```

- [ ] **Step 4: Run + commit**

```bash
cd frontend
npx playwright test e2e/denied-mid-session.spec.ts --project=chromium
git add frontend/src/components/Layout.tsx frontend/src/context/AuthContext.tsx frontend/e2e/denied-mid-session.spec.ts
git commit -m "fix(auth): denied users forced to login mid-session + nav hidden"
git push
```

---

## Task 11: Verify Deactivate-on-detail (B-B6-1)

**Files:** none expected.

- [ ] **Step 1: Open `frontend/src/pages/KitDetailPage.tsx` lines 165-166**

Confirm the Deactivate button is rendered. Confirm it calls `softDeleteKit`. Confirm `AlertDialog` at line 574-585 confirms before action.

- [ ] **Step 2: Confirm an e2e covers it**

```bash
grep -rn "Deactivate" frontend/e2e/
```

If no test covers Deactivate-from-detail, add one to `frontend/e2e/kits.spec.ts`:

```typescript
test("admin deactivates a kit from detail page", async ({ page }) => {
  const kit = await seedKit({ serial: "DEACT-001" });
  await loginAsAdmin(page);
  await page.goto(`/kits/${kit.id}`);
  await page.getByRole("button", { name: /^Deactivate$/ }).first().click();
  await page.getByRole("button", { name: /^Deactivate$/ }).last().click(); // dialog confirm
  await expect(page.getByText(/retired/i)).toBeVisible();
  await cleanup();
});
```

- [ ] **Step 3: Run + commit**

```bash
cd frontend
npx playwright test e2e/kits.spec.ts -g "deactivates a kit from detail" --project=chromium
git add frontend/e2e/kits.spec.ts
git commit -m "test(kits): regression for Deactivate button on kit detail (B-B6-1)"
git push
```

---

## Task 12: W1 regression buffer day

**Files:** any surfaced in W1.

- [ ] **Step 1: Re-run `bash scripts/wa_e2e_test.sh` against current `main`**

If anything fails that worked at end of W1, triage and fix.

- [ ] **Step 2: Re-run smoke tests**

```bash
cd frontend
npm run test:smoke
```

Triage any failures.

- [ ] **Step 3: Commit any fixes**

```bash
git add <files>
git commit -m "fix(wa): <specific issue>"
git push
```

---

## Task 13: Confirm `via=wa-bot` end-to-end after W1 + W2

**Files:** none expected; verification only.

- [ ] **Step 1: Send a WA move + YES**

```bash
bash scripts/wa_e2e_test.sh
```

- [ ] **Step 2: Verify audit_log row**

```bash
curl -s "http://127.0.0.1:8090/api/collections/audit_log/records?filter=collection_name='transactions'&sort=-created&perPage=1" \
  -H "Authorization: <admin-token>" | jq '.items[0].changes | fromjson | .via'
```

Expected: `"wa-bot"`.

- [ ] **Step 3: Verify the badge renders on /kits/:id**

Open the kit in the browser. The latest transaction should show "via WhatsApp".

- [ ] **Step 4: If not `wa-bot`, debug the c.set/c.get hop and re-fix in Task 6**

No commit unless fix needed.

---

## Task 14: Buffer day D15

**Files:** any.

- [ ] **Step 1: Sweep `npm run lint`, `npm run build`, `npm run test:smoke`**

```bash
cd frontend && npm run lint && npm run build && npm run test:smoke
```

- [ ] **Step 2: Triage any issues left from W1-W3**

- [ ] **Step 3: Commit any cleanup**

---

# Week 4 — Pilot-ready packaging

---

## Task 15: Rebuild `scripts/seed_demo_data.mjs` for field-service flavor

**Files:**
- Modify: `scripts/seed_demo_data.mjs`

- [ ] **Step 1: Read current seed**

```bash
head -60 scripts/seed_demo_data.mjs
```

Note the existing entities, kits, technicians.

- [ ] **Step 2: Replace seed body with field-service scenario**

Target state:
- 1 entity: `DEMO-Warehouse` (category=storage)
- 3 entities: `DEMO-Customer-Alpha`, `DEMO-Customer-Bravo`, `DEMO-Customer-Charlie` (category=field)
- 5 users with role=technician, all with `phone` populated (`+972500000001`..`+972500000005`)
- 1 admin user
- 20 kits: 5 at Warehouse (intake), 10 at customers (3 + 4 + 3), 3 mid-return (transactions in last 2 days), 2 retired (is_active=false)
- Each kit has a transaction history of 2-4 moves
- Set `DEFAULT_WAREHOUSE_ENTITY_ID` in `.env.example` to match the seeded warehouse ID (or document how to fetch it)

```javascript
// Schematic — engineer adapts to existing seed style
const warehouse = await createEntity({ name: "DEMO-Warehouse", category: "storage" });
const customers = await Promise.all([
  createEntity({ name: "DEMO-Customer-Alpha", category: "field" }),
  createEntity({ name: "DEMO-Customer-Bravo", category: "field" }),
  createEntity({ name: "DEMO-Customer-Charlie", category: "field" }),
]);
const techs = await Promise.all(
  [1,2,3,4,5].map((n) => createUser({
    email: `demo-technician-${n}@kit.local`,
    role: "technician",
    phone: `+97250000000${n}`,
  }))
);
for (let i = 1; i <= 20; i++) {
  const kit = await createKit({ serial: `DEMO-KIT-${String(i).padStart(3, "0")}`, is_active: i > 18 ? false : true });
  // history
  await createTx({ kit: kit.id, to_entity: warehouse.id, created_by: techs[0].id });
  if (i > 5 && i <= 15) {
    await createTx({ kit: kit.id, from_entity: warehouse.id, to_entity: customers[i % 3].id, created_by: techs[i % 5].id });
  }
  if (i > 15 && i <= 18) {
    await createTx({ kit: kit.id, from_entity: customers[i % 3].id, to_entity: warehouse.id, created_by: techs[i % 5].id });
  }
}
```

- [ ] **Step 3: Run seed against fresh PB**

```bash
# Wipe local PB and re-bootstrap
rm -rf pb/pb_data
bash pb/start-pb.sh &
sleep 3
PB_URL=http://127.0.0.1:8090 \
  PB_SUPERUSER_EMAIL=$PB_SUPERUSER_EMAIL PB_SUPERUSER_PASSWORD=$PB_SUPERUSER_PASSWORD \
  node scripts/seed_demo_data.mjs
```

- [ ] **Step 4: Verify counts**

```bash
TOKEN=$(...auth...)
for c in entities kits users transactions; do
  echo -n "$c: "
  curl -s "http://127.0.0.1:8090/api/collections/$c/records?perPage=1" -H "Authorization: $TOKEN" | jq -r .totalItems
done
```

Expected: entities ≥ 4, kits = 20, users ≥ 6, transactions ≥ 30.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed_demo_data.mjs
git commit -m "feat(demo-seed): field-service flavor — warehouse + 3 customers + 5 techs"
git push
```

---

## Task 16: Pilot runbook

**Files:**
- Create: `docs/pilot-runbook.md`

- [ ] **Step 1: Draft runbook**

```markdown
# Pilot Deployment Runbook

## Pre-flight checklist
- [ ] You have a Fly.io account and `flyctl` installed
- [ ] You have a Twilio account with WhatsApp sandbox enabled
- [ ] You have a domain (or are OK with `<app>.fly.dev`)

## 1. Deploy PocketBase + frontend

```bash
flyctl apps create kit-tracker-<pilot-name>
flyctl volumes create pb_data --size 1 --region fra
flyctl secrets set \
  PB_SUPERUSER_EMAIL=<admin-email> \
  PB_SUPERUSER_PASSWORD=<strong-pass> \
  CLAUDE_API_KEY=<anthropic-key> \
  TWILIO_ACCOUNT_SID=<twilio-sid> \
  TWILIO_AUTH_TOKEN=<twilio-auth> \
  TWILIO_BASIC_AUTH=$(echo -n "<sid>:<auth>" | base64) \
  TWILIO_WA_FROM=whatsapp:+14155238886 \
  APP_BASE_URL=https://kit-tracker-<pilot-name>.fly.dev \
  DEFAULT_WAREHOUSE_ENTITY_ID=<set-after-seed>

flyctl deploy --remote-only
```

## 2. Configure Twilio webhook

Twilio console → Programmable Messaging → WhatsApp sandbox:
- "WHEN A MESSAGE COMES IN" → `https://kit-tracker-<pilot-name>.fly.dev/api/wa/webhook`
- Method: POST

## 3. Seed initial data

Two paths:

**A. Demo seed** (use for evaluation):
```bash
PB_URL=https://kit-tracker-<pilot-name>.fly.dev \
  PB_SUPERUSER_EMAIL=<admin-email> PB_SUPERUSER_PASSWORD=<pass> \
  node scripts/seed_demo_data.mjs
```

**B. Production seed** (start clean):
- Log in to PB admin at `/`_`/`
- Create entities (warehouse + customer sites)
- Set `DEFAULT_WAREHOUSE_ENTITY_ID` Fly secret to the warehouse ID
- Create technician users with `role=technician` and real phone numbers
- Bulk-import kits via the CSV import UI

## 4. Onboard the pilot team

Send each technician `docs/pilot-onboarding.md` and the Twilio sandbox join code separately.

## 5. Monitor

- `flyctl logs -f` — tail logs
- PB admin `/_/` — view audit log
- Web `/audit` with `via=wa-bot` filter — see WhatsApp moves

## Known issues / limitations
- Twilio sandbox shows shared number, not your business number. Production needs Meta approval (~1-2 weeks).
- No automated daily backup. Run `bash scripts/backup-pb-data.sh` manually OR via Fly cron. **Action item for ops hardening phase 2.**
- No Sentry / uptime monitoring. **Action item for ops hardening phase 2.**
- `client_secret_*.json` for Google OAuth must be removed from repo + rotated before pilot starts.

## Escalation
- Bug or outage: contact hadassi@<email>
- WhatsApp sandbox expired: technicians re-send join code from their phone
- Need to add a new technician mid-pilot: admin creates user via PB admin or /users page, sets role=technician + phone
```

- [ ] **Step 2: Commit**

```bash
git add docs/pilot-runbook.md
git commit -m "docs(pilot): runbook — Fly deploy + Twilio sandbox + seed + onboarding"
git push
```

---

## Task 17: README rewrite

**Files:**
- Modify: `README.md`
- Add: `docs/screenshots/wa-move.png`, `docs/screenshots/web-timeline.png`, `docs/screenshots/audit-filter.png`

- [ ] **Step 1: Capture 3 screenshots**

Run the app with demo seed, capture:
1. WhatsApp move confirm prompt + YES + done (phone screenshot or terminal log of webhook)
2. `/kits/:id` timeline with WhatsApp origin badge
3. `/audit` filtered by `via=wa-bot`

Save in `docs/screenshots/`.

- [ ] **Step 2: Rewrite README lead section**

Replace first ~30 lines with:

```markdown
# Kit Tracker

A WhatsApp-driven kit tracker for field-service and IT ops teams. Technicians log moves from their phone; admins audit on the web.

![WhatsApp move confirm](docs/screenshots/wa-move.png)

## How it works

1. **Technician on phone**: sends `move <KIT-SERIAL> to <ENTITY>` over WhatsApp. Bot confirms in plain text. Technician replies `YES`. Move logged.
2. **Admin on web**: sees the move in the kit timeline with a WhatsApp origin badge, filters audit log by source, exports CSV.

![Web timeline](docs/screenshots/web-timeline.png)

## Stack

- **Backend**: PocketBase v0.22 (Go + SQLite + Goja JS hooks) on Fly.io
- **Frontend**: React 18 + Vite + Tailwind + Radix UI
- **WhatsApp**: Twilio sandbox (production migration documented)
- **AI**: Anthropic Claude Haiku 4.5 for intent + tool routing

## Quick start

See `docs/pilot-runbook.md` for production deployment.

For local development:

[existing dev setup section unchanged]
```

Keep the rest of the README (Docker, Fly, environment, etc.) below.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/screenshots/
git commit -m "docs(readme): WhatsApp-first lead with screenshots + flow"
git push
```

---

## Task 18: Pitch one-pager + screen recording

**Files:**
- Create: `docs/pilot-pitch.md`
- Create: `docs/screenshots/wa-flow.gif` (or .mp4)

- [ ] **Step 1: Record a 30-second screen capture of the full flow**

Suggested capture (split-screen or sequential):
1. WhatsApp on phone: send move → see confirm → reply YES → see done
2. Web /kits/:id: timeline shows new row with WhatsApp badge
3. Web /audit filtered by wa-bot: see the audit row

Save as `docs/screenshots/wa-flow.gif` (use `ffmpeg` or any screen-recorder + GIF converter).

- [ ] **Step 2: Draft pitch one-pager**

```markdown
# Kit Tracker — Pilot Pitch

**Who it's for:** Field-service and IT ops teams that ship kits to customer sites and need a no-friction way to log every move.

**The problem:** Field techs don't open web apps mid-shift. Excel sheets and email threads lose moves. By the time the admin asks "where's KIT-007?", the answer is buried in three Slack channels and one phone call.

**The pitch:** Techs send a WhatsApp message: `move KIT-007 to ACME-LAB`. Bot confirms. Tech replies YES. Move logged with full audit trail. Admin opens the web app, filters by `via=wa-bot`, exports CSV for the QBR.

**See it work:** `docs/screenshots/wa-flow.gif` — 30 seconds.

## What's in the pilot

- WhatsApp move + return flow via Twilio sandbox (each tech joins with a code, ~2 min)
- Web admin: kit timeline, audit log with source filter, CSV export per kit
- AI-powered serial + entity resolution (handles "Move kit 5 to lab Alpha")
- Append-only audit trail — no history is ever lost

## What's NOT in the pilot (yet)

- Production Twilio number (sandbox shared number for now)
- Daily automated backup (manual snapshots during pilot)
- Public QR scan landing (later phase)
- Maintenance schedules (later phase)
- Components catalog UX polish (later phase)

## Ask

- 1-2 weeks of evaluation by 3-5 of your techs + 1 admin
- 30-min kickoff call for onboarding
- Weekly 15-min check-in for the duration
- Honest feedback at the end

## Stack + cost

- Self-hostable on a $5/mo Fly.io machine
- Twilio sandbox is free; production is ~$5-20/mo
- Anthropic Claude API: ≤$30/mo at expected pilot volume (≤500 messages)

## Next steps

- Approve pilot: I deploy a dedicated instance under `<your-name>.kit-tracker.com` (or `kit-tracker-<your-name>.fly.dev`)
- Share `docs/pilot-onboarding.md` with your techs
- Schedule kickoff call
```

- [ ] **Step 3: Commit**

```bash
git add docs/pilot-pitch.md docs/screenshots/wa-flow.gif
git commit -m "docs(pilot): pitch one-pager + 30s flow recording"
git push
```

---

## Task 19: Final sweep — definition-of-done check

**Files:** none — verification only.

- [ ] **Step 1: Walk the 9 definition-of-done items from the spec**

For each, run the check:

| # | Check | Pass? |
|---|---|---|
| 1 | New tech sandbox flow works end-to-end | run `scripts/wa_e2e_test.sh` |
| 2 | Three RETURN phrasings move kit to default warehouse | re-run scripts/wa_e2e_test.sh with variants |
| 3 | Admin can filter audit by `via=wa-bot` | `npx playwright test audit-via-filter` |
| 4 | Kit detail timeline shows origin badge | open `/kits/<id>` in browser |
| 5 | Admin can Deactivate from kit detail | `npx playwright test e2e/kits.spec.ts -g "deactivates"` |
| 6 | Denied users cannot access mid-session | `npx playwright test denied-mid-session` |
| 7 | All 3 pilot docs merged | `ls docs/pilot-*.md` |
| 8 | Demo seed matches pitch | re-seed + open `/kits` |
| 9 | README rewritten with screenshots | check `README.md` and `docs/screenshots/` |

- [ ] **Step 2: If any FAIL, route back to the relevant Task in W1-W4**

- [ ] **Step 3: Final commit (none expected unless cleanup)**

---

## Task 20: Cut the pilot tag + push

**Files:** none — git only.

- [ ] **Step 1: Run full e2e suite**

```bash
cd frontend && npm run test
```

Expected: green. If not, triage.

- [ ] **Step 2: Tag**

```bash
git tag -a pilot-v1 -m "Pilot-ready: WhatsApp wedge + admin oversight"
git push origin pilot-v1
```

- [ ] **Step 3: Deploy to a fresh Fly app for pilot demo**

Follow `docs/pilot-runbook.md` against a new Fly app name.

- [ ] **Step 4: Walk the demo end-to-end on the deployed instance**

If anything regresses vs local, triage + fix in a hotfix commit.

- [ ] **Step 5: Hand off**

Notify pilot contact. Share `docs/pilot-pitch.md` + `docs/screenshots/wa-flow.gif`. Schedule kickoff.

---

## Out-of-scope reference

The spec section 2 "Out of scope" list applies. Do NOT touch any of:
- Public QR scan landing page
- Requests workflow polish
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
- PB SDK upgrade
- Type generation
- `KitDetailPage.tsx` refactor
- Daily backup cron / monitoring
- Twilio production migration

If a task seems to require touching one of these, stop and flag it. Spec section 6 risks apply.
