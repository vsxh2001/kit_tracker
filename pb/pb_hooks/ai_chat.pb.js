/// <reference path="../pb_data/types.d.ts" />
// POST /api/ai/chat — Phase 0 stub. Echoes user message. No Anthropic call yet.
//
// Rate limit: 60 messages per user per hour (in-process Map, resets on PB restart).
// Session store: in-process Map keyed by userId, 1h TTL, max 50 messages per session.
//
// Streaming: PB v0.22 Goja runtime does not expose a reliable flush API for
// chunked SSE within routerAdd callbacks. This Phase 0 implementation returns a
// single JSON response instead of SSE. Phase 1 will add true SSE once the
// Anthropic API is wired and we can validate streaming end-to-end with the key.
// The frontend service is written to accept both SSE and JSON-fallback responses.
//
// In-process state — Goja runtime, single PB process on Fly (no cross-process concern).

var SESSIONS = new Map();   // userId -> { messages: [{role, content, ts}], lastActivity: Date }
var RATE_LIMIT = new Map(); // userId -> { count: N, windowStart: Date }
var RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
var RATE_MAX = 60;
var SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
var SESSION_MAX_MESSAGES = 50;

routerAdd("POST", "/api/ai/chat", function(c) {
  var info = $apis.requestInfo(c);
  var auth = info.authRecord;
  if (!auth) {
    return c.json(401, { error: "auth required" });
  }
  var userId = auth.id;

  // --- Rate limit ---
  var now = new Date();
  var rl = RATE_LIMIT.get(userId);
  if (!rl || (now - rl.windowStart) >= RATE_WINDOW_MS) {
    rl = { count: 0, windowStart: now };
  }
  if (rl.count >= RATE_MAX) {
    var windowElapsedMs = now - rl.windowStart;
    var retryAfterSeconds = Math.ceil((RATE_WINDOW_MS - windowElapsedMs) / 1000);
    c.response().header().set("Retry-After", String(retryAfterSeconds));
    return c.json(429, { error: "rate_limit", retry_after_seconds: retryAfterSeconds });
  }
  rl.count++;
  RATE_LIMIT.set(userId, rl);

  // --- Parse body ---
  var body = info.data;
  var message = body && body.message ? String(body.message).trim() : "";
  var sessionId = body && body.sessionId ? String(body.sessionId) : userId;

  if (!message) {
    return c.json(400, { error: "message is required" });
  }

  // --- Session store ---
  var session = SESSIONS.get(sessionId);
  if (!session || (now - session.lastActivity) >= SESSION_TTL_MS) {
    session = { messages: [], lastActivity: now };
  }
  session.lastActivity = now;
  session.messages.push({ role: "user", content: message, ts: now.toISOString() });
  // Trim oldest messages
  if (session.messages.length > SESSION_MAX_MESSAGES) {
    session.messages = session.messages.slice(session.messages.length - SESSION_MAX_MESSAGES);
  }

  // --- Echo stub (Phase 0) ---
  var reply = "You said: " + message + ". (AI not wired yet — Phase 1 pending key)";

  session.messages.push({ role: "assistant", content: reply, ts: new Date().toISOString() });
  SESSIONS.set(sessionId, session);

  return c.json(200, {
    reply: reply,
    sessionId: sessionId,
    done: true,
  });
});
