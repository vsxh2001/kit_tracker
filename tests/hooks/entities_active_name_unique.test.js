import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

describe("entities_active_name_unique hook", () => {
  let pb, baseUrl, suToken;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createEntity(name, is_active) {
    return fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "unit", is_active }),
    });
  }

  async function patchEntity(id, patch) {
    return fetch(`${baseUrl}/api/collections/entities/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Happy path: create active entity with unique name
  it("creating a new active entity with unique name is allowed", async () => {
    const res = await createEntity("Entity-Unique-001", true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Entity-Unique-001");
  });

  // Conflict: create second active entity with same name
  it("creating second active entity with same name is rejected (400)", async () => {
    await createEntity("Entity-Dup-001", true);
    const res = await createEntity("Entity-Dup-001", true);
    expect(res.status).toBe(400);
  });

  // Soft-deleted bypass: create active entity with same name as soft-deleted one
  it("creating active entity with same name as soft-deleted entity is allowed", async () => {
    const createRes = await createEntity("Entity-Retire-001", true);
    expect(createRes.status).toBe(200);
    const entityId = (await createRes.json()).id;

    // soft-delete it
    const retireRes = await patchEntity(entityId, { is_active: false });
    expect(retireRes.status).toBe(200);

    // create new active entity with same name — allowed
    const res = await createEntity("Entity-Retire-001", true);
    expect(res.status).toBe(200);
  });

  // Update path: rename to conflict with another active record
  it("renaming active entity to conflict with another active entity is rejected (400)", async () => {
    await createEntity("Entity-Taken-001", true);
    const createRes = await createEntity("Entity-Rename-001", true);
    expect(createRes.status).toBe(200);
    const entityId = (await createRes.json()).id;

    const res = await patchEntity(entityId, { name: "Entity-Taken-001" });
    expect(res.status).toBe(400);
  });

  // Self-update: update own field without changing name
  it("updating active entity's own notes without changing name is allowed", async () => {
    const createRes = await createEntity("Entity-SelfUpdate-001", true);
    expect(createRes.status).toBe(200);
    const entityId = (await createRes.json()).id;

    const res = await patchEntity(entityId, { notes: "updated notes" });
    expect(res.status).toBe(200);
  });
});
