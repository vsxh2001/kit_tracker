/**
 * Admin email notification tests — exercised against the dockerized stack.
 *
 * Requirements:
 *   - Docker stack running via: PB_HOST_PORT=8092 docker compose -p notif-qa up -d
 *   - PocketBase on http://localhost:8092 (PLAYWRIGHT_TEST_BASE_URL not required; tests
 *     are API-only — no browser navigation needed).
 *   - MailHog on http://localhost:8025
 *
 * All PocketBase calls go directly to :8092 (not the default :8090 used by other specs).
 * MailHog is polled via its HTTP API — no SMTP client needed.
 *
 * Coverage:
 *   - Happy path: user creates request → one email sent to admin
 *   - No self-notification: admin creates request → no email (only admin is self)
 *   - HTML escape: XSS strings in notes are escaped in mail body
 *   - SMTP off: disabling SMTP → no mail on new request → re-enable for cleanup
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants — point at the dedicated notification test stack, not :8090
// ---------------------------------------------------------------------------

const PB_URL = "http://localhost:8092";
const MH_URL = "http://localhost:8025";

const SUPERUSER_EMAIL = "admin@example.com";
const SUPERUSER_PASSWORD = "changeme123";

// Seeded test users (from seed_test_users.sh)
const ADMIN_EMAIL = "logistics@kit.local";
const USER_EMAIL = "requester@kit.local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Authenticate as PocketBase superadmin (admin panel). Used for settings PATCH. */
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

interface AuthResult {
  token: string;
  record: { id: string; email: string; name: string; role: string };
}

/** Authenticate as a seeded test user, return token + record. */
async function authAsUser(email: string, password = "Pass1234!"): Promise<AuthResult> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed for ${email}: ${res.status}`);
  return res.json();
}

/** Create an entity as the seeded admin user (entities require admin role). */
async function createEntity(name: string): Promise<{ id: string }> {
  // Superadmin (PB admin panel) token does not satisfy collection createRules.
  // Use the seeded logistics@kit.local user who has role=admin.
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  const res = await fetch(`${PB_URL}/api/collections/entities/records`, {
    method: "POST",
    headers: {
      Authorization: adminAuth.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, type: "lab", is_active: true }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createEntity failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

interface RequestPayload {
  requesterId: string;
  requesterToken: string;
  notes?: string;
  targetEntityId?: string;
}

/** Create a request using the requester's own token (matches real app flow). */
async function createRequest(payload: RequestPayload): Promise<{ id: string; status: string }> {
  const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const body: Record<string, unknown> = {
    requester: payload.requesterId,
    date: new Date().toISOString().split("T")[0],
    delivery_date: deliveryDate,
    status: "open",
  };
  if (payload.notes) body.notes = payload.notes;
  if (payload.targetEntityId) body.target_entity = payload.targetEntityId;

  const res = await fetch(`${PB_URL}/api/collections/requests/records`, {
    method: "POST",
    headers: {
      Authorization: payload.requesterToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`createRequest failed: ${JSON.stringify(err)}`);
  }
  return res.json();
}

/** Cancel (cleanup) a request via admin token. */
async function cancelRequest(requestId: string): Promise<void> {
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  await fetch(`${PB_URL}/api/collections/requests/records/${requestId}`, {
    method: "PATCH",
    headers: {
      Authorization: adminAuth.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
}

/** Clear all messages in MailHog. */
async function clearMailHog(): Promise<void> {
  await fetch(`${MH_URL}/api/v1/messages`, { method: "DELETE" });
}

interface MailHogMessage {
  Content: {
    Headers: {
      Subject: string[];
      To: string[];
      From: string[];
    };
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
    const res = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
    const data: MailHogResponse = await res.json();
    if (data.total >= minCount) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  // Return whatever we have (test will fail on count assertion with clear message)
  const res = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
  return res.json();
}

/**
 * Decode a quoted-printable encoded string to plain text.
 * 1. Remove soft line breaks: =\r\n or =\n
 * 2. Decode =XX hex escapes
 */
function decodeQP(encoded: string): string {
  return encoded
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/**
 * Extract and decode the HTML part body from a MailHog message.
 * MailHog returns quoted-printable encoded bodies — decode before asserting.
 * Navigate MIME tree: Parts[0] = multipart/alternative, Parts[0].MIME.Parts[1] = HTML.
 */
function extractHtmlBody(msg: MailHogMessage): string {
  const outer = msg.MIME?.Parts?.[0];
  if (!outer?.MIME?.Parts) return decodeQP(msg.Content.Body);
  for (const part of outer.MIME.Parts) {
    const ct = part.Headers["Content-Type"]?.[0] ?? "";
    if (ct.includes("text/html")) return decodeQP(part.Body);
  }
  return decodeQP(msg.Content.Body);
}

/** Toggle SMTP enabled/disabled via PocketBase settings API (superadmin auth). */
async function setSmtpEnabled(enabled: boolean): Promise<void> {
  const token = await getSuperAdminToken();
  const body = enabled
    ? { smtp: { enabled: true, host: "mailhog", port: 1025, tls: false } }
    : { smtp: { enabled: false } };
  const res = await fetch(`${PB_URL}/api/settings`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /api/settings failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Admin email notifications", () => {
  // Verify the stack is reachable before running any test.
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
  // Happy path: user creates request → admin gets notified
  // ---------------------------------------------------------------------------

  test("user request triggers email to admin(s)", async () => {
    const userAuth = await authAsUser(USER_EMAIL);
    const entity = await createEntity(`notif-lab-${Date.now()}`);

    const request = await createRequest({
      requesterId: userAuth.record.id,
      requesterToken: userAuth.token,
      targetEntityId: entity.id,
      notes: "happy-path notification test",
    });

    // Poll until at least 1 mail arrives (hook fires async after create)
    const mails = await pollMailHog(1);

    expect(mails.total, "Expected 1 notification email (1 admin, requester is not admin)").toBe(1);

    const mail = mails.items[0];

    // Subject
    const subject = mail.Content.Headers.Subject?.[0] ?? "";
    expect(subject.toLowerCase(), "Subject must mention 'kit request'").toContain("kit request");

    // Recipient is the admin, not the requester
    const toHeader = mail.Content.Headers.To?.[0] ?? "";
    expect(toHeader, "Email must be addressed to admin").toContain(ADMIN_EMAIL);
    expect(toHeader, "Email must NOT be addressed to requester").not.toContain(USER_EMAIL);

    // HTML body — check all required content
    const html = extractHtmlBody(mail);

    expect(html, "Body must contain requester email").toContain(USER_EMAIL);
    expect(html, "Body must mention 'any available' when no kit designated").toContain(
      "any available"
    );
    expect(html, "Body must contain target entity reference").toContain("notif-lab-");
    expect(html, "Body must contain a link to the request detail page").toContain(
      `/requests/${request.id}`
    );

    // Cleanup
    await cancelRequest(request.id);
  });

  // ---------------------------------------------------------------------------
  // Negative: admin creates own request → no email (only admin is self → skip)
  // ---------------------------------------------------------------------------

  test("admin request does not trigger self-notification when admin is the only admin", async () => {
    const adminAuth = await authAsUser(ADMIN_EMAIL);
    const entity = await createEntity(`notif-admin-self-${Date.now()}`);

    const request = await createRequest({
      requesterId: adminAuth.record.id,
      requesterToken: adminAuth.token,
      targetEntityId: entity.id,
      notes: "admin self-request — must not email anyone",
    });

    // Wait long enough for the hook to fire — if mail were going to arrive it would
    // arrive within ~2s; waiting 4s gives ample margin without test.waitForTimeout.
    // We use a deliberate 4-iteration poll with 1s gaps so the wait is observable.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const mails = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`).then(
      (r) => r.json() as Promise<MailHogResponse>
    );

    expect(
      mails.total,
      "No email should be sent when the only admin creates their own request"
    ).toBe(0);

    // Cleanup
    await cancelRequest(request.id);
  });

  // ---------------------------------------------------------------------------
  // Edge: XSS strings in notes are HTML-escaped in the mail body
  // ---------------------------------------------------------------------------

  test("HTML special characters in notes are escaped in mail body", async () => {
    const xssPayload = `<script>alert(1)</script> & "double" <> '& apostrophe'`;
    const userAuth = await authAsUser(USER_EMAIL);

    const request = await createRequest({
      requesterId: userAuth.record.id,
      requesterToken: userAuth.token,
      notes: xssPayload,
    });

    const mails = await pollMailHog(1);
    expect(mails.total, "Should receive exactly 1 notification").toBe(1);

    const html = extractHtmlBody(mails.items[0]);

    // Dangerous literal tags must NOT appear unescaped
    expect(html, "Raw <script> tag must not appear in mail HTML").not.toContain("<script>");
    expect(html, "Raw </script> tag must not appear in mail HTML").not.toContain("</script>");

    // Escaped forms must be present
    expect(html, "& must be escaped as &amp;").toContain("&amp;");
    expect(html, "< must be escaped as &lt;").toContain("&lt;");
    expect(html, "> must be escaped as &gt;").toContain("&gt;");

    // Cleanup
    await cancelRequest(request.id);
  });

  // ---------------------------------------------------------------------------
  // Edge: SMTP disabled → hook silently skips; re-enable after
  // ---------------------------------------------------------------------------

  test("no email is sent when SMTP is disabled", async () => {
    await setSmtpEnabled(false);

    const userAuth = await authAsUser(USER_EMAIL);
    const request = await createRequest({
      requesterId: userAuth.record.id,
      requesterToken: userAuth.token,
      notes: "smtp-off test — must not deliver mail",
    });

    // Wait briefly for any in-flight mail attempt to resolve
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const mails = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`).then(
      (r) => r.json() as Promise<MailHogResponse>
    );

    expect(
      mails.total,
      "No email should be delivered when SMTP is disabled"
    ).toBe(0);

    // Cleanup — re-enable SMTP before subsequent tests (and for other suites)
    await setSmtpEnabled(true);
    await cancelRequest(request.id);
  });
});
