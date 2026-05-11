/**
 * Overdue return reminder e2e tests — exercised against the dockerized stack.
 *
 * Requirements (set NOTIF_E2E=1 to run):
 *   - NOTIF_E2E=1 env var must be set (auto-skipped in CI without it)
 *   - Docker stack running via:
 *       PB_HOST_PORT=8092 MAILHOG_SMTP_PORT=1027 MAILHOG_UI_PORT=8027 \
 *       docker compose --profile dev -p notif-qa up -d
 *   - PocketBase on http://localhost:8092 (or PB_URL env var)
 *   - MailHog on http://localhost:8025 (or MH_URL env var)
 *
 * Coverage:
 *   T1: Overdue fulfilled request triggers admin email
 *   T2: No overdue requests → no email sent
 *   T3: SMTP disabled → no crash, no email
 */

import { test, expect } from "@playwright/test";

// Skip entire spec unless NOTIF_E2E=1 is explicitly set.
test.skip(
  !process.env.NOTIF_E2E,
  "Skipped: overdue-reminder spec requires NOTIF_E2E=1 + MailHog stack on :8092/:8025"
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PB_URL = process.env.PB_URL ?? "http://localhost:8092";
const MH_URL = process.env.MH_URL ?? "http://localhost:8025";

const SUPERUSER_EMAIL = "admin@example.com";
const SUPERUSER_PASSWORD = "changeme123";
const ADMIN_EMAIL = "logistics@kit.local";
const USER_EMAIL = "requester@kit.local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function authAsUser(email: string, password = "Pass1234!"): Promise<AuthResult> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed for ${email}: ${res.status}`);
  return res.json();
}

/** Create an entity using admin credentials. */
async function createEntity(name: string): Promise<{ id: string }> {
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  const res = await fetch(`${PB_URL}/api/collections/entities/records`, {
    method: "POST",
    headers: { Authorization: adminAuth.token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "lab", is_active: true }),
  });
  if (!res.ok) throw new Error(`createEntity failed: ${res.status}`);
  return res.json();
}

/** Create a kit using admin credentials. */
async function createKit(serial: string): Promise<{ id: string }> {
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  const res = await fetch(`${PB_URL}/api/collections/kits/records`, {
    method: "POST",
    headers: { Authorization: adminAuth.token, "Content-Type": "application/json" },
    body: JSON.stringify({ serial, is_active: true }),
  });
  if (!res.ok) throw new Error(`createKit failed: ${res.status}`);
  return res.json();
}

interface FulfilledRequestPayload {
  requesterId: string;
  requesterToken: string;
  kitId: string;
  entityId: string;
  /** ISO date string in the past, e.g. "2023-01-01" */
  expectedReturn: string;
}

/**
 * Create a fulfilled request with a past expected_return directly via admin PATCH
 * (bypasses workflow to avoid needing transactions).
 */
async function createFulfilledRequest(payload: FulfilledRequestPayload): Promise<{ id: string }> {
  // First create an open request as the user.
  const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const res = await fetch(`${PB_URL}/api/collections/requests/records`, {
    method: "POST",
    headers: {
      Authorization: payload.requesterToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requester: payload.requesterId,
      date: new Date().toISOString().split("T")[0],
      delivery_date: deliveryDate,
      status: "open",
      designated_kit: payload.kitId,
      target_entity: payload.entityId,
    }),
  });
  if (!res.ok) throw new Error(`createRequest failed: ${res.status}`);
  const req = await res.json();

  // Patch to fulfilled + past expected_return as admin.
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  const patchRes = await fetch(`${PB_URL}/api/collections/requests/records/${req.id}`, {
    method: "PATCH",
    headers: { Authorization: adminAuth.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "fulfilled",
      expected_return: payload.expectedReturn,
    }),
  });
  if (!patchRes.ok) throw new Error(`patchRequest failed: ${patchRes.status}`);
  return req;
}

/** Trigger the overdue reminder via the test route. */
async function triggerOverdueReminder(): Promise<{
  fired: boolean;
  sent: number;
  skipped: string | null;
}> {
  const adminAuth = await authAsUser(ADMIN_EMAIL);
  const res = await fetch(`${PB_URL}/_test/overdue-reminder`, {
    method: "POST",
    headers: { Authorization: adminAuth.token },
  });
  if (!res.ok) throw new Error(`trigger failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Clear all MailHog messages. */
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

async function pollMailHog(minCount: number, timeoutMs = 10_000): Promise<MailHogResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
    const data: MailHogResponse = await res.json();
    if (data.total >= minCount) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  const res = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`);
  return res.json();
}

function decodeQP(encoded: string): string {
  return encoded
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractHtmlBody(msg: MailHogMessage): string {
  const outer = msg.MIME?.Parts?.[0];
  if (!outer?.MIME?.Parts) return decodeQP(msg.Content.Body);
  for (const part of outer.MIME.Parts) {
    const ct = part.Headers["Content-Type"]?.[0] ?? "";
    if (ct.includes("text/html")) return decodeQP(part.Body);
  }
  return decodeQP(msg.Content.Body);
}

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

test.describe("Overdue return reminder", () => {
  test.beforeAll(async () => {
    const pbHealth = await fetch(`${PB_URL}/api/health`).catch(() => null);
    if (!pbHealth?.ok) {
      throw new Error(
        `PocketBase at ${PB_URL} is not reachable. Start the stack:\n` +
          "  PB_HOST_PORT=8092 docker compose --profile dev -p notif-qa up -d"
      );
    }
    const mhHealth = await fetch(`${MH_URL}/api/v2/messages`).catch(() => null);
    if (!mhHealth?.ok) {
      throw new Error(`MailHog at ${MH_URL} is not reachable.`);
    }
  });

  test.beforeEach(async () => {
    await clearMailHog();
  });

  // ---------------------------------------------------------------------------
  // T1: Overdue request triggers email to admins
  // ---------------------------------------------------------------------------

  test("T1: overdue fulfilled request triggers admin email", async () => {
    const userAuth = await authAsUser(USER_EMAIL);
    const kit = await createKit(`overdue-kit-${Date.now()}`);
    const entity = await createEntity(`overdue-lab-${Date.now()}`);

    // expected_return well in the past
    const pastDate = "2020-01-01 00:00:00";

    const req = await createFulfilledRequest({
      requesterId: userAuth.record.id,
      requesterToken: userAuth.token,
      kitId: kit.id,
      entityId: entity.id,
      expectedReturn: pastDate,
    });

    const result = await triggerOverdueReminder();

    expect(result.fired, "Route must return fired:true").toBe(true);
    expect(result.sent, "At least 1 email sent").toBeGreaterThanOrEqual(1);

    const mails = await pollMailHog(1);
    expect(mails.total, "MailHog must have received at least 1 email").toBeGreaterThanOrEqual(1);

    // Check the first email subject mentions "overdue"
    const subject = mails.items[0].Content.Headers.Subject?.[0] ?? "";
    expect(subject.toLowerCase(), "Subject must mention 'overdue'").toContain("overdue");

    // HTML body must reference the request
    const html = extractHtmlBody(mails.items[0]);
    expect(html, "Body must reference request id").toContain(req.id);
    expect(html, "Body must reference past due date").toContain("2020-01-01");

    // Addressed to an admin
    const toHeader = mails.items[0].Content.Headers.To?.[0] ?? "";
    expect(toHeader, "Email must be addressed to admin").toContain(ADMIN_EMAIL);
  });

  // ---------------------------------------------------------------------------
  // T2: No overdue requests → no email
  // ---------------------------------------------------------------------------

  test("T2: no overdue requests results in no email", async () => {
    // Trigger without seeding any overdue data (inbox was cleared in beforeEach).
    const result = await triggerOverdueReminder();

    expect(result.fired, "Route must return fired:true").toBe(true);
    // sent may be 0 (no overdue) or skipped tells us why
    // Either sent=0 or skipped=no_overdue
    const noEmail = result.sent === 0;
    expect(noEmail, "No emails should be sent when there are no overdue requests").toBe(true);

    // Give a moment for any rogue in-flight sends
    await new Promise((r) => setTimeout(r, 1500));
    const mails = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`).then(
      (r) => r.json() as Promise<MailHogResponse>
    );
    expect(mails.total, "MailHog inbox must remain empty").toBe(0);
  });

  // ---------------------------------------------------------------------------
  // T3: SMTP disabled → no crash
  // ---------------------------------------------------------------------------

  test("T3: SMTP disabled does not crash the hook", async () => {
    await setSmtpEnabled(false);

    const userAuth = await authAsUser(USER_EMAIL);
    const kit = await createKit(`overdue-smtp-off-kit-${Date.now()}`);
    const entity = await createEntity(`overdue-smtp-off-lab-${Date.now()}`);
    const pastDate = "2021-06-15 00:00:00";

    await createFulfilledRequest({
      requesterId: userAuth.record.id,
      requesterToken: userAuth.token,
      kitId: kit.id,
      entityId: entity.id,
      expectedReturn: pastDate,
    });

    // Should not throw
    let threw = false;
    try {
      const result = await triggerOverdueReminder();
      expect(result.fired, "Route must return fired:true even without SMTP").toBe(true);
    } catch {
      threw = true;
    }
    expect(threw, "Hook must not crash when SMTP is disabled").toBe(false);

    // No mail in MailHog (SMTP off)
    await new Promise((r) => setTimeout(r, 1500));
    const mails = await fetch(`${MH_URL}/api/v2/messages?start=0&limit=50`).then(
      (r) => r.json() as Promise<MailHogResponse>
    );
    expect(mails.total, "No email delivered when SMTP is off").toBe(0);

    // Re-enable SMTP for subsequent tests/suites
    await setSmtpEnabled(true);
  });
});
