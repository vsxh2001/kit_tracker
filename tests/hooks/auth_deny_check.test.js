import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Covers auth_deny_check.pb.js — blocks password auth for users whose role is
// "denied" (onRecordBeforeAuthWithPasswordRequest). The OAuth path
// (onRecordBeforeAuthWithOAuth2Request) is NOT exercised here: it needs a
// configured provider + mocked redirect flow, which the REST harness can't
// stand up (matches the spec's "no OAuth interaction" exclusion).

async function authAttempt(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function createUser(baseUrl, suToken, email, password, role) {
  await fetch(`${baseUrl}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: suToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      passwordConfirm: password,
      role,
      name: email,
    }),
  });
  const res = await fetch(
    `${baseUrl}/api/collections/users/records?filter=email="${email}"`,
    { headers: { Authorization: suToken } }
  );
  return (await res.json()).items[0].id;
}

describe("auth_deny_check hook", () => {
  let baseUrl, suToken;
  let deniedId;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    deniedId = await createUser(baseUrl, suToken, "denied@deny-test.local", "Denypass1!", "denied");
    await createUser(baseUrl, suToken, "active@deny-test.local", "Activepass1!", "user");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("active (role=user) account can authenticate", async () => {
    const { status, body } = await authAttempt(baseUrl, "active@deny-test.local", "Activepass1!");
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
  });

  it("admin (seeded) account can authenticate — non-denied roles unaffected", async () => {
    const { status } = await authAttempt(baseUrl, "admin@hook-test.local", "Adminpass1!");
    expect(status).toBe(200);
  });

  it("denied account is blocked with a denial message (400)", async () => {
    const { status, body } = await authAttempt(baseUrl, "denied@deny-test.local", "Denypass1!");
    expect(status).toBe(400);
    // Must be the hook's denial, not a generic bad-credentials failure.
    expect(JSON.stringify(body).toLowerCase()).toContain("denied");
  });

  it("denied account stays blocked even with the correct password", async () => {
    // The hook looks up the user by identity and throws before credentials are
    // accepted — a valid password does not bypass the gate.
    const { status } = await authAttempt(baseUrl, "denied@deny-test.local", "Denypass1!");
    expect(status).toBe(400);
  });

  it("re-enabling a denied user (role denied → user) restores auth", async () => {
    const patch = await fetch(`${baseUrl}/api/collections/users/records/${deniedId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(patch.status).toBe(200);

    const { status, body } = await authAttempt(baseUrl, "denied@deny-test.local", "Denypass1!");
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();

    // restore denied state for any later runs against the same instance
    await fetch(`${baseUrl}/api/collections/users/records/${deniedId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "denied" }),
    });
  });

  it("unknown email passes through to PB's normal auth failure, not the denial path", async () => {
    const { status, body } = await authAttempt(baseUrl, "nobody@deny-test.local", "whatever123");
    expect(status).toBe(400);
    // Contrast with the denied case above (which DOES contain "denied"): an
    // unknown identity hits the hook's `users.length === 0` early return, so it
    // must fall through to PB's generic bad-credentials 400 and never be
    // misclassified into the account-denied branch.
    expect(JSON.stringify(body).toLowerCase()).not.toContain("denied");
  });
});
