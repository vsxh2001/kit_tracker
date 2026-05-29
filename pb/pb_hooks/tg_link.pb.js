/// <reference path="../pb_data/types.d.ts" />
// POST /api/tg/link/code — Mint a one-time Telegram link code for the authenticated user.
//
// Any logged-in user calls this to receive a short-lived code they can DM to the
// Telegram bot via /start <code>. On redeem the bot sets telegram_chat_id on their
// user record (handled by tg_webhook.pb.js).
//
// Security:
//   - 128-bit entropy (32 hex chars via $security.randomStringWithAlphabet).
//   - 10-minute TTL, single-use, stored in tg_link_codes (rules: all null — DAO only).
//   - Prior unused codes for the same user are invalidated before minting a new one.
//   - Code is a bearer credential: whoever redeems it from their Telegram chat gets
//     their chat_id bound to this user. Keep it secret and short-lived.
//   - The full code is never logged.
//
// Response:
//   { code, expires_at, instructions, deep_link? }
//
// Environment (optional):
//   TELEGRAM_BOT_USERNAME — if set, deep_link = "https://t.me/<username>?start=<code>"
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("POST", "/api/tg/link/code", function(c) {

  // ===========================================================================
  // Auth — any authenticated user mints a code for THEIR OWN account
  // ===========================================================================
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord) {
    return c.json(401, { error: "auth required" });
  }

  var uid = info.authRecord.id;
  var dao = $app.dao();

  // ===========================================================================
  // Invalidate prior unused codes for this user (defensive — one live code max)
  // ===========================================================================
  try {
    var priorCodes = dao.findRecordsByFilter(
      "tg_link_codes",
      "user = {:uid} && used = false",
      "",
      100,
      0,
      { uid: uid }
    );
    for (var i = 0; i < priorCodes.length; i++) {
      try {
        dao.deleteRecord(priorCodes[i]);
      } catch (delErr) {
        console.log("[tg_link] failed to delete prior code: " + delErr);
      }
    }
  } catch (findErr) {
    console.log("[tg_link] prior-code lookup error: " + findErr);
  }

  // ===========================================================================
  // Generate 128-bit code (32 hex chars) via $security.randomStringWithAlphabet
  // Mirroring invite_accept.pb.js which uses $security.randomString for tokens.
  // ===========================================================================
  var code = $security.randomStringWithAlphabet(32, "0123456789abcdef");

  // ===========================================================================
  // TTL: now + 10 minutes, PB date format "YYYY-MM-DD HH:MM:SS.sssZ"
  // ===========================================================================
  var expiresAt = new Date(new Date().getTime() + 10 * 60 * 1000).toISOString();
  expiresAt = expiresAt.replace("T", " ").replace("Z", "") + "Z";

  // ===========================================================================
  // Create tg_link_codes row via DAO (collection rules are null — DAO only)
  // ===========================================================================
  var col;
  try {
    col = dao.findCollectionByNameOrId("tg_link_codes");
  } catch (e) {
    console.log("[tg_link] tg_link_codes collection not found: " + e);
    return c.json(500, { error: "tg_link_codes collection not available" });
  }

  var rec = new Record(col);
  rec.set("code", code);
  rec.set("user", uid);
  rec.set("expires_at", expiresAt);
  rec.set("used", false);

  try {
    dao.saveRecord(rec);
  } catch (e) {
    console.log("[tg_link] saveRecord error: " + e);
    return c.json(500, { error: "failed to create link code" });
  }

  console.log("[tg_link] minted code for user=" + uid + " expires=" + expiresAt);

  // ===========================================================================
  // Build response — deep_link if bot username is configured
  // ===========================================================================
  var botUsername = $os.getenv("TELEGRAM_BOT_USERNAME") || "";
  var response = {
    code: code,
    expires_at: expiresAt,
  };

  if (botUsername) {
    response.deep_link = "https://t.me/" + botUsername + "?start=" + code;
    response.instructions = "Tap the link or DM the bot and send: /start " + code;
  } else {
    response.instructions = "DM the bot and send: /start " + code;
  }

  return c.json(200, response);
});
