import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Hook under test: products_defaults.pb.js
// onRecordBeforeCreateRequest on "products": fills specs with "{}" when absent or empty,
// so downstream JSON.parse never throws on a missing specs value.
describe("products_defaults hook", () => {
  let pb, baseUrl, suToken;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createProduct(body) {
    return fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("product created without specs gets specs defaulted to '{}'", async () => {
    const res = await createProduct({ name: "Prod-NoSpecs-001", is_active: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.specs).toBe("{}");
  });

  it("product created with empty-string specs gets specs defaulted to '{}'", async () => {
    const res = await createProduct({ name: "Prod-EmptySpecs-001", is_active: true, specs: "" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.specs).toBe("{}");
  });

  it("product created with non-empty specs preserves the client-supplied value", async () => {
    const specs = JSON.stringify({ weight: "1kg", color: "red" });
    const res = await createProduct({ name: "Prod-WithSpecs-001", is_active: true, specs });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.specs).toBe(specs);
  });
});
