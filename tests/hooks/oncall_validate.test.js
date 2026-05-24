import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

describe("oncall_validate hook", () => {
  let pb, baseUrl, suToken;
  let adminId, technicianId, regularUserId;

  const START = "2026-06-01 08:00:00.000Z";
  const END   = "2026-06-01 16:00:00.000Z";
  const EARLY = "2026-06-01 06:00:00.000Z";

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Resolve the admin user seeded by startPb()
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0].id;

    // Technician user — valid on-call role
    const techRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tech@oncall-test.local",
        password: "Techpass1!",
        passwordConfirm: "Techpass1!",
        role: "technician",
        name: "OncallTest Tech",
      }),
    });
    technicianId = (await techRes.json()).id;

    // Regular user — invalid on-call role
    const userRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@oncall-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "OncallTest User",
      }),
    });
    regularUserId = (await userRes.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // Convenience: POST a shift with defaults, override any field via overrides.
  // Uses suToken so collection createRule is bypassed and only the hook fires.
  async function createShift(overrides = {}) {
    return fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        user: adminId,
        start_at: START,
        end_at: END,
        created_by: adminId,
        ...overrides,
      }),
    });
  }

  it("creates shift with admin user and valid times (200)", async () => {
    const res = await createShift();
    expect(res.status).toBe(200);
  });

  it("creates shift with technician user and valid times (200)", async () => {
    const res = await createShift({ user: technicianId });
    expect(res.status).toBe(200);
  });

  it("rejects shift where end_at is before start_at (400)", async () => {
    const res = await createShift({ end_at: EARLY });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/end_at must be after start_at/i);
  });

  it("rejects shift where end_at equals start_at (400)", async () => {
    const res = await createShift({ end_at: START });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/end_at must be after start_at/i);
  });

  it("rejects shift where on-call user has role 'user' (400)", async () => {
    const res = await createShift({ user: regularUserId });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/admin or technician/i);
  });

  it("update: rejects patching end_at to before start_at (400)", async () => {
    const createRes = await createShift();
    expect(createRes.status).toBe(200);
    const shiftId = (await createRes.json()).id;

    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records/${shiftId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ end_at: EARLY }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/end_at must be after start_at/i);
  });

  it("update: rejects swapping on-call user to one with invalid role (400)", async () => {
    const createRes = await createShift();
    expect(createRes.status).toBe(200);
    const shiftId = (await createRes.json()).id;

    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records/${shiftId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ user: regularUserId }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/admin or technician/i);
  });
});
