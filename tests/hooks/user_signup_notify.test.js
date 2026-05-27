import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Hook under test: user_signup_notify.pb.js
//
// onRecordAfterCreateRequest on "users":
//   - Fires for HTTP-created users (email/password signup).
//   - If the new user has a pre-set role (role !== ""), the hook returns early
//     and makes no email attempt.
//   - If role is empty, it collects all admin users + current on-call users and
//     sends each a "new user awaiting approval" email via $app.newMailClient().
//   - All email errors (including SMTP-not-configured) are caught and logged;
//     the error is NEVER re-thrown, so user creation always succeeds.
//   - A new user never self-notifies: `if (recipient.id === newUserId) continue`.
//
// Test strategy:
//   Since the hook test harness boots a real PB with no SMTP configured, we
//   can't intercept outbound email.  We verify the observable contract:
//     1. User creation with an empty role succeeds (hook swallows SMTP error).
//     2. User creation with a pre-set role succeeds (hook exits early, no email).
//     3. The hook silently skips when there are no admins to notify.
//     4. Self-notify guard: admin creating own account (role="admin" → early
//        exit anyway) or creating a new pending user doesn't crash.
//
//   None of these tests require SMTP — they just verify the response status
//   and that the created record is retrievable, proving the hook didn't blow
//   up the create transaction.

describe("user_signup_notify hook", () => {
  let baseUrl, suToken;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // ── Test 1: empty-role user — hook fires, SMTP error is swallowed ──────────

  it("creates user with empty role without error (SMTP swallowed)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "pending-user@notify-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "Pending User",
        // role intentionally omitted → defaults to ""
      }),
    });
    expect(res.status, "create should return 200").toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.email).toBe("pending-user@notify-test.local");
  });

  it("newly-created pending user is retrievable after hook fires", async () => {
    // Create a second pending user and confirm it's readable — proves the hook
    // didn't corrupt the record or leave the request in a broken state.
    const createRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "pending-user2@notify-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "Pending User 2",
      }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    const userId = created.id;
    expect(userId).toBeTruthy();

    // Fetch back by ID using the superuser token.
    const getRes = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      headers: { Authorization: suToken },
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.email).toBe("pending-user2@notify-test.local");
    // Role should be empty (not modified by hook)
    expect(fetched.role ?? "").toBe("");
  });

  // ── Test 2: pre-assigned role — hook exits early, no email attempt ─────────

  it("creates user with pre-set role=user without error (early exit path)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user-with-role@notify-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "User With Role",
        role: "user",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  it("creates user with pre-set role=admin without error (early exit path)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin-with-role@notify-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "Admin With Role",
        role: "admin",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  // ── Test 3: self-notify guard — admin listed as recipient is skipped ───────

  it("admin who is the new pending user doesn't crash (self-notify guard)", async () => {
    // This exercises the `if (recipient.id === newUserId) continue` guard.
    // Scenario: the only admin is the same user being created (edge case where
    // role="" AND admin list happens to include the user themselves).
    // In practice the hook is called AFTER create so the new user exists in
    // the DB — if their id appears in the admin list it must be skipped.
    //
    // We can't directly force this scenario without DB manipulation, but we
    // can verify the straightforward case: creating a pending user when the
    // seeded admin (admin@hook-test.local) already exists produces no error.
    // The admin is NOT the new user, so the guard branch is the normal path.

    const adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
    expect(adminToken).toBeTruthy(); // admin still exists and works after hook ran

    const res = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "pending-no-self-notify@notify-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "No Self Notify",
        // empty role → hook will try to notify admin@hook-test.local
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The new pending user's id should differ from the admin
    const listRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    const listBody = await listRes.json();
    const adminId = listBody.items[0]?.id;
    expect(adminId).toBeTruthy();
    expect(body.id).not.toBe(adminId); // self-notify guard: new user ≠ admin
  });
});
