import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

describe("products_active_name_unique hook", () => {
  let pb, baseUrl, suToken;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createProduct(name, is_active) {
    return fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, is_active }),
    });
  }

  async function patchProduct(id, patch) {
    return fetch(`${baseUrl}/api/collections/products/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Happy path: create active product with unique name
  it("creating a new active product with unique name is allowed", async () => {
    const res = await createProduct("Product-Unique-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Product-Unique-001");
  });

  // Conflict: create second active product with same name
  it("creating second active product with same name is rejected (400)", async () => {
    await createProduct("Product-Dup-001", true);
    const res = await createProduct("Product-Dup-001", true);
    expect(res.status).toBe(400);
  });

  // Soft-deleted bypass: create active product with same name as soft-deleted one
  it("creating active product with same name as soft-deleted product is allowed", async () => {
    const createRes = await createProduct("Product-Retire-001", true);
    expect(createRes.status).toBe(200);
    const productId = (await createRes.json()).id;

    // soft-delete it
    const retireRes = await patchProduct(productId, { is_active: false });
    expect(retireRes.status).toBe(200);

    // create new active product with same name — allowed
    const res = await createProduct("Product-Retire-001", true);
    expect(res.status).toBe(200);
  });

  // Update path: rename to conflict with another active record
  it("renaming active product to conflict with another active product is rejected (400)", async () => {
    await createProduct("Product-Taken-001", true);
    const createRes = await createProduct("Product-Rename-001", true);
    expect(createRes.status).toBe(200);
    const productId = (await createRes.json()).id;

    const res = await patchProduct(productId, { name: "Product-Taken-001" });
    expect(res.status).toBe(400);
  });

  // Self-update: update own field without changing name
  it("updating active product's own description without changing name is allowed", async () => {
    const createRes = await createProduct("Product-SelfUpdate-001", true);
    expect(createRes.status).toBe(200);
    const productId = (await createRes.json()).id;

    const res = await patchProduct(productId, { description: "updated description" });
    expect(res.status).toBe(200);
  });
});
