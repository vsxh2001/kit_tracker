import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/admin/revert-transaction.
//
// Source: pb/pb_hooks/admin_revert_transaction.pb.js
//   Admin-only. Hard-deletes the LATEST transaction for a kit (DAO bypass of
//   append-only deleteRule=null) and writes an audit_log row (action=delete,
//   changes.revert=true) BEFORE the delete. Rejects: non-admin (403), missing
//   ids (400), unknown tx (400), cross-kit injection (400), non-latest tx (400).

describe("admin_revert_transaction POST /api/admin/revert-transaction", () => {
  let baseUrl, suToken, adminToken, adminId, userToken;
  let entityId;

  async function createKit() {
    const res = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `REVERT-KIT-${Math.random().toString(36).slice(2)}`, is_active: true }),
    });
    return res.json();
  }

  async function createTx(kitId, isoTimestamp) {
    const res = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityId,
        timestamp: isoTimestamp,
        created_by: adminId,
      }),
    });
    return res.json();
  }

  function revert(token, body) {
    return fetch(`${baseUrl}/api/admin/revert-transaction`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const meRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await meRes.json()).items[0].id;

    // Non-admin user for the 403 path
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Hook Test User",
      }),
    });
    userToken = await authUser(baseUrl, "user@hook-test.local", "Userpass1!");

    const eRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `REVERT-ENTITY-${Date.now()}`, category: "field", is_active: true }),
    });
    entityId = (await eRes.json()).id;
  }, 60000);

  afterAll(stopPb);

  it("returns 403 for a non-admin caller", async () => {
    const res = await revert(userToken, { kit_id: "x", transaction_id: "y" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin only");
  });

  it("returns 400 when kit_id or transaction_id is missing", async () => {
    const res = await revert(adminToken, { kit_id: "only-kit" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("kit_id and transaction_id are required");
  });

  it("returns 400 for an unknown transaction_id", async () => {
    const kit = await createKit();
    const res = await revert(adminToken, { kit_id: kit.id, transaction_id: "nonexistent_tx_id" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("transaction not found");
  });

  it("returns 400 when the transaction does not belong to the given kit", async () => {
    const kitA = await createKit();
    const kitB = await createKit();
    const tx = await createTx(kitA.id, new Date().toISOString());

    const res = await revert(adminToken, { kit_id: kitB.id, transaction_id: tx.id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("transaction does not belong to this kit");
  });

  it("returns 400 when reverting a non-latest transaction", async () => {
    const kit = await createKit();
    const older = await createTx(kit.id, "2026-01-01T00:00:00.000Z");
    await createTx(kit.id, "2026-02-01T00:00:00.000Z"); // newer → latest

    const res = await revert(adminToken, { kit_id: kit.id, transaction_id: older.id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only the latest transaction may be reverted");
  });

  it("reverts the latest transaction and writes an audit_log row", async () => {
    const kit = await createKit();
    const tx = await createTx(kit.id, new Date().toISOString());

    const res = await revert(adminToken, { kit_id: kit.id, transaction_id: tx.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.transaction_id).toBe(tx.id);

    // Transaction is hard-deleted
    const gone = await fetch(`${baseUrl}/api/collections/transactions/records/${tx.id}`, {
      headers: { Authorization: suToken },
    });
    expect(gone.status).toBe(404);

    // Audit row written with action=delete and revert flag
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${tx.id}"%26%26action%3D"delete"`,
      { headers: { Authorization: suToken } }
    );
    const audit = await auditRes.json();
    expect(audit.items.length).toBeGreaterThan(0);
    const changes = JSON.parse(audit.items[0].changes);
    expect(changes.revert).toBe(true);
    expect(changes.via).toBe("web");
  });
});
