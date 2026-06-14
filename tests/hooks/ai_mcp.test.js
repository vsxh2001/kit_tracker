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

    // Repeat move to the same kit: no transaction created. Assert the full
    // contract shape that MCP clients special-case on (parity with move_kit guard).
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 34, method: "tools/call",
      params: { name: "move_component", arguments: { component_id: componentId, to_kit_id: kitId } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already at/);

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

    // Entity→entity no-op: exercises the second disjunct of the predicate
    // (toEntityId && fromEntityId === toEntityId). Component is now at entityId
    // (after the kit→entity move above); moving to the same entity must no-op.
    const repeatEntRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 37, method: "tools/call",
      params: { name: "move_component", arguments: { component_id: componentId, to_entity_id: entityId } },
    });
    const repeatEntPayload = toolPayload((await repeatEntRes.json()).result);
    expect(repeatEntPayload.ok).toBe(true);
    expect(repeatEntPayload.no_op).toBe(true);
    expect(repeatEntPayload.message).toMatch(/already at/);

    const ctRes4 = await fetch(
      `${baseUrl}/api/collections/component_transactions/records?filter=component%3D"${componentId}"`,
      { headers: { Authorization: suToken } }
    );
    expect((await ctRes4.json()).items.length).toBe(2);
  });

  it("an admin decide_request transitions status, and a repeat decision is a no-op", async () => {
    // Symmetry with the move_kit / move_component no-op behavior. A repeat
    // decide_request on a request already in the target status must not write
    // a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);

    // Fetch admin user id — requests.requester is a required user relation.
    const adminListRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent(`email="admin@hook-test.local"`)}`,
      { headers: { Authorization: suToken } },
    );
    const adminUserId = (await adminListRes.json()).items[0].id;

    // Seed a kit + an open request directly via REST (request creation is
    // not an MCP tool surface).
    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `MCP-DR-KIT-${suffix}`, is_active: true }),
    });
    const kitId = (await kitRes.json()).id;

    const today = new Date().toISOString().slice(0, 10);
    const reqRes = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: adminUserId,
        designated_kit: kitId,
        status: "open",
        date: today,
        delivery_date: today,
      }),
    });
    const requestId = (await reqRes.json()).id;

    // First approval transitions open → approved.
    const decideRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 40, method: "tools/call",
      params: { name: "decide_request", arguments: { request_id: requestId, decision: "approve" } },
    });
    const decidePayload = toolPayload((await decideRes.json()).result);
    expect(decidePayload.success).toBe(true);
    expect(decidePayload.new_status).toBe("approved");

    // Capture audit_log count for this request after the real decision.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${requestId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat approve on already-approved request: must no-op with the same
    // contract shape the move_kit / move_component guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 41, method: "tools/call",
      params: { name: "decide_request", arguments: { request_id: requestId, decision: "approve" } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already approved/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${requestId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);
  });

  it("an admin link_component_to_product relinks, and a repeat link to the same product is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request no-op
    // behavior. A repeat link to the product the component is already on must
    // not write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);

    const prodARes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 50, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-LC-PRODA-${suffix}`, is_serialized: true } },
    });
    const productAId = toolPayload((await prodARes.json()).result).record_id;

    const prodBRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 51, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-LC-PRODB-${suffix}`, is_serialized: true } },
    });
    const productBId = toolPayload((await prodBRes.json()).result).record_id;

    const compRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 52, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productAId, serial: `MCP-LC-COMP-${suffix}` } },
    });
    const componentId = toolPayload((await compRes.json()).result).record_id;

    // First relink: A → B succeeds.
    const linkRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 53, method: "tools/call",
      params: { name: "link_component_to_product", arguments: { component_id: componentId, product_id: productBId } },
    });
    const linkPayload = toolPayload((await linkRes.json()).result);
    expect(linkPayload.success).toBe(true);
    expect(linkPayload.new_product_id).toBe(productBId);

    // Capture audit_log count for this component after the real link.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${componentId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat link to product B (already current): must no-op with the same
    // contract shape the move_kit / move_component / decide_request guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 54, method: "tools/call",
      params: { name: "link_component_to_product", arguments: { component_id: componentId, product_id: productBId } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already linked/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${componentId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);
  });

  it("an admin update_user_phone sets the phone, and a repeat update to the same phone is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request / link_component
    // no-op behavior. A repeat update_user_phone with the same value must not
    // write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const targetEmail = `mcp-phone-${suffix}@hook-test.local`;

    const createTargetRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: targetEmail,
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: `MCP Phone Target ${suffix}`,
      }),
    });
    const targetUserId = (await createTargetRes.json()).id;

    const newPhone = "+15551234567";

    // First update: writes the phone.
    const updateRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 60, method: "tools/call",
      params: { name: "update_user_phone", arguments: { email: targetEmail, phone: newPhone } },
    });
    const updatePayload = toolPayload((await updateRes.json()).result);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.after.phone).toBe(newPhone);

    // Capture audit_log count for this user after the real update.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${targetUserId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat update with the same phone: must no-op with the same contract
    // shape the sibling guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 61, method: "tools/call",
      params: { name: "update_user_phone", arguments: { email: targetEmail, phone: newPhone } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${targetUserId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different phone value is NOT a no-op.
    const differentPhone = "+15559999999";
    const changeRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 62, method: "tools/call",
      params: { name: "update_user_phone", arguments: { email: targetEmail, phone: differentPhone } },
    });
    const changePayload = toolPayload((await changeRes.json()).result);
    expect(changePayload.success).toBe(true);
    expect(changePayload.after.phone).toBe(differentPhone);
  });

  it("an admin update_user_telegram_chat_id sets the chat id, and a repeat update to the same value is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone no-op behavior. A repeat
    // update_user_telegram_chat_id with the same value must not write a
    // redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const targetEmail = `mcp-tg-${suffix}@hook-test.local`;

    const createTargetRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: targetEmail,
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: `MCP TG Target ${suffix}`,
      }),
    });
    const targetUserId = (await createTargetRes.json()).id;

    const newChatId = "987654321";

    // First update: writes the chat id.
    const updateRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 70, method: "tools/call",
      params: { name: "update_user_telegram_chat_id", arguments: { email: targetEmail, telegram_chat_id: newChatId } },
    });
    const updatePayload = toolPayload((await updateRes.json()).result);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.after.telegram_chat_id).toBe(newChatId);

    // Capture audit_log count for this user after the real update.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${targetUserId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat update with the same chat id: must no-op with the same contract
    // shape the sibling guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 71, method: "tools/call",
      params: { name: "update_user_telegram_chat_id", arguments: { email: targetEmail, telegram_chat_id: newChatId } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${targetUserId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different chat id value is NOT a no-op.
    const differentChatId = "111222333";
    const changeRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 72, method: "tools/call",
      params: { name: "update_user_telegram_chat_id", arguments: { email: targetEmail, telegram_chat_id: differentChatId } },
    });
    const changePayload = toolPayload((await changeRes.json()).result);
    expect(changePayload.success).toBe(true);
    expect(changePayload.after.telegram_chat_id).toBe(differentChatId);
  });

  it("an admin update_product changes a field, and a repeat update with the same value is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone / update_user_telegram_chat_id
    // no-op behavior. A repeat update_product with the same value must not
    // write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const productName = `MCP-UP-PROD-${suffix}`;

    // Create a product via the MCP create_product tool.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 80, method: "tools/call",
      params: { name: "create_product", arguments: { name: productName, is_serialized: false } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const id = createPayload.record_id;

    // First update: writes the description.
    const updateRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 81, method: "tools/call",
      params: { name: "update_product", arguments: { id, description: "first" } },
    });
    const updatePayload = toolPayload((await updateRes.json()).result);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.after.description).toBe("first");

    // Capture audit_log count for this product after the real update.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat update with the same description: must no-op with the same
    // contract shape the sibling guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 82, method: "tools/call",
      params: { name: "update_product", arguments: { id, description: "first" } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different description value is NOT a no-op.
    const changeRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 83, method: "tools/call",
      params: { name: "update_product", arguments: { id, description: "second" } },
    });
    const changePayload = toolPayload((await changeRes.json()).result);
    expect(changePayload.success).toBe(true);
    expect(changePayload.after.description).toBe("second");
  });

  it("an admin update_kit changes a field, and a repeat update with the same value is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone / update_user_telegram_chat_id /
    // update_product no-op behavior. A repeat update_kit with the same value
    // must not write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const kitSerial = `MCP-UK-KIT-${suffix}`;

    // Create a kit via the MCP create_kit tool.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 90, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: kitSerial } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const id = createPayload.record_id;

    // First update: writes the notes.
    const updateRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 91, method: "tools/call",
      params: { name: "update_kit", arguments: { id, notes: "first" } },
    });
    const updatePayload = toolPayload((await updateRes.json()).result);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.after.notes).toBe("first");

    // Capture audit_log count for this kit after the real update.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat update with the same notes: must no-op with the same contract
    // shape the sibling guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 92, method: "tools/call",
      params: { name: "update_kit", arguments: { id, notes: "first" } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different notes value is NOT a no-op.
    const changeRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 93, method: "tools/call",
      params: { name: "update_kit", arguments: { id, notes: "second" } },
    });
    const changePayload = toolPayload((await changeRes.json()).result);
    expect(changePayload.success).toBe(true);
    expect(changePayload.after.notes).toBe("second");
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

  it("an admin create_entity creates the record, and a repeat create with the same name is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone / update_user_telegram_chat_id /
    // update_entity / update_product / update_kit no-op guards. A repeat
    // create_entity with the same active name must return no_op with the
    // existing record_id instead of failing with create_failed (which is
    // what entities_active_name_unique would otherwise produce), and must
    // not write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const entityName = `MCP-CE-ENT-${suffix}`;

    // First create succeeds.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 100, method: "tools/call",
      params: { name: "create_entity", arguments: { name: entityName } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const recordId = createPayload.record_id;

    // Capture audit_log count for this entity after the real create.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat create with the same name: must no-op with the same contract
    // shape the sibling guards return, including the existing record_id.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 101, method: "tools/call",
      params: { name: "create_entity", arguments: { name: entityName } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.record_id).toBe(recordId);
    expect(repeatPayload.message).toMatch(/already exists/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different name is NOT a no-op — new record created.
    const otherName = `${entityName}-OTHER`;
    const otherRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 102, method: "tools/call",
      params: { name: "create_entity", arguments: { name: otherName } },
    });
    const otherPayload = toolPayload((await otherRes.json()).result);
    expect(otherPayload.success).toBe(true);
    expect(otherPayload.record_id).not.toBe(recordId);

    // Soft-delete bypass: an inactive entity with the same name does NOT
    // shadow a new create (mirrors entities_active_name_unique behavior).
    const retireRes = await fetch(
      `${baseUrl}/api/collections/entities/records/${recordId}`,
      {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      },
    );
    expect(retireRes.status).toBe(200);

    const afterRetireRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 103, method: "tools/call",
      params: { name: "create_entity", arguments: { name: entityName } },
    });
    const afterRetirePayload = toolPayload((await afterRetireRes.json()).result);
    expect(afterRetirePayload.success).toBe(true);
    expect(afterRetirePayload.record_id).not.toBe(recordId);
  });

  it("an admin create_kit creates the record, and a repeat create with the same serial is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone / update_user_telegram_chat_id /
    // update_entity / update_product / update_kit / create_entity no-op guards.
    // A repeat create_kit with the same active serial must return no_op with the
    // existing record_id instead of failing with create_failed (which is what
    // kits_active_serial_unique would otherwise produce), and must not write a
    // redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const kitSerial = `MCP-CK-${suffix}`;

    // First create succeeds.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 110, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: kitSerial } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const recordId = createPayload.record_id;

    // Capture audit_log count for this kit after the real create.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat create with the same serial: must no-op with the same contract
    // shape the sibling guards return, including the existing record_id.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 111, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: kitSerial } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.record_id).toBe(recordId);
    expect(repeatPayload.message).toMatch(/already exists/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different serial is NOT a no-op — new record created.
    const otherSerial = `${kitSerial}-OTHER`;
    const otherRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 112, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: otherSerial } },
    });
    const otherPayload = toolPayload((await otherRes.json()).result);
    expect(otherPayload.success).toBe(true);
    expect(otherPayload.record_id).not.toBe(recordId);

    // Soft-delete bypass: an inactive kit with the same serial does NOT
    // shadow a new create (mirrors kits_active_serial_unique behavior).
    const retireRes = await fetch(
      `${baseUrl}/api/collections/kits/records/${recordId}`,
      {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      },
    );
    expect(retireRes.status).toBe(200);

    const afterRetireRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 113, method: "tools/call",
      params: { name: "create_kit", arguments: { serial: kitSerial } },
    });
    const afterRetirePayload = toolPayload((await afterRetireRes.json()).result);
    expect(afterRetirePayload.success).toBe(true);
    expect(afterRetirePayload.record_id).not.toBe(recordId);
  });

  it("an admin create_product creates the record, and a repeat create with the same name is a no-op", async () => {
    // Symmetry with the move_kit / move_component / decide_request /
    // link_component / update_user_phone / update_user_telegram_chat_id /
    // update_entity / update_product / update_kit / create_entity / create_kit
    // no-op guards. A repeat create_product with the same active name must
    // return no_op with the existing record_id instead of failing with
    // create_failed (which is what products_active_name_unique would otherwise
    // produce), and must not write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);
    const productName = `MCP-CP-${suffix}`;

    // First create succeeds.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 120, method: "tools/call",
      params: { name: "create_product", arguments: { name: productName } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const recordId = createPayload.record_id;

    // Capture audit_log count for this product after the real create.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat create with the same name: must no-op with the same contract
    // shape the sibling guards return, including the existing record_id.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 121, method: "tools/call",
      params: { name: "create_product", arguments: { name: productName } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.record_id).toBe(recordId);
    expect(repeatPayload.message).toMatch(/already exists/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different name is NOT a no-op — new record created.
    const otherName = `${productName}-OTHER`;
    const otherRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 122, method: "tools/call",
      params: { name: "create_product", arguments: { name: otherName } },
    });
    const otherPayload = toolPayload((await otherRes.json()).result);
    expect(otherPayload.success).toBe(true);
    expect(otherPayload.record_id).not.toBe(recordId);

    // Soft-delete bypass: an inactive product with the same name does NOT
    // shadow a new create (mirrors products_active_name_unique behavior).
    const retireRes = await fetch(
      `${baseUrl}/api/collections/products/records/${recordId}`,
      {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      },
    );
    expect(retireRes.status).toBe(200);

    const afterRetireRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 123, method: "tools/call",
      params: { name: "create_product", arguments: { name: productName } },
    });
    const afterRetirePayload = toolPayload((await afterRetireRes.json()).result);
    expect(afterRetirePayload.success).toBe(true);
    expect(afterRetirePayload.record_id).not.toBe(recordId);
  });

  it("an admin create_component creates the record, and a repeat create with the same serialized serial is a no-op", async () => {
    // 14th and final create-side no-op guard, closing the series. A repeat
    // create_component with the same active serial (on a serialized product)
    // must return no_op with the existing record_id instead of failing with
    // create_failed (which is what components_active_serial_unique would
    // otherwise produce), and must not write a redundant audit_log row.
    //
    // The guard only fires for serialized components (is_bulk=false) with a
    // non-empty serial — bulk components share the namespace and are exempt
    // from the underlying constraint.
    const suffix = Math.random().toString(36).slice(2);
    const componentSerial = `MCP-CC-${suffix}`;

    // Seed a serialized product so the create_component path with a serial
    // is accepted by components_product_serialized_check.
    const prodRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 130, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-CC-PROD-${suffix}`, is_serialized: true } },
    });
    const productId = toolPayload((await prodRes.json()).result).record_id;

    // First create succeeds.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 131, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: componentSerial } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const recordId = createPayload.record_id;

    // Capture audit_log count for this component after the real create.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat create with the same serial: must no-op with the same contract
    // shape the sibling guards return, including the existing record_id.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 132, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: componentSerial } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.record_id).toBe(recordId);
    expect(repeatPayload.message).toMatch(/already exists/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${recordId}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different serial is NOT a no-op — new record created.
    const otherSerial = `${componentSerial}-OTHER`;
    const otherRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 133, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: otherSerial } },
    });
    const otherPayload = toolPayload((await otherRes.json()).result);
    expect(otherPayload.success).toBe(true);
    expect(otherPayload.record_id).not.toBe(recordId);

    // Soft-delete bypass: an inactive serialized component with the same
    // serial does NOT shadow a new create (mirrors components_active_serial_unique).
    // Authenticate as the app admin for the PATCH — the components REST field
    // guard at components_validate.pb.js rejects the superuser panel token
    // because it has no users.role (documented gotcha in CLAUDE.md).
    const retireRes = await fetch(
      `${baseUrl}/api/collections/components/records/${recordId}`,
      {
        method: "PATCH",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      },
    );
    expect(retireRes.status).toBe(200);

    const afterRetireRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 134, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: componentSerial } },
    });
    const afterRetirePayload = toolPayload((await afterRetireRes.json()).result);
    expect(afterRetirePayload.success).toBe(true);
    expect(afterRetirePayload.record_id).not.toBe(recordId);

    // Bulk-component exemption: a bulk component with a duplicate serial is
    // NOT a no-op (the underlying unique constraint exempts bulks, so the
    // guard must too). Seed a bulk-capable product first, then verify the
    // bulk create succeeds even when the soft-deleted serialized record above
    // shares the same serial string.
    const bulkProdRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 135, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-CC-BULK-PROD-${suffix}`, is_serialized: false } },
    });
    const bulkProductId = toolPayload((await bulkProdRes.json()).result).record_id;

    const bulkRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 136, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: bulkProductId, is_bulk: true, quantity: 5 } },
    });
    const bulkPayload = toolPayload((await bulkRes.json()).result);
    expect(bulkPayload.success).toBe(true);
    expect(bulkPayload.is_bulk).toBe(true);
  });

  it("an admin update_component changes a field, and a repeat update with the same value is a no-op", async () => {
    // Symmetry with update_kit / update_product no-op behavior. A repeat
    // update_component with the same value must not write a redundant audit_log row.
    const suffix = Math.random().toString(36).slice(2);

    // Seed a serialized product so create_component accepts the serial.
    const prodRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 140, method: "tools/call",
      params: { name: "create_product", arguments: { name: `MCP-UC-PROD-${suffix}`, is_serialized: true } },
    });
    const productId = toolPayload((await prodRes.json()).result).record_id;

    // Create a component via the MCP create_component tool.
    const createRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 141, method: "tools/call",
      params: { name: "create_component", arguments: { product_id: productId, serial: `MCP-UC-COMP-${suffix}` } },
    });
    const createPayload = toolPayload((await createRes.json()).result);
    expect(createPayload.success).toBe(true);
    const id = createPayload.record_id;

    // First update: writes the notes.
    const updateRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 142, method: "tools/call",
      params: { name: "update_component", arguments: { id, notes: "first" } },
    });
    const updatePayload = toolPayload((await updateRes.json()).result);
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.after.notes).toBe("first");

    // Capture audit_log count for this component after the real update.
    const auditRes1 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    const auditCount1 = (await auditRes1.json()).items.length;

    // Repeat update with the same notes: must no-op with the same contract
    // shape the sibling guards return.
    const repeatRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 143, method: "tools/call",
      params: { name: "update_component", arguments: { id, notes: "first" } },
    });
    const repeatPayload = toolPayload((await repeatRes.json()).result);
    expect(repeatPayload.ok).toBe(true);
    expect(repeatPayload.no_op).toBe(true);
    expect(repeatPayload.message).toMatch(/already/);

    // No new audit_log row was written for the no-op call.
    const auditRes2 = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`record_id="${id}"`)}`,
      { headers: { Authorization: suToken } },
    );
    expect((await auditRes2.json()).items.length).toBe(auditCount1);

    // Sanity: a different notes value is NOT a no-op.
    const changeRes = await rpc(adminToken, {
      jsonrpc: "2.0", id: 144, method: "tools/call",
      params: { name: "update_component", arguments: { id, notes: "second" } },
    });
    const changePayload = toolPayload((await changeRes.json()).result);
    expect(changePayload.success).toBe(true);
    expect(changePayload.after.notes).toBe("second");
  });

  it("update_component flips bin_code + lot_code + expires_at and records before/after", async () => {
    const suffix = Math.random().toString(36).slice(2);

    // Seed a product (non-serialized is fine for fields-only update test).
    const prodRes = await fetch(`${baseUrl}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `MCP-UC-FLD-PROD-${suffix}`,
        is_active: true,
        is_serialized: false,
      }),
    });
    const productId = (await prodRes.json()).id;

    // Seed a component with initial field values.
    const compRes = await fetch(`${baseUrl}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        product: productId,
        is_active: true,
        bin_code: "A-01-01",
        lot_code: "LOT-ORIG-001",
        expires_at: "2025-12-31 00:00:00.000Z",
      }),
    });
    const id = (await compRes.json()).id;

    // Update all three fields.
    const res = await rpc(adminToken, {
      jsonrpc: "2.0", id: 150, method: "tools/call",
      params: {
        name: "update_component",
        arguments: { id, bin_code: "B-02-09", lot_code: "LOT-NEW-999", expires_at: "2027-06-30" },
      },
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);
    expect(payload.before.bin_code).toBe("A-01-01");
    expect(payload.after.bin_code).toBe("B-02-09");
    expect(payload.before.lot_code).toBe("LOT-ORIG-001");
    expect(payload.after.lot_code).toBe("LOT-NEW-999");
    expect(payload.before.expires_at).toContain("2025-12-31");
    expect(payload.after.expires_at).toBe("2027-06-30");

    // Confirm the DB was updated.
    const got = await fetch(`${baseUrl}/api/collections/components/records/${id}`, {
      headers: { Authorization: suToken },
    });
    const body = await got.json();
    expect(body.bin_code).toBe("B-02-09");
    expect(body.lot_code).toBe("LOT-NEW-999");
    expect(body.expires_at).toContain("2027-06-30");
  });
});
