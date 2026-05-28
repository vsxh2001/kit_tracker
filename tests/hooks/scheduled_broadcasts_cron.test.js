import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /_test/scheduled-broadcasts-cron (dry-run trigger route).
// Source: pb/pb_hooks/scheduled_broadcasts_cron.pb.js
//
// The route runs the full schedule-dispatch logic (DB queries, cron matching,
// recipient resolution) but skips the actual WA HTTP send. It also updates
// last_run_at + last_result on matched schedules to mirror real cron behavior.
//
// No fake WA creds needed — the dry-run never calls $http.send().

describe("scheduled_broadcasts_cron hook (/_test/scheduled-broadcasts-cron)", () => {
  let pb, baseUrl, suToken, adminToken, userToken;
  let adminUserId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Fetch the seeded admin's id for phone updates
    const adminListRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D%22admin%40hook-test.local%22`,
      { headers: { Authorization: suToken } }
    );
    const adminList = await adminListRes.json();
    adminUserId = adminList.items[0].id;

    // Create a non-admin user for auth-gate tests
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@sched-bcast-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Sched Broadcast Test User",
      }),
    });
    userToken = await authUser(baseUrl, "user@sched-bcast-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function trigger(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${baseUrl}/_test/scheduled-broadcasts-cron${qs ? "?" + qs : ""}`;
    const headers = {};
    if (token) headers["Authorization"] = token;
    return fetch(url, { method: "POST", headers });
  }

  async function createSchedule({ name, cronExpr, enabled = true, recipientFilter, message }) {
    const res = await fetch(`${baseUrl}/api/collections/scheduled_broadcasts/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        cron_expression: cronExpr,
        enabled,
        recipient_filter: JSON.stringify(recipientFilter),
        message: JSON.stringify(message),
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }

  async function deleteSchedule(id) {
    await fetch(`${baseUrl}/api/collections/scheduled_broadcasts/records/${id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  }

  async function getSchedule(id) {
    const res = await fetch(`${baseUrl}/api/collections/scheduled_broadcasts/records/${id}`, {
      headers: { Authorization: suToken },
    });
    return res.json();
  }

  // -------------------------------------------------------------------------
  // Auth gates
  // -------------------------------------------------------------------------

  it("returns 403 without Authorization header", async () => {
    const res = await trigger(null);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await trigger(userToken);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  // -------------------------------------------------------------------------
  // No enabled schedules
  // -------------------------------------------------------------------------

  it("returns empty results when no enabled schedules exist", async () => {
    const res = await trigger(adminToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.schedules_checked).toBe(0);
    expect(body.schedules_matched).toBe(0);
    expect(body.results).toHaveLength(0);
  });

  it("does not include disabled schedules", async () => {
    const id = await createSchedule({
      name: "Disabled schedule",
      cronExpr: "* * * * *",
      enabled: false,
      recipientFilter: { type: "phones", value: ["+15551234567"] },
      message: { type: "text", text: "hello" },
    });
    try {
      const res = await trigger(adminToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schedules_checked).toBe(0);
    } finally {
      await deleteSchedule(id);
    }
  });

  // -------------------------------------------------------------------------
  // Cron matching
  // -------------------------------------------------------------------------

  it("matches a schedule with '* * * * *' (every minute) without force flag", async () => {
    const id = await createSchedule({
      name: "Always match",
      cronExpr: "* * * * *",
      recipientFilter: { type: "phones", value: [] },
      message: { type: "text", text: "hello" },
    });
    try {
      const res = await trigger(adminToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schedules_matched).toBe(1);
      expect(body.results[0].cron_matched).toBe(true);
    } finally {
      await deleteSchedule(id);
    }
  });

  it("runs a non-matching schedule when force=1 is set", async () => {
    // "0 0 31 2 0" = midnight on Feb 31st (Sun) — effectively never fires
    const id = await createSchedule({
      name: "Never matches",
      cronExpr: "0 0 31 2 0",
      recipientFilter: { type: "phones", value: [] },
      message: { type: "text", text: "hello" },
    });
    try {
      // Without force: not matched
      const resNoForce = await trigger(adminToken);
      const bodyNoForce = await resNoForce.json();
      expect(bodyNoForce.schedules_matched).toBe(0);

      // With force=1: matched
      const resForce = await trigger(adminToken, { force: "1" });
      const bodyForce = await resForce.json();
      expect(bodyForce.schedules_matched).toBe(1);
      expect(bodyForce.results[0].cron_matched).toBe(true);
    } finally {
      await deleteSchedule(id);
    }
  });

  // -------------------------------------------------------------------------
  // Recipient resolution
  // -------------------------------------------------------------------------

  it("resolves explicit phone numbers from phones filter", async () => {
    const id = await createSchedule({
      name: "Phones filter test",
      cronExpr: "* * * * *",
      recipientFilter: { type: "phones", value: ["+15551111111", "+15552222222"] },
      message: { type: "text", text: "hello" },
    });
    try {
      const res = await trigger(adminToken);
      const body = await res.json();
      expect(body.results[0].totalRecipients).toBe(2);
      expect(body.results[0].skipped).toBeNull();
    } finally {
      await deleteSchedule(id);
    }
  });

  it("resolves users by role from role filter when admin has a phone", async () => {
    // Give the seeded admin a phone
    await fetch(`${baseUrl}/api/collections/users/records/${adminUserId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15559876543" }),
    });
    const id = await createSchedule({
      name: "Role filter test",
      cronExpr: "* * * * *",
      recipientFilter: { type: "role", value: "admin" },
      message: { type: "text", text: "hello" },
    });
    try {
      const res = await trigger(adminToken);
      const body = await res.json();
      expect(body.results[0].totalRecipients).toBeGreaterThanOrEqual(1);
      expect(body.results[0].skipped).toBeNull();
    } finally {
      await deleteSchedule(id);
      await fetch(`${baseUrl}/api/collections/users/records/${adminUserId}`, {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "" }),
      });
    }
  });

  it("returns skipped=no_recipients for an empty phones list", async () => {
    const id = await createSchedule({
      name: "Empty phones",
      cronExpr: "* * * * *",
      recipientFilter: { type: "phones", value: [] },
      message: { type: "text", text: "hello" },
    });
    try {
      const res = await trigger(adminToken);
      const body = await res.json();
      expect(body.results[0].totalRecipients).toBe(0);
      expect(body.results[0].skipped).toBe("no_recipients");
    } finally {
      await deleteSchedule(id);
    }
  });

  it("returns skipped=invalid_json for a schedule with malformed recipient_filter", async () => {
    // Create with valid JSON then PATCH to invalid string (bypass collection rule)
    const id = await createSchedule({
      name: "Invalid JSON test",
      cronExpr: "* * * * *",
      recipientFilter: { type: "phones", value: [] },
      message: { type: "text", text: "hi" },
    });
    // Patch recipient_filter to invalid JSON via superuser token
    await fetch(`${baseUrl}/api/collections/scheduled_broadcasts/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_filter: "not-valid-json{" }),
    });
    try {
      const res = await trigger(adminToken, { force: "1" });
      const body = await res.json();
      const r = body.results.find((x) => x.id === id);
      expect(r).toBeDefined();
      expect(r.skipped).toBe("invalid_json");
    } finally {
      await deleteSchedule(id);
    }
  });

  // -------------------------------------------------------------------------
  // last_run_at + last_result updated after dry-run
  // -------------------------------------------------------------------------

  it("updates last_run_at and last_result on matched schedules", async () => {
    const id = await createSchedule({
      name: "DB update test",
      cronExpr: "* * * * *",
      recipientFilter: { type: "phones", value: ["+15550000001"] },
      message: { type: "text", text: "ping" },
    });
    try {
      const before = await getSchedule(id);
      expect(before.last_run_at).toBeFalsy();

      await trigger(adminToken);

      const after = await getSchedule(id);
      expect(after.last_run_at).toBeTruthy();

      const result = JSON.parse(after.last_result);
      expect(result.dryRun).toBe(true);
      expect(result.totalRecipients).toBe(1);
    } finally {
      await deleteSchedule(id);
    }
  });
});
