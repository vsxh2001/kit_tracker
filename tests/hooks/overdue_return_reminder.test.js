import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /_test/overdue-reminder (manual trigger route).
// Source: pb/pb_hooks/overdue_return_reminder.pb.js
//
// The route queries fulfilled requests with expected_return in the past,
// then emails admins. SMTP is unconfigured in the test env so sent=0 always,
// but skipped/fired distinguish the code paths.

describe("overdue_return_reminder hook (/_test/overdue-reminder)", () => {
  let pb, baseUrl, suToken, adminToken, userToken;
  let requesterId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const userRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@overdue-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Overdue Test User",
      }),
    });
    requesterId = (await userRes.json()).id;
    userToken = await authUser(baseUrl, "user@overdue-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createFulfilledRequest({ expectedReturn }) {
    const res = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: requesterId,
        date: new Date().toISOString().slice(0, 10),
        delivery_date: new Date().toISOString().slice(0, 10),
        status: "fulfilled",
        expected_return: expectedReturn,
        notes: "overdue-reminder test",
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }

  it("returns 403 without Authorization header", async () => {
    const res = await fetch(`${baseUrl}/_test/overdue-reminder`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/_test/overdue-reminder`, {
      method: "POST",
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
  });

  it("returns skipped=no_overdue when no fulfilled requests have past expected_return", async () => {
    const res = await fetch(`${baseUrl}/_test/overdue-reminder`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.skipped).toBe("no_overdue");
    expect(body.sent).toBe(0);
  });

  it("does not count a fulfilled request with future expected_return as overdue", async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await createFulfilledRequest({ expectedReturn: future });
    const res = await fetch(`${baseUrl}/_test/overdue-reminder`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.skipped).toBe("no_overdue");
  });

  it("returns skipped=null and sent=0 when overdue requests exist (SMTP not configured)", async () => {
    await createFulfilledRequest({ expectedReturn: "2020-01-01" });
    const res = await fetch(`${baseUrl}/_test/overdue-reminder`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.skipped).toBeNull();
    expect(typeof body.sent).toBe("number");
  });
});
