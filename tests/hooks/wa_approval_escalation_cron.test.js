import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /_test/wa-approval-escalation (dry-run trigger route).
// Source: pb/pb_hooks/wa_approval_escalation_cron.pb.js
//
// The route runs the full escalation check (DB queries, pref gate, dedup) but
// skips the actual WA HTTP send. It writes send_whatsapp audit rows with actor
// set so the actor field can be asserted — fixing issue #180.

const TS = `escalation-${Date.now()}`;

describe("wa_approval_escalation_cron — /_test/ route + audit actor", () => {
  let baseUrl, suToken, adminToken, userToken;
  let requesterId, adminWithPhoneId;

  async function trigger(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${baseUrl}/_test/wa-approval-escalation${qs ? "?" + qs : ""}`;
    return fetch(url, {
      method: "POST",
      headers: token ? { Authorization: token } : {},
    });
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
        notes: `${TS}-escalation-test`,
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

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminWithPhoneId = (await adminRes.json()).items[0]?.id;
    expect(adminWithPhoneId, "seeded admin must exist").toBeTruthy();

    const userRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${TS}-req@escalation.local`,
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Escalation Requester",
      }),
    });
    requesterId = (await userRes.json()).id;
    userToken = await authUser(baseUrl, `${TS}-req@escalation.local`, "Userpass1!");
  }, 60_000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 without Authorization header", async () => {
    const res = await trigger(null);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await trigger(userToken);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin only");
  });

  it("returns open_requests=0 when no open requests exist", async () => {
    const res = await trigger(adminToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.open_requests).toBe(0);
    expect(body.escalated).toBe(0);
  });

  it("returns escalated=0 when no admins have phones", async () => {
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.open_requests).toBeGreaterThanOrEqual(1);
      expect(body.escalated).toBe(0);
    } finally {
      await deleteRequest(id);
    }
  });

  it("escalates and writes send_whatsapp audit row with actor=adminId", async () => {
    await fetch(`${baseUrl}/api/collections/users/records/${adminWithPhoneId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15551234567" }),
    });

    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
      expect(body.escalated).toBeGreaterThanOrEqual(1);

      const auditRes = await fetch(
        `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
          `action="send_whatsapp" && actor="${adminWithPhoneId}"`
        )}`,
        { headers: { Authorization: suToken } }
      );
      expect(auditRes.status).toBe(200);
      const auditBody = await auditRes.json();
      expect(
        auditBody.items.length,
        "send_whatsapp audit row must exist with actor=adminId"
      ).toBeGreaterThanOrEqual(1);
      const row = auditBody.items[0];
      expect(row.actor).toBe(adminWithPhoneId);
      const changes = JSON.parse(row.changes);
      expect(changes.event).toBe("request_escalation");
    } finally {
      await deleteRequest(id);
      await fetch(`${baseUrl}/api/collections/users/records/${adminWithPhoneId}`, {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "" }),
      });
    }
  });

  it("deduplicates: second trigger for same request returns already_escalated>=1", async () => {
    await fetch(`${baseUrl}/api/collections/users/records/${adminWithPhoneId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15551234567" }),
    });

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
      await fetch(`${baseUrl}/api/collections/users/records/${adminWithPhoneId}`, {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "" }),
      });
    }
  });
});
