import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Tests for auth_rate_limit.pb.js
//
// Source: pb/pb_hooks/auth_rate_limit.pb.js
//   - onRecordBeforeAuthWithPasswordRequest: throws 400 when IP is blocked
//   - onRecordAfterAuthWithPasswordRequest: clears failure counter on success
//   - onAfterApiError: increments failure counter; blocks after 10 failures in 5 min
//
// Each describe block gets its own PB process so $app.store() state is fresh.

async function authAttempt(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe("auth_rate_limit – blocks IP after 10 consecutive failures", () => {
  let baseUrl, suToken;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rl-block@hook-test.local",
        password: "Rlblock123!",
        passwordConfirm: "Rlblock123!",
        role: "user",
        name: "RL Block Test",
      }),
    });
  }, 60000);

  afterAll(() => stopPb());

  it("allows correct login when no failures have occurred", async () => {
    const { status } = await authAttempt(baseUrl, "rl-block@hook-test.local", "Rlblock123!");
    expect(status).toBe(200);
    // Successful auth fires onRecordAfterAuthWithPasswordRequest → clears store key.
    // Subsequent tests start with a clean counter.
  });

  it("blocks login after 10 consecutive wrong-password attempts", async () => {
    // Counter was reset by the successful auth above. Make 10 fresh failures.
    for (let i = 0; i < 10; i++) {
      await authAttempt(baseUrl, "rl-block@hook-test.local", "wrongpassword");
    }

    // 11th attempt — even with the correct password — must be blocked.
    const { status, body } = await authAttempt(baseUrl, "rl-block@hook-test.local", "Rlblock123!");
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("Too many failed login attempts");
  }, 20000);

  it("rejects the correct password while the block is active", async () => {
    // IP is still blocked from the previous test.
    const { status, body } = await authAttempt(baseUrl, "rl-block@hook-test.local", "Rlblock123!");
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("Too many failed login attempts");
  });
});

describe("auth_rate_limit – successful login resets failure counter", () => {
  let baseUrl, suToken;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rl-reset@hook-test.local",
        password: "Rlreset123!",
        passwordConfirm: "Rlreset123!",
        role: "user",
        name: "RL Reset Test",
      }),
    });
  }, 60000);

  afterAll(() => stopPb());

  it("does not block when a mid-window success resets the failure counter", async () => {
    // 9 failures — one below the threshold.
    for (let i = 0; i < 9; i++) {
      await authAttempt(baseUrl, "rl-reset@hook-test.local", "wrongpassword");
    }

    // Successful login — fires onRecordAfterAuthWithPasswordRequest → store key removed.
    const { status: okStatus } = await authAttempt(baseUrl, "rl-reset@hook-test.local", "Rlreset123!");
    expect(okStatus).toBe(200);

    // 9 more failures after the reset — counter is back to 9, still below threshold.
    for (let i = 0; i < 9; i++) {
      await authAttempt(baseUrl, "rl-reset@hook-test.local", "wrongpassword");
    }

    // Correct credentials should succeed: counter (9) < MAX_ATTEMPTS (10).
    const { status: finalStatus } = await authAttempt(baseUrl, "rl-reset@hook-test.local", "Rlreset123!");
    expect(finalStatus).toBe(200);
  }, 30000);
});
