import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for the update_user_telegram_chat_id tool, exercised via both:
//   POST /api/ai/chat  (ai_chat.pb.js — via="ai-agent")
//   POST /api/mcp      (ai_mcp.pb.js  — via="mcp")
//
// Covers:
//   - admin sets telegram_chat_id on another user (success + field persisted)
//   - role gate: a non-admin/non-technician (role=user) is denied via MCP
//   - empty / whitespace-only chat_id rejected with clear error

describe("update_user_telegram_chat_id", () => {
  let baseUrl, suToken, adminToken, userToken;
  let targetUserId;

  // ---------- MCP helper ----------

  function rpcMcp(token, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;
    return fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  function toolCall(token, toolName, args) {
    return rpcMcp(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
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

    // Create a target user (role=user) for the admin to operate on.
    const createRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tg-target@hook-test.local",
        password: "Targetpass1!",
        passwordConfirm: "Targetpass1!",
        role: "user",
        name: "TG Target User",
      }),
    });
    const targetData = await createRes.json();
    targetUserId = targetData.id;

    // Create a non-admin user (role=user) to test the role gate.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tg-user@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "TG Non-Admin",
      }),
    });
    userToken = await authUser(baseUrl, "tg-user@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(stopPb);

  // ---- success: admin sets telegram_chat_id ----

  it("admin sets telegram_chat_id on a target user via MCP — field persisted", async () => {
    const chatId = "987654321";
    const res = await toolCall(adminToken, "update_user_telegram_chat_id", {
      email: "tg-target@hook-test.local",
      telegram_chat_id: chatId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const payload = toolPayload(body.result);
    expect(payload.success).toBe(true);
    expect(payload.after.telegram_chat_id).toBe(chatId);

    // Verify the field is actually persisted in the DB.
    const got = await fetch(`${baseUrl}/api/collections/users/records/${targetUserId}`, {
      headers: { Authorization: suToken },
    });
    expect(got.status).toBe(200);
    const record = await got.json();
    expect(record.telegram_chat_id).toBe(chatId);
  });

  // ---- success: audit log written with via=mcp ----

  it("update_user_telegram_chat_id write is audit-logged with via=mcp and tool tag", async () => {
    const chatId = "111222333";
    const res = await toolCall(adminToken, "update_user_telegram_chat_id", {
      email: "tg-target@hook-test.local",
      telegram_chat_id: chatId,
    });
    expect(res.status).toBe(200);
    const payload = toolPayload((await res.json()).result);
    expect(payload.success).toBe(true);

    // Find the audit row for this record.
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${targetUserId}"%26%26action%3D"update"&sort=-created&perPage=5`,
      { headers: { Authorization: suToken } }
    );
    const audit = await auditRes.json();
    const mcpRow = audit.items.find((r) => {
      try {
        const c = JSON.parse(r.changes);
        return c.via === "mcp" && c.tool === "update_user_telegram_chat_id";
      } catch (_) { return false; }
    });
    expect(mcpRow).toBeTruthy();
  });

  // ---- role gate: non-admin user denied ----

  it("a non-admin user is denied update_user_telegram_chat_id on another user via MCP (-32603)", async () => {
    const res = await toolCall(userToken, "update_user_telegram_chat_id", {
      email: "tg-target@hook-test.local",
      telegram_chat_id: "444555666",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Outer gate returns -32603 permission_denied before the tool even runs.
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toBe("permission_denied");
  });

  // ---- validation: empty input rejected ----

  it("empty telegram_chat_id is rejected with invalid_input error", async () => {
    const res = await toolCall(adminToken, "update_user_telegram_chat_id", {
      email: "tg-target@hook-test.local",
      telegram_chat_id: "",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const payload = toolPayload(body.result);
    expect(payload.error).toBe("invalid_input");
    expect(payload.detail).toMatch(/empty|whitespace/i);
  });

  // ---- validation: whitespace-only input rejected ----

  it("whitespace-only telegram_chat_id is rejected with invalid_input error", async () => {
    const res = await toolCall(adminToken, "update_user_telegram_chat_id", {
      email: "tg-target@hook-test.local",
      telegram_chat_id: "   ",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const payload = toolPayload(body.result);
    expect(payload.error).toBe("invalid_input");
    expect(payload.detail).toMatch(/empty|whitespace/i);
  });

  // ---- tool is listed in tools/list ----

  it("update_user_telegram_chat_id appears in MCP tools/list", async () => {
    const res = await rpcMcp(adminToken, { jsonrpc: "2.0", id: 99, method: "tools/list" });
    expect(res.status).toBe(200);
    const tools = (await res.json()).result.tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("update_user_telegram_chat_id");
  });
});
