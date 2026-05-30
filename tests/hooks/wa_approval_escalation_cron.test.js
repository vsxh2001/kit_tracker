import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /_test/wa-approval-escalation (dry-run trigger route).
// Source: pb/pb_hooks/wa_approval_escalation_cron.pb.js
//
// The route runs the full escalation check (DB queries, pref gate, dedup check)
// but skips the actual WA HTTP send. It marks $app.store() as if a send
// succeeded so deduplication behaviour can be verified.
//
// Fake WA creds are set before startPb() so the hook reaches DB-query paths.

describe("wa_approval_escalation_cron hook (/_test/wa-approval-escalation)", () => {
  let pb, baseUrl, suToken;
  let adminToken, userToken;
  let requesterId, admin2Id;

  beforeAll(async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";

    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Second admin used for phone/pref tests (keeps the primary admin clean)
    const admin2Res = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin2@escalation-test.local",
        password: "Adminpass2!",
        passwordConfirm: "Adminpass2!",
        role: "admin",
        name: "Escalation Test Admin 2",
      }),
    });
    admin2Id = (await admin2Res.json()).id;

    // Regular user used as request requester
    const userRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "requester@escalation-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Escalation Requester",
      }),
    });
    requesterId = (await userRes.json()).id;
    userToken = await authUser(baseUrl, "requester@escalation-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  async function trigger(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${baseUrl}/_test/wa-approval-escalation${qs ? "?" + qs : ""}`;
    const headers = {};
    if (token) headers["Authorization"] = token;
    return fetch(url, { method: "POST", headers });
  }

  async function createOpenRequest() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: requesterId,
        date: today,
        delivery_date: today,
        status: "open",
        notes: "escalation cron test",
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }

  async function deleteRequest(id) {
    await fetch(`${baseUrl}/api/collections/requests/records/${id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  }

  async function patchAdmin2(fields) {
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
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
  // No pending requests
  // -------------------------------------------------------------------------

  it("returns skipped=no_pending_requests when there are no open requests", async () => {
    const res = await trigger(adminToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("no_pending_requests");
    expect(body.open_requests).toBe(0);
    expect(body.escalated).toBe(0);
  });

  it("skips a request that was just created when threshold_hours is very large", async () => {
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "99999" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe("no_pending_requests");
      expect(body.open_requests).toBe(0);
    } finally {
      await deleteRequest(id);
    }
  });

  // -------------------------------------------------------------------------
  // No admin phones
  // -------------------------------------------------------------------------

  it("returns admin_phones=0 when no admins have phone numbers", async () => {
    // admin2 has no phone at this point
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
      expect(body.open_requests).toBeGreaterThanOrEqual(1);
      expect(body.admin_phones).toBe(0);
      expect(body.escalated).toBe(0);
      expect(body.already_escalated).toBe(0);
    } finally {
      await deleteRequest(id);
    }
  });

  // -------------------------------------------------------------------------
  // Escalation + deduplication
  // -------------------------------------------------------------------------

  it("escalates open requests when an admin has a phone number (dry-run)", async () => {
    await patchAdmin2({ phone: "+15551234567" });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
      expect(body.admin_phones).toBeGreaterThanOrEqual(1);
      expect(body.escalated).toBeGreaterThanOrEqual(1);
      expect(body.already_escalated).toBe(0);
    } finally {
      await deleteRequest(id);
      await patchAdmin2({ phone: "" });
    }
  });

  it("deduplicates: second trigger for same request returns already_escalated=1", async () => {
    await patchAdmin2({ phone: "+15551234567" });
    const id = await createOpenRequest();
    try {
      const res1 = await trigger(adminToken, { threshold_hours: "0" });
      const body1 = await res1.json();
      expect(body1.escalated).toBeGreaterThanOrEqual(1);

      const res2 = await trigger(adminToken, { threshold_hours: "0" });
      const body2 = await res2.json();
      expect(body2.already_escalated).toBeGreaterThanOrEqual(1);
      expect(body2.escalated).toBe(0);
    } finally {
      await deleteRequest(id);
      await patchAdmin2({ phone: "" });
    }
  });

  // -------------------------------------------------------------------------
  // Notification pref gate
  // -------------------------------------------------------------------------

  it("skips admin when request_escalation pref is false", async () => {
    await patchAdmin2({
      phone: "+15559876543",
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_escalation: false },
      }),
    });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.admin_phones).toBeGreaterThanOrEqual(1);
      expect(body.escalated).toBe(0);
    } finally {
      await deleteRequest(id);
      await patchAdmin2({ phone: "", notification_prefs: "" });
    }
  });

  it("skips admin when whatsapp channel is not in prefs.channels", async () => {
    await patchAdmin2({
      phone: "+15551111111",
      notification_prefs: JSON.stringify({
        channels: ["email"],
        events: { request_escalation: true },
      }),
    });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.admin_phones).toBeGreaterThanOrEqual(1);
      expect(body.escalated).toBe(0);
    } finally {
      await deleteRequest(id);
      await patchAdmin2({ phone: "", notification_prefs: "" });
    }
  });

  it("/_test/ writes send_whatsapp audit row with actor=admin.id (issue #180 regression)", async () => {
    await patchAdmin2({ phone: "+15559876543" });

    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.escalated).toBeGreaterThanOrEqual(1);

      const auditRes = await fetch(
        `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
          `action="send_whatsapp" && actor="${admin2Id}"`
        )}&sort=-created&perPage=50`,
        { headers: { Authorization: suToken } }
      );
      expect(auditRes.status).toBe(200);
      const rows = (await auditRes.json()).items;
      // Prior describe-block tests may leave request_pending rows for the same
      // actor; find the escalation row explicitly rather than relying on rows[0].
      const escalationRow = rows.find((r) => {
        try { return JSON.parse(r.changes).event === "request_escalation"; }
        catch (_) { return false; }
      });
      expect(escalationRow, "send_whatsapp audit row with event=request_escalation must exist").toBeTruthy();
      expect(escalationRow.actor).toBe(admin2Id);
    } finally {
      await deleteRequest(id);
      await patchAdmin2({ phone: "" });
    }
  });
});
