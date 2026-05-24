import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Hook under test: users_name_default.pb.js
// onModelBeforeCreate on "users": if name is empty, fall back to email local part.
describe("users_name_default hook", () => {
  let baseUrl, suToken;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createUser(email, name) {
    return fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        ...(name !== undefined ? { name } : {}),
      }),
    });
  }

  // 1. Happy path: no name supplied → hook fills in email local part
  it("user created without a name gets name set to email local part", async () => {
    const res = await createUser("no-name@name-default-test.local");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("no-name");
  });

  // 2. Explicit empty string → same as absent; hook fills in email local part
  it("user created with empty name string gets name set to email local part", async () => {
    const res = await createUser("empty-name@name-default-test.local", "");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("empty-name");
  });

  // 3. Explicit name → hook must not overwrite it
  it("user created with explicit name keeps that name unchanged", async () => {
    const res = await createUser("with-name@name-default-test.local", "Custom Name");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Custom Name");
  });
});
