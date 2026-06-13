import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/mcp — the MCP server (JSON-RPC 2.0 over Streamable HTTP).
//
// Source: pb/pb_hooks/ai_mcp.pb.js
//   - Auth: missing authRecord → HTTP 401 + JSON-RPC error -32600 "auth_required".
//   - Methods: initialize, ping, notifications/initialized, tools/list, tools/call.
//   - tools/call write tools (create_*/move_*/update_*/decide_request/link_*) gated to
//     admin|technician → JSON-RPC error -32603 "permission_denied" (HTTP 200) otherwise.
//   - Read tools (list_*/get_*/resolve_*/report_*) callable by any authenticated user.
//   - Write tool results audit-logged with changes.via = "mcp" and changes.tool = <tool>.

describe("ai_mcp POST /api/mcp", () => {
  let baseUrl, suToken, adminToken, userToken;

  function rpc(token, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;
    return fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  // Parse the JSON text payload a tools/call result wraps in content[0].text.
  function toolPayload(result) {
    return JSON.parse(result.content[0].text);
  }

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Non-admin (role=user) for the read-allowed / write-denied paths.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mcp-user@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "MCP Non-Admin",
      }),
    });
    userToken = await authUser(baseUrl, "mcp-user@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(stopPb);

  // ---- auth gate ----

  it("returns 401 + JSON-RPC auth_required with no Authorization header", async () => {
    const res = await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(null);
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toBe("auth_required");
  });

  // ---- protocol methods ----

  it("initialize returns protocol version + server info, echoing the request id", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", id: 42, method: "initialize" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(42);
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities).toHaveProperty("tools");
    expect(body.result.serverInfo).toEqual({ name: "kit-tracker-mcp", version: "0.1.0" });
  });

  it("ping returns an empty result object", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", id: "p", method: "ping" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("p");
    expect(body.result).toEqual({});
  });

  it("notifications/initialized is a 200 no-op with no error", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it("returns 400 -32600 when method is missing", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", id: 7 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain("method is required");
  });

  it("returns -32601 for an unknown method", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", id: 8, method: "frobnicate" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("method not found");
  });

  // ---- tools/list ----

  it("tools/list returns well-formed read + write tool definitions", async () => {
    const res = await rpc(adminToken, { jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(res.status).toBe(200);
    const tools = (await res.json()).result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(20);

    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.inputSchema).toBe("object");
    }

    const names = tools.map((t) => t.name);
    // Representative read + write + report tools must be advertised.
    for (const expected of [
      "list_kits", "get_kit", "list_entities", "resolve_kit",
      "create_entity", "create_kit", "move_kit", "decide_request",
      "report_kits_by_entity",
    ]) {
      expect(names).toContain(expected);
    }
  });

  // ---- tools/call validation ----

  it("tools/call without a name returns -32602 invalid_params", async () => {
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 10, method: "tools/call", params: { arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("invalid_params");
  });

  it("tools/call of an unknown tool returns an isError result", async () => {
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    expect(res.status).toBe(200);
    const result = (await res.json()).result;
    expect(result.isError).toBe(true);
    expect(toolPayload(result).error).toContain("unknown tool");
  });

  // ---- read tools: any authenticated user ----

  it("a non-admin user can call a read tool (list_entities)", async () => {
    const name = `MCP-READ-ENTITY-${Math.random().toString(36).slice(2)}`;
    await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, category: "field", is_active: true }),
    });

    const res = await rpc(userToken, {
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "list_entities", arguments: { search: name } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const payload = toolPayload(body.result);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.some((e) => e.name === name)).toBe(true);
  });

  // ---- write tools: admin/technician only ----

  it("a non-admin user is denied a write tool (create_kit) with -32603", async () => {
    const res = await rpc(userToken, {
      jsonrpc: "2.0", id: 13, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: "SHOULD-NOT-EXIST" } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toBe("permission_denied");

    // No kit was created.
    const check = await fetch(
      `${baseUrl}/api/collections/kits/records?filter=serial%3D"SHOULD-NOT-EXIST"`,
      { headers: { Authorization: suToken } }
    );
    expect((await check.json()).items.length).toBe(0);
  });

  it("an admin create_entity succeeds and writes an audit_log row tagged via=mcp", async () => {
    const name = `MCP-CREATE-ENTITY-${Math.random().toString(36).slice(2)}`;
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 14, method: "tools/call",
      params: { name: "create_entity", arguments: { name } },
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);
    expect(payload.record_id).toBeTruthy();

    // Entity actually exists.
    const got = await fetch(`${baseUrl}/api/collections/entities/records/${payload.record_id}`, {
      headers: { Authorization: suToken },
    });
    expect(got.status).toBe(200);
    expect((await got.json()).name).toBe(name);

    // Audit row with changes.via=mcp + tool=create_entity.
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${payload.record_id}"%26%26action%3D"create"`,
      { headers: { Authorization: suToken } }
    );
    const audit = await auditRes.json();
    const mcpRow = audit.items.find((r) => {
      try {
        const c = JSON.parse(r.changes);
        return c.via === "mcp" && c.tool === "create_entity";
      } catch (_) { return false; }
    });
    expect(mcpRow).toBeTruthy();
  });

  it("an admin move_kit creates a transaction, and a repeat move is a no-op", async () => {
    // Build a kit + entity through the write tools themselves.
    const kitRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 15, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: `MCP-MOVE-KIT-${Math.random().toString(36).slice(2)}` } },
    });
    const kitId = toolPayload((await kitRes.json()).result).record_id;

    const entRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 16, method: "tools/call",
      params: { name: "create_entity", arguments: { name: `MCP-MOVE-ENT-${Math.random().toString(36).slice(2)}` } },
    });
    const entityId = toolPayload((await entRes.json()).result).record_id;

    const moveRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 17, method: "tools/call",
      params: { name: "move_kit", arguments: { kit_id: kitId, to_entity_id: entityId } },
    });
    const movePayload = toolPayload((await moveRes.json()).result);
    expect(movePayload.success).toBe(true);

    // A transaction now exists for the kit, pointing at the destination entity.
    const txRes = await fetch(
      `${baseUrl}/api/collections/transactions/records?filter=kit%3D"${kitId}"`,
      { headers: { Authorization: suToken } }
    );
    const txs = (await txRes.json()).items;
    expect(txs.length).toBe(1);
    expect(txs[0].to_entity).toBe(entityId);

    // Moving again to the same entity is a no-op (no second transaction).
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 18, method: "tools/call",
      params: { name: "move_kit", arguments: { kit_id: kitId, to_entity_id: entityId } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.no_op).toBe(true);

    const txRes2 = await fetch(
      `${baseUrl}/api/collections/transactions/records?filter=kit%3D"${kitId}"`,
      { headers: { Authorization: suToken } }
    );
    expect((await txRes2.json()).items.length).toBe(1);
  });

  it("an admin move_component creates a transaction, and a repeat move to same kit is a no-op", async () => {
    // Symmetry with the move_kit no-op behavior (B-G3-1).
    const suffix = Math.random().toString(36).slice(2);

    const prodRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 30, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-MC-PROD-${suffix}`, is_serialized: true } },
    });
    const productId = toolPayload((await prodRes.json()).result).record_id;

    const compRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 31, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: `MCP-MC-COMP-${suffix}` } },
    });
    const componentId = toolPayload((await compRes.json()).result).record_id;

    const kitRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 32, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: `MCP-MC-KIT-${suffix}` } },
    });
    const kitId = toolPayload((await kitRes.json()).result).record_id;

    // First move places the component into the kit.
    const moveRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 33, method: "tools/call",
      params: { name: "move_component", arguments: { component_id: componentId, to_kit_id: kitId } },
    });
    const movePayload = toolPayload((await moveRes.json()).result);
    expect(movePayload.success).toBe(true);

    const ctRes = await fetch(
      `${baseUrl}/api/collections/component_transactions/records?filter=component%3D"${componentId}"`,
      { headers: { Authorization: suToken } }
    );
    expect((await ctRes.json()).items.length).toBe(1);

    // Repeat move to the same kit: no transaction created.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 34, method: "tools/call",
      params: { name: "move_component", arguments: { component_id: componentId, to_kit_id: kitId } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.no_op).toBe(true);

    const ctRes2 = await fetch(
      `${baseUrl}/api/collections/component_transactions/records?filter=component%3D"${componentId}"`,
      { headers: { Authorization: suToken } }
    );
    expect((await ctRes2.json()).items.length).toBe(1);

    // A move to a different destination (entity) is NOT a no-op — still creates a transaction.
    const entRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 35, method: "tools/call",
      params: { name: "create_entity", arguments: { name: `MCP-MC-ENT-${suffix}` } },
    });
    const entityId = toolPayload((await entRes.json()).result).record_id;

    const moveEntRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 36, method: "tools/call",
      params: { name: "move_component", arguments: { component_id: componentId, to_entity_id: entityId } },
    });
    const moveEntPayload = toolPayload((await moveEntRes.json()).result);
    expect(moveEntPayload.success).toBe(true);

    const ctRes3 = await fetch(
      `${baseUrl}/api/collections/component_transactions/records?filter=component%3D"${componentId}"`,
      { headers: { Authorization: suToken } }
    );
    expect((await ctRes3.json()).items.length).toBe(2);
  });

  it("get_kit active_components derives from component_transactions, not components.kit", async () => {
    const suffix = Math.random().toString(36).slice(2);

    // Fetch admin user id (component_transactions.created_by and
    // transactions.created_by are required user relations — bogus ids are rejected
    // by PB's relation validator).
    const adminListRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent(`email="admin@hook-test.local"`)}`,
      { headers: { Authorization: suToken } },
    );
    const adminUserId = (await adminListRes.json()).items[0].id;

    function ok(res, label) {
      if (!res.ok) throw new Error(`${label} seed failed: ${res.status}`);
      return res.json();
    }

    // Seed: entity
    const entityId = (await ok(await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `MCP-GK-ENT-${suffix}`, category: "field", is_active: true }),
    }), "entity")).id;

    // Seed: kit
    const kitId = (await ok(await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `MCP-GK-KIT-${suffix}`, is_active: true }),
    }), "kit")).id;

    // Seed: serialized product — is_serialized=true required, else
    // components_product_serialized_check.pb.js rejects a component with a serial.
    const productId = (await ok(await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `MCP-GK-PROD-${suffix}`, is_active: true, is_serialized: true }),
    }), "product")).id;

    // Seed: component linked to product
    const componentId = (await ok(await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: `MCP-GK-COMP-${suffix}`,
        product: productId,
        is_active: true,
      }),
    }), "component")).id;

    // Seed: component_transactions row placing component into kit.
    // quantity required >= 1 by components_validate.pb.js; created_by required.
    const ctRes = await fetch(`${baseUrl}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        component: componentId,
        to_kit: kitId,
        quantity: 1,
        timestamp: new Date().toISOString(),
        created_by: adminUserId,
      }),
    });
    if (!ctRes.ok) throw new Error(`component_transactions seed failed: ${ctRes.status}`);

    // Seed: transactions row so current_entity_id resolves. created_by required.
    const txRes = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityId,
        timestamp: new Date().toISOString(),
        created_by: adminUserId,
      }),
    });
    if (!txRes.ok) throw new Error(`transactions seed failed: ${txRes.status}`);

    // Call get_kit via MCP
    const res = await rpc(adminToken, {
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: "get_kit", arguments: { id: kitId } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const result = body.result;
    expect(result.isError).not.toBe(true);

    const payload = toolPayload(result);
    expect(Array.isArray(payload.active_components)).toBe(true);
    expect(payload.active_components).toHaveLength(1);

    const ac = payload.active_components[0];
    expect(ac.serial).toBe(`MCP-GK-COMP-${suffix}`);
    expect(ac.product_id).toBe(productId);
    expect(ac.product_name).toBe(`MCP-GK-PROD-${suffix}`);
  });

  // ---- regression: create_product / update_product persist reorder_point + is_consumable ----

  it("create_product persists reorder_point and is_consumable when provided", async () => {
    const name = `MCP-PROD-REORDER-${Math.random().toString(36).slice(2)}`;
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 200, method: "tools/call",
      params: { name: "create_product", arguments: { name, reorder_point: 7, is_consumable: true } },
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);

    const got = await fetch(`${baseUrl}/api/collections/products/records/${payload.record_id}`, {
      headers: { Authorization: suToken },
    });
    const body = await got.json();
    expect(body.name).toBe(name);
    expect(body.reorder_point).toBe(7);
    expect(body.is_consumable).toBe(true);
  });

  it("update_product flips reorder_point + is_consumable and records before/after", async () => {
    // Seed a product with both fields set.
    const seed = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `MCP-PROD-UPD-${Math.random().toString(36).slice(2)}`,
        is_active: true,
        reorder_point: 3,
        is_consumable: false,
      }),
    });
    const seedBody = await seed.json();
    const id = seedBody.id;

    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 201, method: "tools/call",
      params: { name: "update_product", arguments: { id, reorder_point: 12, is_consumable: true } },
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);
    expect(payload.before.reorder_point).toBe(3);
    expect(payload.after.reorder_point).toBe(12);
    expect(payload.before.is_consumable).toBe(false);
    expect(payload.after.is_consumable).toBe(true);

    const got = await fetch(`${baseUrl}/api/collections/products/records/${id}`, {
      headers: { Authorization: suToken },
    });
    const after = await got.json();
    expect(after.reorder_point).toBe(12);
    expect(after.is_consumable).toBe(true);
  });

  it("create_component persists bin_code, lot_code, and expires_at when provided", async () => {
    // Seed serialized product so the serial-required guard accepts the component.
    const prodRes = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `MCP-COMP-PROD-${Math.random().toString(36).slice(2)}`,
        is_active: true,
        is_serialized: true,
      }),
    });
    const productId = (await prodRes.json()).id;

    const serial = `MCP-COMP-BIN-${Math.random().toString(36).slice(2)}`;
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 202, method: "tools/call",
      params: {
        name: "create_component",
        arguments: {
          product_id: productId,
          serial,
          bin_code: "A-12-03",
          lot_code: "LOT-XYZ-001",
          expires_at: "2026-12-31",
        },
      },
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);

    const got = await fetch(`${baseUrl}/api/collections/components/records/${payload.record_id}`, {
      headers: { Authorization: suToken },
    });
    const body = await got.json();
    expect(body.serial).toBe(serial);
    expect(body.bin_code).toBe("A-12-03");
    expect(body.lot_code).toBe("LOT-XYZ-001");
    expect(body.expires_at).toContain("2026-12-31");
  });
});
