/// <reference path="../pb_data/types.d.ts" />
// POST /api/ai/chat — Phase 0 stub. Echoes user message. No Anthropic call yet.
//
// Rate limit: 60 messages per user per hour.
// Session store: keyed by userId, 1h TTL, max 50 messages per session.
//
// PB v0.22 Goja runs each handler in an isolated Runtime — module-level vars
// are not shared across requests. State lives in $app.store() (Go-side
// concurrent-safe map). Values JSON-stringified. Pattern mirrors
// pb/pb_hooks/auth_rate_limit.pb.js.
//
// Streaming: PB v0.22 Goja does not expose a reliable flush API for chunked
// SSE inside routerAdd. Phase 0 returns a single JSON response; frontend
// service is written to accept JSON-fallback. Phase 1 may move to SSE once
// the Anthropic call is wired and streaming actually buys us something.

routerAdd("POST", "/api/ai/chat", function(c) {
  try {
    var info = $apis.requestInfo(c);
    var auth = info.authRecord;
    if (!auth) {
      return c.json(401, { error: "auth required" });
    }
    var userId = auth.id;

    var RATE_WINDOW_MS = 60 * 60 * 1000;
    var RATE_MAX = 60;
    var SESSION_TTL_MS = 60 * 60 * 1000;
    var SESSION_MAX_MESSAGES = 50;
    var nowMs = Date.now();

    // --- Rate limit ---
    var rlKey = "ai_rl:" + userId;
    var rlRaw = $app.store().get(rlKey);
    var rl = null;
    if (rlRaw) { try { rl = JSON.parse(rlRaw); } catch (_) { rl = null; } }
    if (!rl || (nowMs - rl.windowStart) >= RATE_WINDOW_MS) {
      rl = { count: 0, windowStart: nowMs };
    }
    if (rl.count >= RATE_MAX) {
      var retryAfterSeconds = Math.ceil((RATE_WINDOW_MS - (nowMs - rl.windowStart)) / 1000);
      c.response().header().set("Retry-After", String(retryAfterSeconds));
      return c.json(429, { error: "rate_limit", retry_after_seconds: retryAfterSeconds });
    }
    rl.count++;
    $app.store().set(rlKey, JSON.stringify(rl));

    // --- Parse body ---
    var body = info.data || {};
    var message = body.message ? String(body.message).trim() : "";
    var sessionId = body.sessionId ? String(body.sessionId) : userId;

    if (!message) {
      return c.json(400, { error: "message is required" });
    }

    // --- Session store ---
    var sKey = "ai_session:" + sessionId;
    var sRaw = $app.store().get(sKey);
    var session = null;
    if (sRaw) { try { session = JSON.parse(sRaw); } catch (_) { session = null; } }
    if (!session || (nowMs - session.lastActivityMs) >= SESSION_TTL_MS) {
      session = { messages: [], lastActivityMs: nowMs };
    }
    session.lastActivityMs = nowMs;
    session.messages.push({ role: "user", content: message, ts: new Date(nowMs).toISOString() });

    // --- Echo stub (Phase 0) ---
    var reply = "You said: " + message + ". (AI not wired yet — Phase 1 pending key)";
    session.messages.push({ role: "assistant", content: reply, ts: new Date().toISOString() });
    if (session.messages.length > SESSION_MAX_MESSAGES) {
      session.messages = session.messages.slice(session.messages.length - SESSION_MAX_MESSAGES);
    }
    $app.store().set(sKey, JSON.stringify(session));

    return c.json(200, {
      reply: reply,
      sessionId: sessionId,
      done: true,
    });
  } catch (err) {
    console.log("[ai_chat] error: " + (err && err.message ? err.message : err));
    return c.json(500, { error: "internal", detail: String(err && err.message ? err.message : err) });
  }
});
