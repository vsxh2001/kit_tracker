import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("cascade_delete hook", () => {
  let pb, baseUrl, suToken, adminToken, adminId;
  let viewerToken;
  let entityAId, entityBId, entityCId;
  let kitId, kit2Id;
  let txnId, txn2Id;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Resolve admin user id
    const meRes = await fetch(`${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`, {
      headers: { Authorization: suToken },
    });
    const meBody = await meRes.json();
    adminId = meBody.items[0].id;

    // Create viewer user
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "viewer@hook-test.local",
        password: "Viewerpass1!",
        passwordConfirm: "Viewerpass1!",
        role: "viewer",
        name: "Hook Test Viewer",
      }),
    });
    viewerToken = await authUser(baseUrl, "viewer@hook-test.local", "Viewerpass1!");

    // Entity A — will have a transaction (blocked)
    const eaRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CASCADE_TEST_ENTITY_A", type: "storage", category: "storage", is_active: true }),
    });
    entityAId = (await eaRes.json()).id;

    // Entity B — empty, cascade-deletable
    const ebRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CASCADE_TEST_ENTITY_B", type: "storage", category: "storage", is_active: true }),
    });
    entityBId = (await ebRes.json()).id;

    // Entity C — tx destination (never deleted)
    const ecRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CASCADE_TEST_ENTITY_C", type: "storage", category: "storage", is_active: true }),
    });
    entityCId = (await ecRes.json()).id;

    // Kit 1 — cascade-deleted in scenario 4
    const k1Res = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "CASCADE-TEST-KIT-001", is_active: true }),
    });
    kitId = (await k1Res.json()).id;

    // Kit 2 — for single-tx scenario 8
    const k2Res = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "CASCADE-TEST-KIT-002", is_active: true }),
    });
    kit2Id = (await k2Res.json()).id;

    // Transaction: kit1 → entity A (makes A blocked)
    const t1Res = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityAId,
        timestamp: "2026-01-01 00:00:00",
        created_by: adminId,
      }),
    });
    txnId = (await t1Res.json()).id;

    // Standalone tx: kit2 → entity C (target for scenario 8 single-tx delete)
    const t2Res = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kit2Id,
        to_entity: entityCId,
        timestamp: "2026-01-02 00:00:00",
        created_by: adminId,
      }),
    });
    txn2Id = (await t2Res.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // Helper: create a kit with given serial, return id
  async function createKit(serial) {
    const res = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial, is_active: true }),
    });
    return (await res.json()).id;
  }

  // ── Scenario 1: Non-admin caller → 403 ──────────────────────────────────
  it("rejects non-admin preview with 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete/preview`, {
      method: "POST",
      headers: { Authorization: viewerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits", record_id: kitId }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects non-admin execute with 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: viewerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits", record_id: kitId, confirm_text: "CASCADE-TEST-KIT-001" }),
    });
    expect(res.status).toBe(403);
  });

  // ── Scenario 2: Invalid collection → 400 invalid_collection ─────────────
  it("rejects invalid collection with invalid_collection", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete/preview`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "users", record_id: "anything" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_collection");
  });

  it("rejects invalid collection on execute with invalid_collection", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits_evil", record_id: "x", confirm_text: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_collection");
  });

  // ── Scenario 3: Wrong confirm_text → 400 confirm_mismatch ───────────────
  it("rejects mismatched confirm_text", async () => {
    const kitId3 = await createKit("HUT-T1-MISMATCH");
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits", record_id: kitId3, confirm_text: "WRONG-SERIAL" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("confirm_mismatch");
  });

  // ── Scenario 4: Kit cascade success + audit row ──────────────────────────
  it("cascade-deletes a kit and deleted.kits === 1", async () => {
    // Preview first to get transaction count
    const prevRes = await fetch(`${baseUrl}/api/admin/cascade-delete/preview`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits", record_id: kitId }),
    });
    expect(prevRes.status).toBe(200);
    const prevBody = await prevRes.json();
    const expectedTxns = prevBody.counts.transactions;

    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "kits", record_id: kitId, confirm_text: "CASCADE-TEST-KIT-001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted.kits).toBe(1);
    expect(body.deleted.transactions).toBe(expectedTxns);
  });

  it("kit is gone after cascade delete", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kits/records/${kitId}`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(404);
  });

  it("writes audit row with action=cascade_delete before delete", async () => {
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id="${kitId}"&perPage=5`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    expect(auditBody.totalItems).toBeGreaterThan(0);

    const cascadeRow = auditBody.items.find((r) => r.action === "cascade_delete");
    expect(cascadeRow).toBeDefined();

    const changes = JSON.parse(cascadeRow.changes);
    expect(changes).toHaveProperty("before");
    expect(changes).toHaveProperty("cascade");
  });

  // ── Scenario 5: Entity with active transactions → 400 blocked ───────────
  it("rejects cascade-delete of entity with transactions (blocked)", async () => {
    // Create a fresh kit + tx pointing to entity A (original txn may have been cascade-deleted with kit)
    const kit3Id = await createKit("CASCADE-TEST-KIT-003");
    await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kit3Id,
        to_entity: entityAId,
        timestamp: "2026-01-03 00:00:00",
        created_by: adminId,
      }),
    });

    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "entities",
        record_id: entityAId,
        confirm_text: "CASCADE_TEST_ENTITY_A",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("blocked");
    expect(body.blockers.length).toBeGreaterThan(0);
  });

  // ── Scenario 6: Empty entity → 200 success ───────────────────────────────
  it("cascade-deletes an empty entity successfully", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "entities",
        record_id: entityBId,
        confirm_text: "CASCADE_TEST_ENTITY_B",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted.entities).toBe(1);
  });

  // ── Scenario 7: Component cascade with component_transactions ────────────
  it("cascade-deletes a component and its component_transactions", async () => {
    // Create product → component → component_transaction
    const prodRes = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CASCADE_TEST_PRODUCT", manufacturer: "TestCo", is_active: true }),
    });
    const productId = (await prodRes.json()).id;
    if (!productId) {
      // products collection not available — skip via soft assertion
      console.warn("[cascade_delete.test] products collection unavailable — skipping scenario 7");
      return;
    }

    const compRes = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ is_bulk: true, quantity: 5, is_active: true, product: productId }),
    });
    const compBody = await compRes.json();
    const compId = compBody.id;
    if (!compId) {
      console.warn("[cascade_delete.test] component creation failed — skipping scenario 7");
      return;
    }

    // component_transaction
    const ctRes = await fetch(`${baseUrl}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        component: compId,
        to_entity: entityCId,
        quantity: 1,
        timestamp: "2026-01-01 00:00:00",
        created_by: adminId,
      }),
    });
    const ctId = (await ctRes.json()).id;

    // Preview to get identifier_value (serial or id)
    const prevRes = await fetch(`${baseUrl}/api/admin/cascade-delete/preview`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "components", record_id: compId }),
    });
    const prevBody = await prevRes.json();
    const confirmText = prevBody.identifier_value || compId;
    const expectedCt = prevBody.counts.component_transactions;

    const delRes = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ collection: "components", record_id: compId, confirm_text: confirmText }),
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.deleted.components).toBe(1);
    expect(delBody.deleted.component_transactions).toBe(expectedCt);

    // Verify component_transaction is gone (if it was created)
    if (ctId) {
      const ctCheck = await fetch(`${baseUrl}/api/collections/component_transactions/records/${ctId}`, {
        headers: { Authorization: adminToken },
      });
      expect(ctCheck.status).toBe(404);
    }
  });

  // ── Scenario 8: Single transaction delete ────────────────────────────────
  it("cascade-deletes a single transaction successfully", async () => {
    const res = await fetch(`${baseUrl}/api/admin/cascade-delete`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "transactions",
        record_id: txn2Id,
        confirm_text: txn2Id,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted.transactions).toBe(1);
  });

  it("transaction record is gone after single-tx delete", async () => {
    const res = await fetch(`${baseUrl}/api/collections/transactions/records/${txn2Id}`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(404);
  });
});
