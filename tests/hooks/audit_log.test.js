import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// HUT-T3: Verify audit_log.changes.via is set correctly from each write surface.
// - REST request with no audit_via context → "web" (default in audit_log.pb.js)
// - MCP tool call → "mcp" (explicit write in ai_mcp.pb.js, sets audit_via context)
// Covers create + update paths for the web surface. MCP uses direct dao.save so
// onRecordAfterCreateRequest does not fire; ai_mcp.pb.js writes audit_log itself.

describe("audit_log via-tag", () => {
  let baseUrl, suToken, adminToken, adminId;
  let kitId, entityId;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const meRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await meRes.json()).items[0].id;

    // Shared entity for transaction tests
    const eRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `AUDIT-VIA-ENTITY-${Date.now()}`,
        type: "storage",
        category: "storage",
        is_active: true,
      }),
    });
    entityId = (await eRes.json()).id;
  }, 60000);

  afterAll(stopPb);

  it("REST kit create → via=web", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `AUDIT-WEB-KIT-${Date.now()}`, is_active: true }),
    });
    expect(res.status).toBe(200);
    const kit = await res.json();
    kitId = kit.id;

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${kit.id}"`,
      { headers: { Authorization: suToken } }
    );
    const body = await auditRes.json();
    expect(body.items.length).toBeGreaterThan(0);
    const changes = JSON.parse(body.items[0].changes);
    expect(changes.via).toBe("web");
  });

  it("REST kit update → via=web", async () => {
    const res = await fetch(`${baseUrl}/api/collections/kits/records/${kitId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "via-tag update test" }),
    });
    expect(res.status).toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${kitId}"%26%26action%3D"update"&sort=-created`,
      { headers: { Authorization: suToken } }
    );
    const body = await auditRes.json();
    expect(body.items.length).toBeGreaterThan(0);
    const changes = JSON.parse(body.items[0].changes);
    expect(changes.via).toBe("web");
  });

  it("REST transaction create → via=web", async () => {
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `AUDIT-TX-KIT-${Date.now()}`, is_active: true }),
    });
    const txKit = await kitRes.json();

    const txRes = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: txKit.id,
        to_entity: entityId,
        timestamp: new Date().toISOString(),
        created_by: adminId,
      }),
    });
    expect(txRes.status).toBe(200);
    const tx = await txRes.json();

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${tx.id}"`,
      { headers: { Authorization: suToken } }
    );
    const body = await auditRes.json();
    expect(body.items.length).toBeGreaterThan(0);
    const changes = JSON.parse(body.items[0].changes);
    expect(changes.via).toBe("web");
  });

  it("MCP create_kit → via=mcp (ai_mcp.pb.js writes audit directly)", async () => {
    const serial = `AUDIT-MCP-KIT-${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_kit", arguments: { serial } },
      }),
    });
    expect(res.status).toBe(200);
    const rpc = await res.json();
    // Confirm MCP returned success (no isError flag)
    expect(rpc.result?.isError).toBeFalsy();
    const toolResult = JSON.parse(rpc.result.content[0].text);
    expect(toolResult.success).toBe(true);
    const createdKitId = toolResult.record_id;

    // MCP writes audit_log directly (not via audit_log.pb.js hook)
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${createdKitId}"`,
      { headers: { Authorization: suToken } }
    );
    const body = await auditRes.json();
    expect(body.items.length).toBeGreaterThan(0);
    const changes = JSON.parse(body.items[0].changes);
    expect(changes.via).toBe("mcp");
    expect(changes.tool).toBe("create_kit");
  });
});
