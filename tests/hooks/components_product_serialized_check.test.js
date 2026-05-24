import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Hook under test: components_product_serialized_check.pb.js
// Enforces serial/qty rules based on the linked product's is_serialized flag:
//   - serialized product → non-empty serial required; is_bulk forced false; quantity NULLed in DB
//   - bulk product       → serial must be empty; is_bulk forced true; quantity >= 1 required
describe("components_product_serialized_check hook", () => {
  let pb, baseUrl, adminToken, serializedProductId, bulkProductId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    // The components field guard (components_validate.pb.js) rejects callers
    // without admin/technician role — superuser panel token has no role, so
    // authenticate as the seeded app admin user.
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    serializedProductId = await createProduct("Serialized Product", true);
    bulkProductId = await createProduct("Bulk Product", false);
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createProduct(name, is_serialized) {
    const res = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, is_serialized, is_active: true }),
    });
    if (res.status !== 200) throw new Error(`product create failed: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
  }

  // Send is_bulk explicitly to avoid ordering-dependent failures between hooks
  // (components_validate may run before components_product_serialized_check sets is_bulk).
  async function createSerialized(serial, is_active) {
    return fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial, product: serializedProductId, is_active, is_bulk: false }),
    });
  }

  async function createBulk(quantity, is_active) {
    return fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ product: bulkProductId, quantity, is_active, is_bulk: true }),
    });
  }

  async function patchComponent(id, patch) {
    return fetch(`${baseUrl}/api/collections/components/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // 1. Happy path: serialized product + non-empty serial → 200
  it("serialized product with non-empty serial is accepted (200)", async () => {
    const res = await createSerialized("SER-HAPPY-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("SER-HAPPY-001");
    expect(body.is_bulk).toBe(false);
  });

  // 2. Serialized product + empty serial → 400
  it("serialized product with empty serial is rejected (400)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "", product: serializedProductId, is_active: true, is_bulk: false }),
    });
    expect(res.status).toBe(400);
  });

  // 3. Serialized component: quantity sent by client must be coerced away.
  // Goja can't store true NULL via record.set(), so the Before hook sets it to 0
  // in-memory; the After hook corrects DB to true NULL via raw SQL UPDATE.
  // The REST response echoes the in-memory value (0), NOT the client-sent value (5).
  it("serialized component quantity is coerced to null/0, not the client-sent value", async () => {
    const res = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      // Send quantity:5 alongside a valid serial — hook must overwrite it
      body: JSON.stringify({ serial: "SER-QTY-001", product: serializedProductId, is_active: true, is_bulk: false, quantity: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // REST response echoes 0 (Goja null→0 coercion); DB holds true NULL.
    // Either way, 5 must NOT survive.
    expect(body.quantity).not.toBe(5);
  });

  // 4. Happy path: bulk product + quantity >= 1 + empty serial → 200
  it("bulk product with quantity >= 1 and no serial is accepted (200)", async () => {
    const res = await createBulk(5, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_bulk).toBe(true);
    expect(body.quantity).toBe(5);
  });

  // 5. Bulk product + non-empty serial → 400
  it("bulk product with a non-empty serial is rejected (400)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "X", product: bulkProductId, is_active: true, is_bulk: true }),
    });
    expect(res.status).toBe(400);
  });

  // 6. Bulk product + quantity < 1 → 400
  it("bulk product with quantity 0 is rejected (400)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ product: bulkProductId, quantity: 0, is_active: true, is_bulk: true }),
    });
    expect(res.status).toBe(400);
  });

  // 7. Update path: patch a serialized component to clear its serial → 400
  it("patching serialized component serial to empty is rejected (400)", async () => {
    const createRes = await createSerialized("SER-PATCH-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    const res = await patchComponent(compId, { serial: "" });
    expect(res.status).toBe(400);
  });
});
