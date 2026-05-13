/**
 * User signup email notification tests — exercised against the dockerized stack.
 *
 * Requirements (set NOTIF_E2E=1 to run):
 *   - NOTIF_E2E=1 env var must be set (auto-skipped in CI without it)
 *   - Docker stack running via:
 *       PB_HOST_PORT=8092 MAILHOG_SMTP_PORT=1027 MAILHOG_UI_PORT=8027 \
 *       docker compose --profile dev -p notif-qa up -d
 *   - PocketBase on http://localhost:8092
 *   - MailHog on http://localhost:8025
 *
 * Coverage:
 *   1. Happy path: admin creates new user with empty role → email sent to all admins
 *   2. Pre-assigned role skip: admin creates user with role="user" → NO email
 *   3. HTML escape: XSS strings in name/email are escaped in mail body
 */

import { test, expect } from "@playwright/test";

// Skip entire spec unless NOTIF_E2E=1 is set (requires MailHog stack).
test.skip(
  !process.env.NOTIF_E2E,
  "Skipped: user-signup-notify spec requires NOTIF_E2E=1 + dedicated MailHog stack on :8092/:8025"
);

// ---------------------------------------------------------------------------
// Constants — dedicated notification test stack (not :8090)
// ---------------------------------------------------------------------------

const PB_URL = "http://localhost:8092";
const MH_URL = "http://localhost:8025";

const SUPERUSER_EMAIL    = "admin@example.com";
const SUPERUSER_PASSWORD = "changeme123";

// Seeded admin used to verify recipient list
const ADMIN_EMAIL = "logistics@kit.local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Authenticate as PocketBase superadmin. */
async function getSuperAdminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Superadmin auth failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

/** Authenticate as a seeded test user. */
async function authAsUser(email: string, password = "Pass1234!"): Promise<{ token: string; record: { id: string; email: string; role: string } }> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed for ${email}: ${res.status}`);
  return res.json();
}

interface CreateUserPayload {
  email: string;
  password?: string;
  name?: string;
  role?: string;
}

/** Create a user record as superadmin. Returns the created record. */
async function createUser(payload: CreateUserPayload): Promise<{ id: string; email: string; role: string }> {
  const token = await getSuperAdminToken();
  const body: Record<string, unknown> = {
    email:           payload.email,
    password:        payload.password ?? "Pass1234!",
    passwordConfirm: payload.password ?? "Pass1234!",
    verified:        true,
    emailVisibility: true,
  };
  if (payload.name)  body.name = payload.name;
  if (payload.role)  body.role = payload.role;

  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`createUser failed: ${JSON.stringify(err)}`);
  }
  return res.json();
}

/** Delete a user record as superadmin (cleanup). */
async function deleteUser(userId: string): Promise<void> {
  const token = await getSuperAdminToken();
  await fetch(`${PB_URL}/api/collections/users/records/${userId}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

/** Clear all messages in MailHog. */
async function clearMailHog(): Promise<void> {
  await fetch(`${MH_URL}/api/v1/messages`, { method: "DELETE" });
}

interface MailHogMessage {
  Content: {
    Headers: { Subject: string[]; To: string[]; From: string[] };
    Body: string;
  };
  MIME?: {
    Parts?: Array<{
      MIME?: {
        Parts?: Array<{
          Headers: { "Content-Type": string[] };
          Body: string;
        }>;
      };
    }>;
  };
}

interface MailHogResponse {
  total: number;
  count: number;
  items: MailHogMessage[];
}

/** Poll MailHog until at least `minCount` messages arrive or timeout. */
async function pollMailHog(minCount: number, timeoutMs = 10_000): Promise<MailHogResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res  = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
    const data = (await res.json()) as MailHogResponse;
    if (data.total >= minCount) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  const res = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
  return res.json() as Promise<MailHogResponse>;
}

/**
 * Decode a quoted-printable encoded string.
 * 1. Remove soft line breaks: =\r\n or =\n
 * 2. Decode =XX hex escapes
 */
function decodeQP(encoded: string): string {
  return encoded
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Extract and decode the HTML part body from a MailHog message. */
function extractHtmlBody(msg: MailHogMessage): string {
  const outer = msg.MIME?.Parts?.[0];
  if (!outer?.MIME?.Parts) return decodeQP(msg.Content.Body);
  for (const part of outer.MIME.Parts) {
    const ct = part.Headers["Content-Type"]?.[0] ?? "";
    if (ct.includes("text/html")) return decodeQP(part.Body);
  }
  return decodeQP(msg.Content.Body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("User signup email notifications", () => {
  // Verify stack is reachable before running any test.
  test.beforeAll(async () => {
    const pbHealth = await fetch(`${PB_URL}/api/health`).catch(() => null);
    if (!pbHealth?.ok) {
      throw new Error(
        `PocketBase at ${PB_URL} is not reachable. Start the stack with:\n` +
          "  PB_HOST_PORT=8092 docker compose -p notif-qa up -d"
      );
    }
    const mhHealth = await fetch(`${MH_URL}/api/v2/messages`).catch(() => null);
    if (!mhHealth?.ok) {
      throw new Error(`MailHog at ${MH_URL} is not reachable.`);
    }
  });

  // Clear inbox before each test so counts are fresh.
  test.beforeEach(async () => {
    await clearMailHog();
  });

  // ---------------------------------------------------------------------------
  // 1. Happy path: new user with empty role → admin(s) get notified
  // ---------------------------------------------------------------------------

  test("pending signup triggers email to admin(s)", async () => {
    const email = `newbie-${Date.now()}@signup.local`;
    const user  = await createUser({ email, name: "New Bie" });

    // Determine expected admin count at test time.
    const adminAuth  = await authAsUser(ADMIN_EMAIL);
    const adminsRes  = await fetch(
      `${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`role="admin"`)}`,
      { headers: { Authorization: adminAuth.token } }
    );
    const adminsData    = await adminsRes.json();
    const expectedCount = adminsData.totalItems as number;

    const mails = await pollMailHog(1);

    expect(
      mails.total,
      `Expected ${expectedCount} notification email(s) — one per admin`
    ).toBe(expectedCount);

    const mail    = mails.items[0];
    const subject = mail.Content.Headers.Subject?.[0] ?? "";

    expect(subject.toLowerCase(), "Subject must mention 'new user awaiting approval'").toContain(
      "new user awaiting approval"
    );
    expect(subject, "Subject must contain new user email").toContain(email);

    const html = extractHtmlBody(mail);
    expect(html, "Body must contain new user email").toContain(email);
    expect(html, "Body must contain new user name").toContain("New Bie");
    expect(html, "Body must contain a link to /users").toContain("/users");

    // Cleanup
    await deleteUser(user.id);
  });

  // ---------------------------------------------------------------------------
  // 2. Pre-assigned role skip: user created with role → no email
  // ---------------------------------------------------------------------------

  test("user created with pre-assigned role does not trigger notification", async () => {
    const email = `preset-${Date.now()}@signup.local`;
    const user  = await createUser({ email, role: "user" });

    // Wait enough time for hook to have fired if it were going to.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const mails = (await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`).then(
      (r) => r.json()
    )) as MailHogResponse;

    expect(
      mails.total,
      "No email should be sent when the new user already has a role assigned"
    ).toBe(0);

    // Cleanup
    await deleteUser(user.id);
  });

  // ---------------------------------------------------------------------------
  // 3. HTML escape: XSS strings in name are escaped in the mail body
  // ---------------------------------------------------------------------------

  test("HTML special characters in user name are escaped in mail body", async () => {
    const xssName = `<script>alert(1)</script> & "double" <> 'apostrophe'`;
    const email   = `xss-${Date.now()}@signup.local`;
    const user    = await createUser({ email, name: xssName });

    const mails = await pollMailHog(1);
    expect(mails.total, "Should receive at least 1 notification").toBeGreaterThanOrEqual(1);

    const html = extractHtmlBody(mails.items[0]);

    // Raw dangerous tags must NOT appear unescaped.
    expect(html, "Raw <script> must not appear in mail HTML").not.toContain("<script>");
    expect(html, "Raw </script> must not appear in mail HTML").not.toContain("</script>");

    // Escaped forms must be present.
    expect(html, "& must be escaped as &amp;").toContain("&amp;");
    expect(html, "< must be escaped as &lt;").toContain("&lt;");
    expect(html, "> must be escaped as &gt;").toContain("&gt;");

    // Cleanup
    await deleteUser(user.id);
  });
});
