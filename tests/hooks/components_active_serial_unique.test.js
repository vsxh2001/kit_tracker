import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

describe("components_active_serial_unique hook", () => {
  let pb, baseUrl, suToken;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createComponent(serial, is_active, is_bulk = false) {
    return fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial, type: "test-type", is_active, is_bulk }),
    });
  }

  async function patchComponent(id, patch) {
    return fetch(`${baseUrl}/api/collections/components/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Happy path: create active serialized component with unique serial
  it("creating a new active serialized component with unique serial is allowed", async () => {
    const res = await createComponent("COMP-UNIQUE-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("COMP-UNIQUE-001");
  });

  // Conflict: create second active serialized component with same serial
  it("creating second active serialized component with same serial is rejected (400)", async () => {
    await createComponent("COMP-DUP-001", true);
    const res = await createComponent("COMP-DUP-001", true);
    expect(res.status).toBe(400);
  });

  // Soft-deleted bypass: create active component with same serial as soft-deleted one
  it("creating active component with same serial as soft-deleted component is allowed", async () => {
    const createRes = await createComponent("COMP-RETIRE-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    // soft-delete it
    const retireRes = await patchComponent(compId, { is_active: false });
    expect(retireRes.status).toBe(200);

    // create new active component with same serial — allowed
    const res = await createComponent("COMP-RETIRE-001", true);
    expect(res.status).toBe(200);
  });

  // Update path: rename serial to conflict with another active serialized component
  it("renaming active component serial to conflict with another active component is rejected (400)", async () => {
    await createComponent("COMP-TAKEN-001", true);
    const createRes = await createComponent("COMP-RENAME-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    const res = await patchComponent(compId, { serial: "COMP-TAKEN-001" });
    expect(res.status).toBe(400);
  });

  // Self-update: update own notes without changing serial
  it("updating active component's own notes without changing serial is allowed", async () => {
    const createRes = await createComponent("COMP-SELFUPDATE-001", true);
    expect(createRes.status).toBe(200);
    const compId = (await createRes.json()).id;

    const res = await patchComponent(compId, { notes: "updated notes" });
    expect(res.status).toBe(200);
  });

  // Bulk component: same serial as active bulk is allowed (bulk exempt)
  it("creating active bulk component with same serial as another active bulk is allowed", async () => {
    await createComponent("BULK-SERIAL-001", true, true);
    const res = await createComponent("BULK-SERIAL-001", true, true);
    expect(res.status).toBe(200);
  });
});
