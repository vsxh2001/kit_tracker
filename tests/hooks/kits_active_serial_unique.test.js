import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

describe("kits_active_serial_unique hook", () => {
  let pb, baseUrl, suToken;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createKit(serial, is_active) {
    return fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial, is_active }),
    });
  }

  async function patchKit(id, patch) {
    return fetch(`${baseUrl}/api/collections/kits/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Create active kit: allowed
  it("creating a new active kit with unique serial is allowed", async () => {
    const res = await createKit("KIT-UNIQUE-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("KIT-UNIQUE-001");
  });

  // Create second active kit with same serial: rejected
  it("creating second active kit with same serial is rejected (400)", async () => {
    // ensure first one exists (from prior test or fresh)
    await createKit("KIT-DUP-001", true);
    const res = await createKit("KIT-DUP-001", true);
    expect(res.status).toBe(400);
  });

  // Create inactive kit with same serial as active one: allowed
  it("creating inactive kit with same serial as existing active kit is allowed", async () => {
    await createKit("KIT-INACTIVE-001", true);
    const res = await createKit("KIT-INACTIVE-001", false);
    expect(res.status).toBe(200);
  });

  // Soft-delete first (active=false), then create new active with same serial: allowed
  it("after retiring active kit, creating new active kit with same serial is allowed", async () => {
    const createRes = await createKit("KIT-RETIRE-001", true);
    expect(createRes.status).toBe(200);
    const kitId = (await createRes.json()).id;

    // retire it
    const retireRes = await patchKit(kitId, { is_active: false });
    expect(retireRes.status).toBe(200);

    // now create new active kit with same serial
    const res = await createKit("KIT-RETIRE-001", true);
    expect(res.status).toBe(200);
  });

  // PATCH inactive kit → active=true while same serial already active: rejected
  it("activating an inactive kit whose serial is already active is rejected (400)", async () => {
    // create active
    const activeRes = await createKit("KIT-CONFLICT-001", true);
    expect(activeRes.status).toBe(200);

    // create inactive with same serial
    const inactiveRes = await createKit("KIT-CONFLICT-001", false);
    expect(inactiveRes.status).toBe(200);
    const inactiveId = (await inactiveRes.json()).id;

    // try to activate the inactive one — hook should reject
    const res = await patchKit(inactiveId, { is_active: true });
    expect(res.status).toBe(400);
  });
});
