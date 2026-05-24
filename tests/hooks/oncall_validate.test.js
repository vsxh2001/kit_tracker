import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("oncall_validate hook", () => {
  let pb, baseUrl, suToken;
  let adminUserId, techUserId, plainUserId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Get the seeded admin user's id
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminUserId = (await adminRes.json()).items[0].id;

    // Create a technician user
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tech@oncall-test.local",
        password: "Techpass1!",
        passwordConfirm: "Techpass1!",
        role: "technician",
        name: "OnCall Tech",
      }),
    });
    const techRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"tech@oncall-test.local"`,
      { headers: { Authorization: suToken } }
    );
    techUserId = (await techRes.json()).items[0].id;

    // Create a plain "user"-role user
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "plain@oncall-test.local",
        password: "Plainpass1!",
        passwordConfirm: "Plainpass1!",
        role: "user",
        name: "OnCall Plain",
      }),
    });
    const plainRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"plain@oncall-test.local"`,
      { headers: { Authorization: suToken } }
    );
    plainUserId = (await plainRes.json()).items[0].id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  function shiftPayload(userId, startOffsetHours, durationHours) {
    const start = new Date(Date.now() + startOffsetHours * 3600000);
    const end = new Date(start.getTime() + durationHours * 3600000);
    return {
      user: userId,
      start_at: start.toISOString().replace("T", " "),
      end_at: end.toISOString().replace("T", " "),
      created_by: adminUserId,
    };
  }

  it("valid shift with admin user (end > start) → success", async () => {
    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(shiftPayload(adminUserId, 1, 8)),
    });
    expect(res.status).toBe(200);
  });

  it("valid shift with technician user → success", async () => {
    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(shiftPayload(techUserId, 10, 8)),
    });
    expect(res.status).toBe(200);
  });

  it("end_at <= start_at → 400", async () => {
    const start = new Date(Date.now() + 3600000);
    const end = new Date(start.getTime() - 1); // end before start
    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        user: adminUserId,
        start_at: start.toISOString().replace("T", " "),
        end_at: end.toISOString().replace("T", " "),
        created_by: adminUserId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("user with role 'user' (not admin/technician) → 400", async () => {
    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(shiftPayload(plainUserId, 20, 8)),
    });
    expect(res.status).toBe(400);
  });

  it("update: patching end_at to before start_at → 400", async () => {
    const createRes = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(shiftPayload(adminUserId, 30, 8)),
    });
    expect(createRes.status).toBe(200);
    const shiftId = (await createRes.json()).id;

    // Shift starts at now+30h; PATCH end_at to now+1h, well before start_at.
    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records/${shiftId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        end_at: new Date(Date.now() + 3600000).toISOString().replace("T", " "),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("update: swapping on-call user to one with invalid role → 400", async () => {
    const createRes = await fetch(`${baseUrl}/api/collections/on_call_shifts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(shiftPayload(adminUserId, 40, 8)),
    });
    expect(createRes.status).toBe(200);
    const shiftId = (await createRes.json()).id;

    const res = await fetch(`${baseUrl}/api/collections/on_call_shifts/records/${shiftId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ user: plainUserId }),
    });
    expect(res.status).toBe(400);
  });
});
