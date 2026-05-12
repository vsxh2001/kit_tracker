/// <reference path="../pb_data/types.d.ts" />
// In-memory rate limit per IP for auth-with-password.
// 10 failed attempts in 5 minutes → 15 minute block.
// Successful auth resets counter.
//
// All values inlined per-handler: PB v0.22 hook pool runs each hook
// invocation in an isolated goja.Runtime — module-level vars are not shared.
// State shared via $app.store() (Go-side concurrent-safe map).
//
// Store key: "rl:<ip>"
// Store value (JSON string): { count, firstAtMs, blockedUntilMs }

// Before auth: check if IP is currently blocked.
onRecordBeforeAuthWithPasswordRequest((e) => {
  const ip = e.httpContext.realIP() || "unknown";
  const raw = $app.store().get("rl:" + ip);
  if (!raw) return;
  let entry;
  try { entry = JSON.parse(raw); } catch (_) { return; }
  const now = Date.now();
  if (entry.blockedUntilMs && entry.blockedUntilMs > now) {
    const remaining = Math.ceil((entry.blockedUntilMs - now) / 1000);
    throw new BadRequestError("Too many failed login attempts. Try again in " + remaining + " seconds.");
  }
  if (now - entry.firstAtMs > 5 * 60 * 1000) {
    $app.store().remove("rl:" + ip);
  }
}, "users");

// After successful auth: clear the failure counter for this IP.
onRecordAfterAuthWithPasswordRequest((e) => {
  const ip = e.httpContext.realIP() || "unknown";
  $app.store().remove("rl:" + ip);
}, "users");

// After any auth error: increment failure counter for this IP.
onAfterApiError((e) => {
  const req = e.httpContext.request();
  if (!req || req.method !== "POST") return;
  if (!req.url || !req.url.path) return;
  if (!req.url.path.includes("/api/collections/users/auth-with-password")) return;
  const err = e.error;
  if (!err || (err.code !== 400 && err.code !== 404)) return;

  const ip = e.httpContext.realIP() || "unknown";
  const now = Date.now();
  const storeKey = "rl:" + ip;
  const WINDOW_MS = 5 * 60 * 1000;
  const MAX_ATTEMPTS = 10;
  const BLOCK_MS = 15 * 60 * 1000;

  let entry;
  const raw = $app.store().get(storeKey);
  try { entry = raw ? JSON.parse(raw) : null; } catch (_) { entry = null; }
  if (!entry) { entry = { count: 0, firstAtMs: now, blockedUntilMs: 0 }; }

  if (now - entry.firstAtMs > WINDOW_MS) {
    entry.count = 0;
    entry.firstAtMs = now;
    entry.blockedUntilMs = 0;
  }

  entry.count = entry.count + 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntilMs = now + BLOCK_MS;
    console.log("[auth_rate_limit] blocked ip=" + ip + " count=" + entry.count + " for " + (BLOCK_MS / 1000) + "s");
  }

  $app.store().set(storeKey, JSON.stringify(entry));
  console.log("[auth_rate_limit] fail ip=" + ip + " count=" + entry.count);
});
