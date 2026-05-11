/**
 * Audit log tests.
 *
 * Coverage:
 *   - Admin updates a kit → audit_log has a row with action=update,
 *     correct actor, correct before/after diff.
 *   - Non-admin GET /api/collections/audit_log/records → 403.
 */

import { test, expect } from "@playwright/test";
import {
  getAdminToken,
  getAdminUserId,
  createTestKit,
  deleteKit,
  getUserTokenByEmail,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const TS = `audit-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1 — admin updates a kit, audit row appears with correct content
// ---------------------------------------------------------------------------
test.describe("Audit log — write on update", () => {
  let kitId: string;
  const originalNotes = `original-notes-${TS}`;
  const updatedNotes = `updated-notes-${TS}`;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`, originalNotes);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("admin updates kit notes → audit_log row recorded with correct actor and diff @smoke", async () => {
    const token = await getAdminToken();
    const adminId = await getAdminUserId();

    // Update the kit notes via REST
    const patchRes = await fetch(
      `${PB_URL}/api/collections/kits/records/${kitId}`,
      {
        method: "PATCH",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ notes: updatedNotes }),
      }
    );
    expect(patchRes.ok).toBe(true);

    // Poll audit_log for up to 2s (hook is async-ish but in-process so usually instant)
    let auditRow: Record<string, unknown> | null = null;
    for (let i = 0; i < 10; i++) {
      const encoded = encodeURIComponent(
        `collection_name="kits" && record_id="${kitId}" && action="update"`
      );
      const res = await fetch(
        `${PB_URL}/api/collections/audit_log/records?filter=${encoded}&sort=-created&perPage=1`,
        { headers: { Authorization: token } }
      );
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        auditRow = data.items[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(auditRow).not.toBeNull();
    expect(auditRow!.action).toBe("update");
    expect(auditRow!.actor).toBe(adminId);
    expect(auditRow!.collection_name).toBe("kits");
    expect(auditRow!.record_id).toBe(kitId);

    const changes = JSON.parse(auditRow!.changes as string);
    expect(changes.before.notes).toBe(originalNotes);
    expect(changes.after.notes).toBe(updatedNotes);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — non-admin cannot list audit_log records (403)
// ---------------------------------------------------------------------------
test.describe("Audit log — access control", () => {
  // PB v0.22 behaviour: listRule acts as a row filter, not a gate.
  // A non-admin user gets 200 but 0 items — effectively denied access to data.
  // viewRule enforces 403 when accessing a specific record by ID.
  test("non-admin gets empty audit_log list (data access denied)", async () => {
    const { token: requesterToken } = await getUserTokenByEmail(
      "requester@kit.local",
      "Pass1234!"
    );

    const res = await fetch(`${PB_URL}/api/collections/audit_log/records`, {
      headers: { Authorization: requesterToken },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Non-admin sees zero records — listRule filters them out
    expect(data.totalItems).toBe(0);
    expect(data.items).toHaveLength(0);
  });

  test("non-admin view of specific audit_log record → 403", async () => {
    // Create an audit entry first (as admin)
    const adminToken = await getAdminToken();
    const kit = await createTestKit(`acl-test-${Date.now()}`, "acl-original");
    const kitId = kit.id;

    try {
      // Trigger an update to produce an audit row
      await fetch(`${PB_URL}/api/collections/kits/records/${kitId}`, {
        method: "PATCH",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "acl-updated" }),
      });

      // Wait briefly for hook to write
      await new Promise((r) => setTimeout(r, 300));

      // Get the audit row ID as admin
      const encoded = encodeURIComponent(
        `collection_name="kits" && record_id="${kitId}"`
      );
      const auditRes = await fetch(
        `${PB_URL}/api/collections/audit_log/records?filter=${encoded}&sort=-created&perPage=1`,
        { headers: { Authorization: adminToken } }
      );
      const auditData = await auditRes.json();
      const auditId = auditData.items?.[0]?.id;
      expect(auditId).toBeTruthy();

      // Now try to view that specific record as non-admin → 403 or 404
      // PB v0.22 returns 404 (not found) when viewRule fails, to avoid leaking existence.
      const { token: requesterToken } = await getUserTokenByEmail(
        "requester@kit.local",
        "Pass1234!"
      );
      const viewRes = await fetch(
        `${PB_URL}/api/collections/audit_log/records/${auditId}`,
        { headers: { Authorization: requesterToken } }
      );
      expect([403, 404]).toContain(viewRes.status);
    } finally {
      await deleteKit(kitId);
    }
  });
});
