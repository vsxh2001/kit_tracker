import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Tests for POST /api/ai/chat and POST /api/ai/undo.
//
// Source: pb/pb_hooks/ai_chat.pb.js
//
// Reachable return paths covered (no ANTHROPIC_API_KEY in CI):
//
// POST /api/ai/chat
//   line 2050  — no authRecord       → 401 { error: "auth required" }
//   line 2106  — blank message       → 400 { error: "message is required" }
//   line 2130  — no API key (fallback)→ 200 { reply, sessionId, done, toolsUsed }
//               fallback reply echoes original message text
//               sessionId defaults to userId when omitted
//
// POST /api/ai/undo
//   line 2403  — no authRecord       → 401 { error: "auth required" }
//   line 2410  — missing undo_token  → 400 { error: "undo_token is required" }
//   line 2416  — token not in store  → 400 { error: "expired", detail: /not found or already used/ }

describe("ai_chat POST /api/ai/chat + POST /api/ai/undo", () => {
  let baseUrl, adminToken, adminUserId;

  function chat(token, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;
    return fetch(`${baseUrl}/api/ai/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  function undo(token, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;
    return fetch(`${baseUrl}/api/ai/undo`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;

    // authUser returns only the token; fetch full record to get user id.
    const res = await fetch(`${baseUrl}/api/collections/users/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "admin@hook-test.local", password: "Adminpass1!" }),
    });
    if (!res.ok) throw new Error(`Admin auth failed: ${res.status}`);
    const data = await res.json();
    adminToken = data.token;
    adminUserId = data.record.id;
  }, 60000);

  afterAll(stopPb);

  // ---- POST /api/ai/chat — auth gate ----

  it("chat: 401 when no Authorization header", async () => {
    const res = await chat(null, { message: "hello" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("auth required");
  });

  // ---- POST /api/ai/chat — input validation ----

  it("chat: 400 when message field is missing", async () => {
    const res = await chat(adminToken, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message is required");
  });

  it("chat: 400 when message is whitespace-only", async () => {
    const res = await chat(adminToken, { message: "   " });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message is required");
  });

  // ---- POST /api/ai/chat — fallback path (no ANTHROPIC_API_KEY) ----

  it("chat: 200 fallback reply when ANTHROPIC_API_KEY is not set", async () => {
    const res = await chat(adminToken, { message: "hello", sessionId: "test-session-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reply).toBe("string");
    expect(body.reply.startsWith("[AI unavailable")).toBe(true);
    expect(body.sessionId).toBe("test-session-1");
    expect(body.done).toBe(true);
    expect(Array.isArray(body.toolsUsed)).toBe(true);
    expect(body.toolsUsed.length).toBe(0);
  });

  it("chat: fallback reply echoes the original message text", async () => {
    const res = await chat(adminToken, { message: "hello", sessionId: "test-session-2" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply.includes("hello")).toBe(true);
  });

  it("chat: sessionId defaults to user id when omitted", async () => {
    const res = await chat(adminToken, { message: "hello" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe(adminUserId);
  });

  // ---- POST /api/ai/undo — auth gate ----

  it("undo: 401 when no Authorization header", async () => {
    const res = await undo(null, { undo_token: "some-token" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("auth required");
  });

  // ---- POST /api/ai/undo — input validation ----

  it("undo: 400 when undo_token is missing", async () => {
    const res = await undo(adminToken, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("undo_token is required");
  });

  it("undo: 400 expired when token is not in store", async () => {
    const res = await undo(adminToken, { undo_token: "nonexistent-token-12345" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("expired");
    expect(body.detail).toBe("Undo token not found or already used");
  });
});
