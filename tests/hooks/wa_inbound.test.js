import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Hook under test: wa_inbound.pb.js — POST /api/wa/webhook (Twilio inbound).
//
// The handler is large; the high-value, creds-independent branches are:
//   1. HMAC-SHA1 signature gate — when WA_SKIP_SIGNATURE_CHECK=1 it is bypassed
//      (we set that so the rest of the logic is reachable in the harness).
//   2. Idempotency — a repeated MessageSid is ack'd 200 and NOT re-processed.
//   3. User resolution by phone + role gate (unknown / empty-role → friendly
//      reply, no write).
//   4. Write-intent role gate (T32) — viewers cannot move kits; the RETURN
//      shortcut and the generic write-verb path both block read-only roles
//      BEFORE any DAO write.
//   5. RETURN shortcut confirm flow — "return <serial>" stashes a directExec
//      pending; a subsequent "YES" creates a transaction (move to the configured
//      warehouse) AND writes an audit_log row tagged changes.via = "wa-bot".
//      This is the core WhatsApp "wedge" flow from the roadmap.
//
// Outbound replies go through replyViaTwilio(), which returns an EMPTY
// c.string(200, "") body (and only logs when TWILIO_* env is absent). So the
// reply TEXT is never observable over HTTP — every assertion here is on the
// HTTP status code and on database side effects (transactions / audit_log),
// never on response content.
//
// Env is process-wide and fixed at PB spawn time, so we set both knobs BEFORE
// startPb(): WA_SKIP_SIGNATURE_CHECK=1 and a fixed DEFAULT_WAREHOUSE_ENTITY_ID
// (we then create the warehouse entity with that exact id). vitest runs each
// test file in an isolated worker (fileParallelism:false + default isolate),
// so these mutations do not leak into other hook tests.

const TS = `wainbound-${Date.now()}`;
const WAREHOUSE_ID = "whse00000000001"; // 15-char PB id, set as default warehouse

process.env.WA_SKIP_SIGNATURE_CHECK = "1";
process.env.DEFAULT_WAREHOUSE_ENTITY_ID = WAREHOUSE_ID;

describe("wa_inbound hook (POST /api/wa/webhook)", () => {
  let baseUrl, suToken;
  let techPhone, viewerPhone, noRolePhone, unknownPhone;
  let techId;
  let warehouseEntityId, fieldEntityId;
  let returnKitId;

  let sidCounter = 0;
  function nextSid() {
    sidCounter += 1;
    return `${TS}-SM${sidCounter}`;
  }

  // --- helpers ------------------------------------------------------------

  async function suPost(path, body) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function createUser(email, role, phone) {
    const payload = {
      email,
      password: "Testpass1!",
      passwordConfirm: "Testpass1!",
      name: email.split("@")[0],
      role,
    };
    if (phone) payload.phone = phone;
    const res = await suPost("/api/collections/users/records", payload);
    expect(res.status, `create user ${email}`).toBe(200);
    return (await res.json()).id;
  }

  // POST a Twilio-shaped form-encoded inbound message to the webhook.
  async function inbound({ from, body, sid = nextSid() }) {
    const form = new URLSearchParams({ From: from, Body: body, MessageSid: sid });
    const res = await fetch(`${baseUrl}/api/wa/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return res;
  }

  // Count transactions for a kit that were created by the RETURN directExec path.
  async function returnTxFor(kitId) {
    const filter = encodeURIComponent(`kit = "${kitId}" && notes = "RETURN via WhatsApp"`);
    const res = await fetch(
      `${baseUrl}/api/collections/transactions/records?filter=${filter}`,
      { headers: { Authorization: suToken } }
    );
    expect(res.status).toBe(200);
    return (await res.json()).items;
  }

  // --- setup --------------------------------------------------------------

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    techPhone = "+15550000001";
    viewerPhone = "+15550000002";
    noRolePhone = "+15550000003";
    unknownPhone = "+15550009999"; // intentionally NOT attached to any user

    techId = await createUser(`${TS}-tech@wa.local`, "technician", techPhone);
    await createUser(`${TS}-viewer@wa.local`, "viewer", viewerPhone);
    await createUser(`${TS}-norole@wa.local`, "", noRolePhone);

    // Warehouse entity MUST have the id we set as DEFAULT_WAREHOUSE_ENTITY_ID.
    const whRes = await suPost("/api/collections/entities/records", {
      id: WAREHOUSE_ID,
      name: `${TS}-Warehouse`,
      category: "storage",
      is_active: true,
    });
    expect(whRes.status, "create warehouse entity").toBe(200);
    warehouseEntityId = (await whRes.json()).id;
    expect(warehouseEntityId).toBe(WAREHOUSE_ID);

    const fieldRes = await suPost("/api/collections/entities/records", {
      name: `${TS}-Field`,
      category: "field",
      is_active: true,
    });
    expect(fieldRes.status, "create field entity").toBe(200);
    fieldEntityId = (await fieldRes.json()).id;

    // Kit used by the RETURN happy-path, pre-placed at the field entity so the
    // directExec from_entity (current-holder) lookup has a value to read.
    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-RETKIT`,
      is_active: true,
    });
    expect(kitRes.status, "create return kit").toBe(200);
    returnKitId = (await kitRes.json()).id;

    const placeRes = await suPost("/api/collections/transactions/records", {
      kit: returnKitId,
      to_entity: fieldEntityId,
      timestamp: new Date().toISOString(),
      notes: "initial placement",
      created_by: techId,
    });
    expect(placeRes.status, "initial placement tx").toBe(200);
  }, 60_000);

  afterAll(async () => {
    await stopPb();
  });

  // --- basic input guards -------------------------------------------------

  it("missing Body — acks 200 silently, no crash", async () => {
    const res = await inbound({ from: `whatsapp:${techPhone}`, body: "" });
    expect(res.status).toBe(200);
  });

  it("unknown phone — replies (200), creates no transaction", async () => {
    const before = await returnTxFor(returnKitId);
    const res = await inbound({ from: `whatsapp:${unknownPhone}`, body: "where is my kit" });
    expect(res.status).toBe(200);
    const after = await returnTxFor(returnKitId);
    expect(after.length).toBe(before.length);
  });

  it("user with empty role — rejected with friendly reply (200), no write", async () => {
    const res = await inbound({ from: `whatsapp:${noRolePhone}`, body: "return SOMEKIT" });
    expect(res.status).toBe(200);
  });

  // --- T32 write-intent role gate ----------------------------------------

  it("viewer 'return <serial>' — RETURN role gate blocks, no transaction", async () => {
    const before = await returnTxFor(returnKitId);
    const res = await inbound({ from: `whatsapp:${viewerPhone}`, body: `return ${TS}-RETKIT` });
    expect(res.status).toBe(200);
    const after = await returnTxFor(returnKitId);
    expect(after.length, "viewer must not be able to move a kit").toBe(before.length);
  });

  it("viewer 'move <serial> to X' — write-verb role gate blocks, no transaction", async () => {
    const before = await returnTxFor(returnKitId);
    const res = await inbound({ from: `whatsapp:${viewerPhone}`, body: `move ${TS}-RETKIT to somewhere` });
    expect(res.status).toBe(200);
    const after = await returnTxFor(returnKitId);
    expect(after.length).toBe(before.length);
  });

  it("technician write-verb — stashes confirmation, no transaction until YES", async () => {
    // A generic write verb (not the RETURN shortcut) stashes a pending confirm
    // and returns; nothing is written until the user replies YES (which would
    // route through /api/ai/chat — not exercised here).
    const before = await returnTxFor(returnKitId);
    const res = await inbound({ from: `whatsapp:${techPhone}`, body: `please update ${TS}-RETKIT notes` });
    expect(res.status).toBe(200);
    const after = await returnTxFor(returnKitId);
    expect(after.length).toBe(before.length);
    // Clear the pending so it doesn't bleed into later technician tests.
    await inbound({ from: `whatsapp:${techPhone}`, body: "nevermind" });
  });

  // --- RETURN shortcut confirm flow (core wedge) -------------------------

  it("technician RETURN → YES — creates transaction tagged via=wa-bot, and is idempotent", async () => {
    // 1. "return <serial>" stashes a directExec pending; nothing written yet.
    const r1 = await inbound({ from: `whatsapp:${techPhone}`, body: `return ${TS}-RETKIT` });
    expect(r1.status, "RETURN confirm prompt").toBe(200);
    expect((await returnTxFor(returnKitId)).length, "no tx before YES").toBe(0);

    // 2. "YES" executes the directExec move → one RETURN transaction.
    const yesSid = nextSid();
    const r2 = await inbound({ from: `whatsapp:${techPhone}`, body: "YES", sid: yesSid });
    expect(r2.status, "YES executes move").toBe(200);

    const txs = await returnTxFor(returnKitId);
    expect(txs.length, "exactly one RETURN transaction created").toBe(1);
    const tx = txs[0];
    expect(tx.to_entity, "moved to configured warehouse").toBe(warehouseEntityId);
    expect(tx.from_entity, "from = prior holder (field entity)").toBe(fieldEntityId);
    expect(tx.created_by, "created_by = technician").toBe(techId);

    // 3. audit_log row written with changes.via = "wa-bot".
    const auditFilter = encodeURIComponent(`record_id = "${tx.id}"`);
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${auditFilter}`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const auditItems = (await auditRes.json()).items;
    expect(auditItems.length, "audit_log row for the move").toBe(1);
    const changes = JSON.parse(auditItems[0].changes);
    expect(changes.via, "audit tagged as wa-bot").toBe("wa-bot");
    expect(changes.tool).toBe("move_kit");

    // 4. Replay the SAME YES MessageSid — idempotency must dedupe, no 2nd tx.
    const r3 = await inbound({ from: `whatsapp:${techPhone}`, body: "YES", sid: yesSid });
    expect(r3.status, "duplicate sid still acks 200").toBe(200);
    expect((await returnTxFor(returnKitId)).length, "no duplicate transaction").toBe(1);
  });

  it("technician RETURN → 'no' cancels — no transaction created", async () => {
    // Use a fresh kit so the count is unambiguous.
    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-CANCELKIT`,
      is_active: true,
    });
    const cancelKitId = (await kitRes.json()).id;

    const r1 = await inbound({ from: `whatsapp:${techPhone}`, body: `return ${TS}-CANCELKIT` });
    expect(r1.status).toBe(200);

    // Anything other than YES cancels the pending confirmation.
    const r2 = await inbound({ from: `whatsapp:${techPhone}`, body: "no thanks" });
    expect(r2.status).toBe(200);

    expect((await returnTxFor(cancelKitId)).length, "cancelled — no move").toBe(0);
  });
});
