import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/tg/digest/run (manual admin trigger).
// Source: pb/pb_hooks/tg_group_digest.pb.js
//
// TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID are NOT set in tests.
// Dry-run mode (?dry=1) lets us exercise buildDigest() without Telegram creds.

describe("tg_group_digest hook (POST /api/tg/digest/run)", () => {
  let pb, baseUrl, suToken, adminToken, userToken;
  let seededKitSerial, seededEntityId, seededKitId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a non-admin user for 403 tests
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@tg-digest-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "TG Digest Test User",
      }),
    });
    userToken = await authUser(baseUrl, "user@tg-digest-test.local", "Userpass1!");

    // Seed an entity + active kit + open request for digest content tests
    seededKitSerial = "TG-DIGEST-KIT-1";

    const entityRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "TG-Digest-Entity-1", type: "field", is_active: true }),
    });
    seededEntityId = (await entityRes.json()).id;

    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: seededKitSerial, is_active: true }),
    });
    seededKitId = (await kitRes.json()).id;

    const adminRec = await fetch(
      `${baseUrl}/api/collections/users/records?filter=(email='admin@hook-test.local')`,
      { headers: { Authorization: suToken } }
    );
    const adminId = (await adminRec.json()).items[0].id;

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: adminId,
        date: new Date().toISOString().split("T")[0],
        delivery_date: tomorrow,
        status: "open",
        designated_kit: seededKitId,
        target_entity: seededEntityId,
      }),
    });
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 without Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/tg/digest/run`, { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/tg/digest/run`, {
      method: "POST",
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin on dry-run path (admin gate not bypassed by ?dry=1)", async () => {
    const res = await fetch(`${baseUrl}/api/tg/digest/run?dry=1`, {
      method: "POST",
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 500 with 'Telegram credentials not configured' when env vars are unset (non-dry)", async () => {
    // TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID are not set in the test env.
    const res = await fetch(`${baseUrl}/api/tg/digest/run`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Telegram credentials not configured");
  });

  it("dry-run returns 200 with digest text containing seeded kit serial", async () => {
    const res = await fetch(`${baseUrl}/api/tg/digest/run?dry=1`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
    expect(typeof body.chars).toBe("number");
    expect(body.chars).toBe(body.text.length);
    // Digest must contain the seeded kit serial
    expect(body.text).toContain(seededKitSerial);
    // Digest must show Open Requests section with count >= 1
    expect(body.text).toMatch(/Open Requests \(\d+\)/);
    const match = body.text.match(/Open Requests \((\d+)\)/);
    expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(1);
  });

  it("dry-run via JSON body { dry: true } also returns 200 with digest", async () => {
    const res = await fetch(`${baseUrl}/api/tg/digest/run`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ dry: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(body.text).toContain(seededKitSerial);
  });

  it("maintenance section includes BOTH kit-based and component-based schedules", async () => {
    // Regression: kit_maintenance_schedules.kit is optional (migration 1779300000);
    // component-only schedules must NOT be silently dropped from the digest.
    const today = new Date().toISOString().split("T")[0];

    // Kit-based schedule (reuse the seeded active kit).
    const ks = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: seededKitId,
        type: "calibration",
        interval_days: 30,
        next_due_at: today,
        is_active: true,
      }),
    });
    expect([200, 201]).toContain(ks.status);

    // Component-based schedule: need a product, then a component, then a schedule.
    const pr = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "TG Digest Product", is_serialized: true }),
    });
    expect([200, 201]).toContain(pr.status);
    const productId = (await pr.json()).id;

    const compSerial = "TG-DIGEST-COMP-1";
    const cr = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: compSerial, product: productId, is_active: true, is_bulk: false }),
    });
    expect([200, 201]).toContain(cr.status);
    const componentId = (await cr.json()).id;

    const cs = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        component: componentId,
        type: "inspection",
        interval_days: 30,
        next_due_at: today,
        is_active: true,
      }),
    });
    expect([200, 201]).toContain(cs.status);

    const res = await fetch(`${baseUrl}/api/tg/digest/run?dry=1`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Both the seeded kit serial and the component serial (with marker) must appear.
    expect(body.text).toContain(seededKitSerial);
    expect(body.text).toContain(compSerial);
    expect(body.text).toContain("(component)");
    expect(body.text).toMatch(/Maintenance Due \(next 7 days\) — (\d+)/);
    const m = body.text.match(/Maintenance Due \(next 7 days\) — (\d+)/);
    expect(parseInt(m[1], 10)).toBeGreaterThanOrEqual(2);
  });

  it("HTML-escapes user-controlled fields in the digest", async () => {
    // A kit serial with &/</> must be escaped before going into parse_mode:HTML.
    // (Kit serial is plain unique text — renders reliably as `kit=<serial>` on
    // every open request, so it directly exercises the escHtml path.)
    const rawSerial = "TG&ESC<1>";
    const kr = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: rawSerial, is_active: true }),
    });
    expect([200, 201]).toContain(kr.status);
    const escKitId = (await kr.json()).id;

    const adminRec = await fetch(
      `${baseUrl}/api/collections/users/records?filter=(email='admin@hook-test.local')`,
      { headers: { Authorization: suToken } }
    );
    const adminId = (await adminRec.json()).items[0].id;

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: adminId,
        date: new Date().toISOString().split("T")[0],
        delivery_date: tomorrow,
        status: "open",
        designated_kit: escKitId,
      }),
    });

    const res = await fetch(`${baseUrl}/api/tg/digest/run?dry=1`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Escaped form present, raw unescaped form absent.
    expect(body.text).toContain("kit=TG&amp;ESC&lt;1&gt;");
    expect(body.text).not.toContain(rawSerial);
  });
});
