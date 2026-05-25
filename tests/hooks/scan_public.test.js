import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Tests for GET /api/scan/:kitId (public — no auth required).
//
// Source: pb/pb_hooks/scan_public.pb.js
//   Lookup by record ID → fall back to serial → 404 if neither found.
//   Returns 404 for retired (is_active=false) kits.
//   Resolves holder from latest transaction's to_entity.

describe("scan_public GET /api/scan/:kitId", () => {
  let baseUrl, suToken;
  let activeKit, retiredKit;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Create an active kit used for positive-path tests
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "SCAN-ACTIVE-001", is_active: true }),
    });
    activeKit = await kitRes.json();

    // Create a retired kit
    const retiredRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "SCAN-RETIRED-001", is_active: false }),
    });
    retiredKit = await retiredRes.json();

    // Create an entity to act as kit holder
    const entityRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Scan Test Unit", category: "field", is_active: true }),
    });
    const entity = await entityRes.json();

    // Authenticate as admin to get both token and record ID (needed for created_by)
    const authRes = await fetch(
      `${baseUrl}/api/collections/users/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: "admin@hook-test.local", password: "Adminpass1!" }),
      }
    );
    const authData = await authRes.json();
    const adminToken = authData.token;
    const adminId = authData.record.id;

    // Move activeKit to entity via a transaction
    await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: activeKit.id,
        to_entity: entity.id,
        timestamp: new Date().toISOString(),
        created_by: adminId,
      }),
    });
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 404 for an unknown kitId", async () => {
    const res = await fetch(`${baseUrl}/api/scan/nonexistent_id_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("kit not found");
  });

  it("returns 404 for a retired kit looked up by record ID", async () => {
    const res = await fetch(`${baseUrl}/api/scan/${retiredKit.id}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("kit retired");
  });

  it("returns 404 for a retired kit looked up by serial", async () => {
    const res = await fetch(`${baseUrl}/api/scan/SCAN-RETIRED-001`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("kit retired");
  });

  it("returns 200 by record ID with holder resolved from latest transaction", async () => {
    const res = await fetch(`${baseUrl}/api/scan/${activeKit.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("SCAN-ACTIVE-001");
    expect(body.holder).toBe("Scan Test Unit");
    expect(body).toHaveProperty("tags");
  });

  it("returns 200 by serial with holder resolved from latest transaction", async () => {
    const res = await fetch(`${baseUrl}/api/scan/SCAN-ACTIVE-001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("SCAN-ACTIVE-001");
    expect(body.holder).toBe("Scan Test Unit");
  });

  it("returns 200 with empty holder when kit has no transactions", async () => {
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "SCAN-NOTX-001", is_active: true }),
    });
    const kit = await kitRes.json();

    const res = await fetch(`${baseUrl}/api/scan/${kit.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serial).toBe("SCAN-NOTX-001");
    expect(body.holder).toBe("");
  });
});
