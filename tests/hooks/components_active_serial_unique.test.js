import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Components are product-driven: serial/bulk semantics derive from the linked
// product's is_serialized flag (see components_product_serialized_check.pb.js).
//   - serialized product → component must have a non-empty serial, is_bulk forced false
//   - bulk product       → component must have empty serial + quantity >= 1, is_bulk forced true
// The active-serial-unique hook only constrains active, non-bulk, non-empty-serial
// components; bulk components are exempt.
describe("components_active_serial_unique hook", () => {
  let pb, baseUrl, adminToken, serializedProductId, bulkProductId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    // The components field guard (components_validate.pb.js) blocks protected-field
    // updates for callers without admin/technician role — a superuser panel token
    // has no role, so authenticate as the seeded app admin user instead.
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

  // Send is_bulk explicitly, mirroring the real client (AddComponentDialog
  // sets `is_bulk: !isSerialized`). Two onModelBeforeCreate hooks fire for
  // components and their order is not guaranteed across boots: if
  // components_validate runs before components_product_serialized_check (which
  // is what would otherwise set is_bulk from the product), validate sees the
  // unset is_bulk=false + empty serial and rejects. Sending is_bulk removes
  // that ordering dependence and keeps the test deterministic.
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

  // Happy path: create active serialized component with unique serial
  it("creating a new active serialized component with unique serial is allowed", async () => {
    const res = await createSerialized("COMP-UNIQUE-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("COMP-UNIQUE-001");
  });

  // Conflict: create second active serialized component with same serial
  it("creating second active serialized component with same serial is rejected (400)", async () => {
    await createSerialized("COMP-DUP-001", true);
    const res = await createSerialized("COMP-DUP-001", true);
    expect(res.status).toBe(400);
  });

  // Serial reuse is allowed after soft-delete, matching kits/entities behavior.
  // Migration 1780100000 changed idx_components_serial from a global unique index
  // to WHERE is_active = 1, so retired component serials can be reassigned.
  it("serial of a soft-deleted component can be reused by a new active component", async () => {
    const createRes = await createSerialized("COMP-RETIRE-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    // soft-delete it
    const retireRes = await patchComponent(compId, { is_active: false });
    expect(retireRes.status).toBe(200);

    // reusing the serial on a new active component is now allowed
    const res = await createSerialized("COMP-RETIRE-001", true);
    expect(res.status).toBe(200);
  });

  // Reactivating a soft-deleted component whose serial was reused is rejected by
  // the update hook (the hook still enforces active-unique semantics).
  it("reactivating a soft-deleted component whose serial is taken is rejected (400)", async () => {
    const createRes = await createSerialized("COMP-REACT-001", true);
    expect(createRes.status).toBe(200);
    const oldId = (await createRes.json()).id;

    // soft-delete it
    await patchComponent(oldId, { is_active: false });

    // new component reuses the serial
    const newRes = await createSerialized("COMP-REACT-001", true);
    expect(newRes.status).toBe(200);

    // reactivating the old one conflicts with the new active one
    const reactivateRes = await patchComponent(oldId, { is_active: true });
    expect(reactivateRes.status).toBe(400);
  });

  // Update path: rename serial to conflict with another active serialized component
  it("renaming active component serial to conflict with another active component is rejected (400)", async () => {
    await createSerialized("COMP-TAKEN-001", true);
    const createRes = await createSerialized("COMP-RENAME-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    const res = await patchComponent(compId, { serial: "COMP-TAKEN-001" });
    expect(res.status).toBe(400);
  });

  // Self-update: update own notes without changing serial
  it("updating active component's own notes without changing serial is allowed", async () => {
    const createRes = await createSerialized("COMP-SELFUPDATE-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    const res = await patchComponent(compId, { notes: "updated notes" });
    expect(res.status).toBe(200);
  });

  // Bulk components are exempt from the active-serial-unique rule — two are allowed
  it("creating multiple active bulk components is allowed (bulk exempt from serial uniqueness)", async () => {
    const first = await createBulk(5, true);
    expect(first.status).toBe(200);
    const second = await createBulk(3, true);
    expect(second.status).toBe(200);
  });
});
