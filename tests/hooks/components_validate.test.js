import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Hook under test: components_validate.pb.js
// Tests the uniquely-owned, REST-reachable logic — the component_transactions
// before-create validation: to-side XOR, from-side XOR + initial-placement
// exception, quantity >= 1, quantity overflow, source kit must be active.
//
// The hook's components-collection branches (product required, serialized needs
// serial, bulk qty >= 1) are intentionally NOT tested here: each is shadowed by
// a constraint that fires first on the REST path — `product` is schema-required
// (PB returns validation_required before the hook runs), and the serial/qty
// branches are owned by components_product_serialized_check.pb.js. So those
// branches are unreachable via REST and a test would be a false green.
describe("components_validate hook", () => {
  let baseUrl, suToken, adminToken, adminUserId;
  let bulkProductId, bulkComponentId, entityId, retiredKitId;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Fetch admin user record id (needed for created_by in component_transactions)
    const usersRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"admin@hook-test.local"`,
      { headers: { Authorization: adminToken } }
    );
    if (!usersRes.ok) throw new Error(`fetch admin user failed: ${usersRes.status}`);
    adminUserId = (await usersRes.json()).items[0].id;

    // Create a bulk product
    const prodRes = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Validate Test Bulk Product", is_serialized: false, is_active: true }),
    });
    if (prodRes.status !== 200) throw new Error(`product create failed: ${prodRes.status} ${await prodRes.text()}`);
    bulkProductId = (await prodRes.json()).id;

    // Create a bulk component with quantity 5
    const compRes = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ product: bulkProductId, quantity: 5, is_active: true, is_bulk: true }),
    });
    if (compRes.status !== 200) throw new Error(`bulk component create failed: ${compRes.status} ${await compRes.text()}`);
    bulkComponentId = (await compRes.json()).id;

    // Create an entity to use as to_entity / from_entity
    const entityRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Validate Test Entity", category: "storage", is_active: true }),
    });
    if (entityRes.status !== 200) throw new Error(`entity create failed: ${entityRes.status} ${await entityRes.text()}`);
    entityId = (await entityRes.json()).id;

    // Create a kit and then retire it (is_active=false)
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "VALIDATE-RETIRED-KIT-001", is_active: true }),
    });
    if (kitRes.status !== 200) throw new Error(`kit create failed: ${kitRes.status} ${await kitRes.text()}`);
    retiredKitId = (await kitRes.json()).id;

    const retireRes = await fetch(`${baseUrl}/api/collections/kits/records/${retiredKitId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
    if (retireRes.status !== 200) throw new Error(`kit retire failed: ${retireRes.status} ${await retireRes.text()}`);
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // Helper: create a fresh bulk component (quantity n) for tests that need a clean slate
  async function createFreshBulkComponent(quantity = 5) {
    const res = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ product: bulkProductId, quantity, is_active: true, is_bulk: true }),
    });
    if (res.status !== 200) throw new Error(`fresh bulk component create failed: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
  }

  // Helper: create a component_transaction
  function makeTxn(overrides = {}) {
    const base = {
      component: bulkComponentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    };
    return { ...base, ...overrides };
  }

  async function postTxn(payload) {
    return fetch(`${baseUrl}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  // ---- component_transactions: to-side XOR ----

  // Both to_kit AND to_entity set → 400
  it("txn with both to_kit and to_entity → 400", async () => {
    // Need a valid kit for to_kit (must be active)
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "VALIDATE-TO-BOTH-KIT-001", is_active: true }),
    });
    expect(kitRes.status).toBe(200);
    const toKitId = (await kitRes.json()).id;

    const res = await postTxn(makeTxn({ to_kit: toKitId, to_entity: entityId }));
    expect(res.status).toBe(400);
  });

  // Case 3: Neither to_kit nor to_entity set → 400
  it("txn with neither to_kit nor to_entity → 400", async () => {
    const res = await postTxn(makeTxn({ to_entity: undefined }));
    expect(res.status).toBe(400);
  });

  // Case 4: Exactly one to-side (to_entity) + valid from-side omitted (initial placement) → 200
  it("txn with exactly one to-side (initial placement, no from) → 200", async () => {
    const componentId = await createFreshBulkComponent(5);
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(res.status).toBe(200);
  });

  // ---- component_transactions: from-side XOR ----

  // Case 5: Both from_kit AND from_entity set → 400
  it("txn with both from_kit and from_entity → 400", async () => {
    // Create an active kit to use as from_kit
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "VALIDATE-FROM-BOTH-KIT-001", is_active: true }),
    });
    expect(kitRes.status).toBe(200);
    const fromKitId = (await kitRes.json()).id;

    const componentId = await createFreshBulkComponent(5);
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      from_kit: fromKitId,
      from_entity: entityId,
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });

  // Case 6: FIRST transaction for a fresh component, both from_* empty, to_entity set → 200
  it("first txn for fresh component with no from_* (initial placement) → 200", async () => {
    const componentId = await createFreshBulkComponent(5);
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(res.status).toBe(200);
  });

  // Case 7: Component ALREADY has a transaction: both from_* empty → 400
  it("second txn for component with no from_* → 400 (already has transactions)", async () => {
    const componentId = await createFreshBulkComponent(5);

    // First transaction (initial placement) — must succeed
    const firstRes = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(firstRes.status).toBe(200);

    // Second transaction with no from_* — must fail
    const secondRes = await postTxn({
      component: componentId,
      timestamp: "2026-06-02 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(secondRes.status).toBe(400);
  });

  // ---- component_transactions: quantity ----

  // Case 8: Omit quantity entirely (getInt→0) on otherwise-valid txn → 400
  it("txn with quantity omitted (defaults to 0) → 400", async () => {
    const componentId = await createFreshBulkComponent(5);
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      // quantity intentionally omitted
    });
    expect(res.status).toBe(400);
  });

  // Case 9a: Bulk component qty 5, txn quantity 10 (overflow) → 400
  it("txn quantity exceeds bulk component available quantity → 400", async () => {
    const componentId = await createFreshBulkComponent(5);
    // Initial placement first so from_* can be empty on this one
    const initRes = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(initRes.status).toBe(200);

    // Now try to move 10 from entity — but component only has 5
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-02 10:00:00.000Z",
      created_by: adminUserId,
      from_entity: entityId,
      to_entity: entityId,
      quantity: 10,
    });
    expect(res.status).toBe(400);
  });

  // Case 9b: Bulk component qty 5, txn quantity 3 (valid) → 200
  it("txn quantity within bulk component available quantity → 200", async () => {
    const componentId = await createFreshBulkComponent(5);
    // Initial placement
    const initRes = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(initRes.status).toBe(200);

    // Move 3 units — valid
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-02 10:00:00.000Z",
      created_by: adminUserId,
      from_entity: entityId,
      to_entity: entityId,
      quantity: 3,
    });
    expect(res.status).toBe(200);
  });

  // Case 10: from_kit = retired kit (is_active=false) → 400
  it("txn from_kit pointing to retired kit → 400", async () => {
    const componentId = await createFreshBulkComponent(5);
    const res = await postTxn({
      component: componentId,
      timestamp: "2026-06-01 10:00:00.000Z",
      created_by: adminUserId,
      from_kit: retiredKitId,
      to_entity: entityId,
      quantity: 1,
    });
    expect(res.status).toBe(400);
  });
});
