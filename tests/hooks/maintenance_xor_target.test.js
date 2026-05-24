import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("maintenance_xor_target hook", () => {
  let pb, baseUrl, suToken;
  let kitId, componentId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Create a kit (is_active must be true)
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "MAINT-KIT-001", is_active: true }),
    });
    if (kitRes.status !== 200) throw new Error(`kit create failed: ${kitRes.status} ${await kitRes.text()}`);
    kitId = (await kitRes.json()).id;

    // Create a product then a component (serialized)
    const adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const prodRes = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Maint Test Product", is_serialized: true, is_active: true }),
    });
    if (prodRes.status !== 200) throw new Error(`product create failed: ${prodRes.status} ${await prodRes.text()}`);
    const productId = (await prodRes.json()).id;

    const compRes = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: "MAINT-COMP-001",
        product: productId,
        is_active: true,
        is_bulk: false,
      }),
    });
    if (compRes.status !== 200) throw new Error(`component create failed: ${compRes.status} ${await compRes.text()}`);
    componentId = (await compRes.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  const validPayload = () => ({
    type: "calibration",
    interval_days: 30,
    next_due_at: new Date(Date.now() + 86400000 * 30).toISOString().replace("T", " ").replace("Z", ""),
  });

  it("create with neither kit nor component → 400", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload() }),
    });
    expect(res.status).toBe(400);
  });

  it("create with both kit AND component → 400", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload(), kit: kitId, component: componentId }),
    });
    expect(res.status).toBe(400);
  });

  it("create with only kit → success (200/201)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload(), kit: kitId }),
    });
    expect(res.status).toBe(200);
  });

  it("update kit-only schedule to also set component → 400 /cannot reference both/i", async () => {
    // Create a valid kit-only schedule first
    const createRes = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload(), kit: kitId }),
    });
    expect(createRes.status).toBe(200);
    const scheduleId = (await createRes.json()).id;

    // Update to set component as well (now both are set)
    const res = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records/${scheduleId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ component: componentId }),
    });
    expect(res.status).toBe(400);
  });
});
