import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Hook under test: request_created_notify.pb.js
//
// onRecordAfterCreateRequest on "requests":
//   - Expands requester / designated_kit / target_entity for the email body;
//     each expand is individually guarded (missing/empty id → log + fall back
//     to a default string, never throw).
//   - Builds the recipient set = all admins + currently on-call admins/techs
//     (deduped by id).
//   - Skips the requester themselves (no self-notification:
//     `if (recipient.id === requesterId) continue`).
//   - Sends one email per recipient via $app.newMailClient().send(); every
//     mail error (incl. SMTP-not-configured) is caught and logged. The hook
//     fires AFTER create, so it NEVER rolls back the record and NEVER re-throws.
//
// Test strategy:
//   The harness boots a real PB with no SMTP, so we can't intercept outbound
//   email. We verify the observable contract instead: every create path returns
//   200 and the request is retrievable afterwards, proving the hook ran to
//   completion without throwing or corrupting the record. We drive each code
//   branch (admin-only recipient, non-admin requester, expand success, expand
//   fallback, on-call recipient, self-notify guard, HTML-escape) by varying the
//   request payload.

const TS = `reqnotify-${Date.now()}`;

describe("request_created_notify hook", () => {
  let baseUrl, suToken;
  let adminId, requesterId, techId;
  let kitId, entityId;

  // --- helpers ------------------------------------------------------------

  async function suPost(path, body) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function createUser(email, role) {
    const res = await suPost("/api/collections/users/records", {
      email,
      password: "Testpass1!",
      passwordConfirm: "Testpass1!",
      name: email.split("@")[0],
      role,
    });
    expect(res.status, `create user ${email}`).toBe(200);
    return (await res.json()).id;
  }

  // Minimal valid request payload — requester/date/status are the required fields.
  async function createRequest(overrides = {}) {
    return suPost("/api/collections/requests/records", {
      requester: requesterId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
      ...overrides,
    });
  }

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Resolve the seeded app admin (recipient for non-self requests).
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId).toBeTruthy();

    requesterId = await createUser(`${TS}-requester@req.local`, "user");
    techId = await createUser(`${TS}-tech@req.local`, "technician");

    // Real kit + entity so the expand-success branches run.
    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-KIT`,
      is_active: true,
    });
    expect(kitRes.status, "create kit").toBe(200);
    kitId = (await kitRes.json()).id;

    const entRes = await suPost("/api/collections/entities/records", {
      name: `${TS}-Entity`,
      category: "field",
      is_active: true,
    });
    expect(entRes.status, "create entity").toBe(200);
    entityId = (await entRes.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // ── Test 1: non-admin requester → admin is a recipient, SMTP swallowed ─────

  it("creates request from a non-admin requester without error (admin notified, SMTP swallowed)", async () => {
    const res = await createRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.requester).toBe(requesterId);

    // Retrievable after the hook ran → record intact, transaction not broken.
    const getRes = await fetch(`${baseUrl}/api/collections/requests/records/${body.id}`, {
      headers: { Authorization: suToken },
    });
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).status).toBe("open");
  });

  // ── Test 2: designated_kit + target_entity set → expand-success branches ───

  it("creates request with designated_kit + target_entity (expand-success path)", async () => {
    const res = await createRequest({ designated_kit: kitId, target_entity: entityId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.designated_kit).toBe(kitId);
    expect(body.target_entity).toBe(entityId);
  });

  // ── Test 3: no optional relations → expand fallback ("any available") ──────

  it("creates request with no kit/entity (expand-fallback path) without error", async () => {
    const res = await createRequest({ designated_kit: "", target_entity: "" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  // ── Test 4: self-notify guard — admin requests for themselves ──────────────

  it("admin requesting for themselves doesn't crash (self-notify guard skips sole admin)", async () => {
    // requester === the only admin → the recipient loop's
    // `if (recipient.id === requesterId) continue` is the only branch hit,
    // leaving zero actual sends. Must still return 200.
    const res = await createRequest({ requester: adminId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requester).toBe(adminId);

    const getRes = await fetch(`${baseUrl}/api/collections/requests/records/${body.id}`, {
      headers: { Authorization: suToken },
    });
    expect(getRes.status).toBe(200);
  });

  // ── Test 5: on-call recipient path — technician on call is added ───────────

  it("creates request while a technician is on call (on-call recipient path)", async () => {
    const now = Date.now();
    const shiftRes = await suPost("/api/collections/on_call_shifts/records", {
      user: techId,
      created_by: adminId,
      start_at: new Date(now - 3600000).toISOString(),
      end_at: new Date(now + 3600000).toISOString(),
      is_active: true,
    });
    expect(shiftRes.status, "create on-call shift").toBe(200);

    // Request from the non-admin requester → recipients = admin + on-call tech.
    // Both sends fail (no SMTP) and are swallowed; create must still succeed.
    const res = await createRequest();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBeTruthy();
  });

  // ── Test 6: HTML-escape path — hostile notes/name don't break the hook ─────

  it("creates request with injection-y notes without error (esc() path)", async () => {
    const notes = `<script>alert(1)</script> & "quotes" 'apos' <b>`;
    const res = await createRequest({ notes });
    expect(res.status).toBe(200);
    const body = await res.json();
    // esc() only sanitizes the email body — the stored value is unchanged.
    expect(body.notes).toBe(notes);
  });
});
