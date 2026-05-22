# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: invites.spec.ts >> Invite email binding >> matching email accepted and account created @smoke
- Location: e2e/invites.spec.ts:103:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 500
```

# Test source

```ts
  10  | import { getAdminToken } from "./helpers/api";
  11  | 
  12  | const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
  13  | const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:5173";
  14  | 
  15  | // ---------------------------------------------------------------------------
  16  | // Helpers
  17  | // ---------------------------------------------------------------------------
  18  | 
  19  | async function createBoundInvite(role: string, email: string): Promise<{ url: string; invite_id: string }> {
  20  |   const token = await getAdminToken();
  21  |   const res = await fetch(`${PB_URL}/api/invite/create`, {
  22  |     method: "POST",
  23  |     headers: { Authorization: token, "Content-Type": "application/json" },
  24  |     body: JSON.stringify({ role, email }),
  25  |   });
  26  |   if (!res.ok) {
  27  |     const body = await res.json().catch(() => ({}));
  28  |     throw new Error(`createBoundInvite failed ${res.status}: ${JSON.stringify(body)}`);
  29  |   }
  30  |   return res.json();
  31  | }
  32  | 
  33  | async function acceptInvite(rawToken: string, email: string, password: string): Promise<Response> {
  34  |   return fetch(`${PB_URL}/api/invite/accept`, {
  35  |     method: "POST",
  36  |     headers: { "Content-Type": "application/json" },
  37  |     body: JSON.stringify({ token: rawToken, email, password, name: "Test User" }),
  38  |   });
  39  | }
  40  | 
  41  | /** Extract the raw token from an invite URL like http://host/invite/<token> */
  42  | function extractToken(url: string): string {
  43  |   const parts = url.split("/invite/");
  44  |   if (parts.length < 2 || !parts[1]) throw new Error(`Cannot extract token from URL: ${url}`);
  45  |   return parts[1];
  46  | }
  47  | 
  48  | /** Delete a user by email via superuser API for teardown */
  49  | async function deleteUserByEmail(email: string): Promise<void> {
  50  |   const token = await getAdminToken();
  51  |   // List to find the user id
  52  |   const listRes = await fetch(
  53  |     `${PB_URL}/api/collections/users/records?filter=email%3D%22${encodeURIComponent(email)}%22`,
  54  |     { headers: { Authorization: token } }
  55  |   );
  56  |   if (!listRes.ok) return;
  57  |   const data = await listRes.json();
  58  |   const record = data.items?.[0];
  59  |   if (!record) return;
  60  |   await fetch(`${PB_URL}/api/collections/users/records/${record.id}`, {
  61  |     method: "DELETE",
  62  |     headers: { Authorization: token },
  63  |   });
  64  | }
  65  | 
  66  | /** Revoke an invite by id for teardown */
  67  | async function revokeInvite(inviteId: string): Promise<void> {
  68  |   const token = await getAdminToken();
  69  |   const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
  70  |   await fetch(`${PB_URL}/api/collections/invites/records/${inviteId}`, {
  71  |     method: "PATCH",
  72  |     headers: { Authorization: token, "Content-Type": "application/json" },
  73  |     body: JSON.stringify({ revoked_at: now }),
  74  |   });
  75  | }
  76  | 
  77  | // ---------------------------------------------------------------------------
  78  | // Tests
  79  | // ---------------------------------------------------------------------------
  80  | 
  81  | test.describe("Invite email binding", () => {
  82  |   const ts = Date.now();
  83  |   const boundEmail = `invite-bound-${ts}@test.local`;
  84  |   const wrongEmail = `invite-wrong-${ts}@test.local`;
  85  | 
  86  |   test("mismatched email rejected with 403 @smoke", async () => {
  87  |     let inviteId: string | undefined;
  88  |     try {
  89  |       const invite = await createBoundInvite("user", boundEmail);
  90  |       inviteId = invite.invite_id;
  91  |       const rawToken = extractToken(invite.url);
  92  | 
  93  |       // Try to accept with a different email
  94  |       const res = await acceptInvite(rawToken, wrongEmail, "Password1234!");
  95  |       expect(res.status).toBe(403);
  96  |       const body = await res.json();
  97  |       expect(body.error).toContain("email does not match invite");
  98  |     } finally {
  99  |       if (inviteId) await revokeInvite(inviteId);
  100 |     }
  101 |   });
  102 | 
  103 |   test("matching email accepted and account created @smoke", async () => {
  104 |     try {
  105 |       const invite = await createBoundInvite("user", boundEmail);
  106 |       const rawToken = extractToken(invite.url);
  107 | 
  108 |       // Accept with the correct email
  109 |       const res = await acceptInvite(rawToken, boundEmail, "Password1234!");
> 110 |       expect(res.status).toBe(200);
      |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  111 |       const body = await res.json();
  112 |       expect(body.token).toBeTruthy();
  113 |       expect(body.record.email).toBe(boundEmail);
  114 |       expect(body.record.role).toBe("user");
  115 |     } finally {
  116 |       await deleteUserByEmail(boundEmail);
  117 |       // invite is already used; no need to revoke
  118 |     }
  119 |   });
  120 | 
  121 |   test("legacy invite (no email) accepts any email", async () => {
  122 |     const legacyEmail = `invite-legacy-${ts}@test.local`;
  123 |     try {
  124 |       // Create invite without email field (empty string → hook omits it)
  125 |       const token = await getAdminToken();
  126 |       const res = await fetch(`${PB_URL}/api/invite/create`, {
  127 |         method: "POST",
  128 |         headers: { Authorization: token, "Content-Type": "application/json" },
  129 |         body: JSON.stringify({ role: "viewer" }), // no email key
  130 |       });
  131 |       expect(res.ok).toBeTruthy();
  132 |       const invite = await res.json();
  133 |       const rawToken = extractToken(invite.url);
  134 | 
  135 |       const acceptRes = await acceptInvite(rawToken, legacyEmail, "Password1234!");
  136 |       expect(acceptRes.status).toBe(200);
  137 |     } finally {
  138 |       await deleteUserByEmail(legacyEmail);
  139 |     }
  140 |   });
  141 | 
  142 |   test("admin Invite dialog shows recipient email field @smoke", async ({ page }) => {
  143 |     // Login as admin
  144 |     await page.goto(`${BASE_URL}/login`);
  145 |     await page.getByLabel(/email/i).fill("logistics@kit.local");
  146 |     await page.getByLabel(/password/i).fill("Pass1234!");
  147 |     await page.getByRole("button", { name: "Sign in", exact: true }).click();
  148 |     await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  149 | 
  150 |     // Navigate to users page
  151 |     await page.goto(`${BASE_URL}/users`);
  152 |     await expect(page.getByRole("heading", { name: /users/i })).toBeVisible({ timeout: 8_000 });
  153 | 
  154 |     // Open invite dialog
  155 |     await page.getByRole("button", { name: /invite/i }).click();
  156 |     await expect(page.getByLabel(/recipient email/i)).toBeVisible({ timeout: 5_000 });
  157 |   });
  158 | });
  159 | 
```