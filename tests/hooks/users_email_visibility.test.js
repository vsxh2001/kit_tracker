import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Hook under test: users_email_visibility.pb.js
//
// onModelBeforeCreate on "users": sets emailVisibility=true on every new user.
//
// Why it matters: PB defaults emailVisibility=false, which hides the email
// field in API responses for non-owner non-superuser callers. Kit-tracker
// is an internal tool where admins must see emails to manage roles.
//
// Test strategy: create a user (user A), then fetch that record as a
// different authenticated user (user B, not the owner). If emailVisibility
// is true the email field is populated; if false it would be empty/absent.

describe("users_email_visibility hook", () => {
  let baseUrl, suToken;
  let userAId, userBToken;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Create user A — email visibility is what we're checking.
    const resA = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user-a@vis-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "User A",
      }),
    });
    const userA = await resA.json();
    userAId = userA.id;

    // Create user B — the "other" authenticated caller who will try to read user A.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user-b@vis-test.local",
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        role: "user",
        name: "User B",
      }),
    });
    userBToken = await authUser(baseUrl, "user-b@vis-test.local", "Testpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("newly created user email is visible to other authenticated users (emailVisibility=true)", async () => {
    // viewRule for users is @request.auth.id != "" — any authenticated caller
    // can GET a user record by ID. With emailVisibility=true the email field
    // is populated; with false it would be masked ("").
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userAId}`, {
      headers: { Authorization: userBToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("user-a@vis-test.local");
  });

  it("admin-seeded user email is visible to other authenticated users", async () => {
    // The admin@hook-test.local user is created by startPb() via the REST API,
    // so the hook fires for it too and sets emailVisibility=true.
    const listRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    const listBody = await listRes.json();
    const adminId = listBody.items[0]?.id;
    expect(adminId).toBeTruthy();

    const res = await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      headers: { Authorization: userBToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("admin@hook-test.local");
  });
});
