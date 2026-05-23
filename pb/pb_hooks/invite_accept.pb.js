/// <reference path="../pb_data/types.d.ts" />
// Invite link routes — no auth required (public endpoints).
//
// GET  /api/invite/preview/:token  → { role, expires_at } or error
// POST /api/invite/accept          → { token, email, name, password } → { token, record }
// POST /api/invite/create          → admin only → { url, invite_id }
//
// Token storage: server-side HMAC-SHA256 with static salt.
// Raw token only lives in the URL the admin copies — never stored.
//
// Security: when invite.email is set the accepter must supply the same email
// (case-insensitive). Legacy invites (email = null) allow any email.
//
// Phone: optional E.164 without '+' (e.g. 972527799932). When provided on create,
// stored on invite and auto-populated on accept. Optional WhatsApp delivery via
// Meta Cloud API — best-effort, never blocks invite creation.
//
// NOTE: PB v0.22 Goja isolation — all logic inlined inside each routerAdd callback.

// INVITE_SALT inlined per callback below — Goja isolation makes module-level var invisible inside routerAdd callbacks.

// ─────────────────────────────────────────
// POST /api/invite/create  (admin only)
// ─────────────────────────────────────────
routerAdd("POST", "/api/invite/create", function(c) {
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  var body = info.data || {};
  var role = (body.role || "").toString();
  var validRoles = { admin: true, technician: true, user: true, viewer: true };
  if (!validRoles[role]) {
    return c.json(400, { error: "role must be one of: admin, technician, user, viewer" });
  }

  // Optional email binding — stored lowercase for case-insensitive comparison on accept
  var inviteEmail = (body.email || "").toString().trim().toLowerCase();

  // Optional phone — E.164 without '+', e.g. 972527799932
  var invitePhone = (body.phone || "").toString().trim().replace(/\D/g, "");

  var sendViaWhatsapp = body.send_via_whatsapp === true;

  // Generate raw token (32 random bytes → hex string via $security)
  var raw = $security.randomString(43); // URL-safe random string

  // Hash with HMAC-SHA256
  var INVITE_SALT = "kit-tracker-invite-salt-v1";
  var hash = $security.hs256(raw, INVITE_SALT);

  // expires_at = now + 7 days
  var expiresAt = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  // PB date format: "YYYY-MM-DD HH:MM:SS.sss Z"
  expiresAt = expiresAt.replace("T", " ").replace("Z", "") + "Z";

  var dao = $app.dao();
  var invitesCol = dao.findCollectionByNameOrId("invites");
  var inv = new Record(invitesCol);
  inv.set("token_hash", hash);
  inv.set("created_by", info.authRecord.id);
  inv.set("role", role);
  inv.set("expires_at", expiresAt);
  if (inviteEmail) {
    inv.set("email", inviteEmail);
  }
  if (invitePhone) {
    inv.set("phone", invitePhone);
  }

  try {
    dao.saveRecord(inv);
  } catch(e) {
    return c.json(500, { error: "failed to create invite: " + String(e) });
  }

  // Build URL — derive base URL from request host
  var scheme = "https";
  var host = c.request().host;
  // In local dev host is 127.0.0.1:8090 — use http
  if (host.indexOf("127.0.0.1") !== -1 || host.indexOf("localhost") !== -1) {
    scheme = "http";
  }
  var url = scheme + "://" + host + "/invite/" + raw;

  // WhatsApp delivery — best-effort, never blocks invite creation
  var waSent = false;
  var waError = "";
  if (sendViaWhatsapp && invitePhone) {
    try {
      var waToken = $os.getenv("WHATSAPP_TOKEN");
      var waPhoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID");
      if (!waToken || !waPhoneNumberId) {
        waError = "WhatsApp env vars not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)";
      } else {
        var waBody = JSON.stringify({
          messaging_product: "whatsapp",
          to: invitePhone,
          type: "text",
          text: {
            body: "Hi! You've been invited to kit-tracker.\nTap to accept: " + url + "\nValid for 7 days."
          }
        });
        var waResp = $http.send({
          url: "https://graph.facebook.com/v19.0/" + waPhoneNumberId + "/messages",
          method: "POST",
          headers: {
            "Authorization": "Bearer " + waToken,
            "Content-Type": "application/json"
          },
          body: waBody,
          timeout: 10000
        });
        if (waResp.statusCode >= 200 && waResp.statusCode < 300) {
          waSent = true;
        } else {
          // NOTE: proactive messages outside 24h window require a pre-approved template.
          // If the recipient has not messaged the bot in the last 24h, Meta returns 131047.
          // Submit a template at https://business.facebook.com/wa/manage/message-templates/
          // and use a template message type instead of text for production proactive sends.
          waError = "WhatsApp API error: " + waResp.statusCode + " " + waResp.raw;
        }
      }
    } catch(waEx) {
      waError = "WhatsApp send exception: " + String(waEx);
    }
    if (waError) {
      console.error("[invite_accept] " + waError);
    }
  }

  return c.json(200, { url: url, invite_id: inv.id, expires_at: inv.getString("expires_at"), wa_sent: waSent, wa_error: waError || undefined });
});

// ─────────────────────────────────────────
// GET /api/invite/preview/:token
// ─────────────────────────────────────────
routerAdd("GET", "/api/invite/preview/:token", function(c) {
  var token = c.pathParam("token");
  if (!token) return c.json(400, { error: "missing token" });

  var INVITE_SALT = "kit-tracker-invite-salt-v1";
  var hash = $security.hs256(token, INVITE_SALT);
  var dao = $app.dao();
  var inv;
  try {
    inv = dao.findFirstRecordByFilter("invites", "token_hash = {:h}", { h: hash });
  } catch(_) {
    return c.json(400, { error: "Invalid invite link." });
  }

  var now = new Date().toISOString();
  if (inv.getString("revoked_at")) return c.json(410, { error: "This link was revoked." });
  if (inv.getString("used_at"))    return c.json(410, { error: "This link was already used." });
  if (inv.getString("expires_at") < now) {
    return c.json(410, { error: "This link expired on " + inv.getString("expires_at") });
  }

  // NOTE: intentionally NOT returning invite.email — preview is unauthenticated.
  // Exposing the target email to anyone with the token URL would re-introduce the
  // enumeration risk this feature is designed to prevent.
  return c.json(200, { role: inv.getString("role"), expires_at: inv.getString("expires_at") });
});

// ─────────────────────────────────────────
// POST /api/invite/accept
// ─────────────────────────────────────────
routerAdd("POST", "/api/invite/accept", function(c) {
  var info = $apis.requestInfo(c);
  var body = info.data || {};

  var token   = (body.token    || "").toString();
  var name    = (body.name     || "").toString().trim();
  var password = (body.password || "").toString();
  var email   = (body.email    || "").toString().trim().toLowerCase();
  // Optional phone provided by accepter — normalized to digits only (E.164 without '+')
  var bodyPhone = (body.phone  || "").toString().trim().replace(/\D/g, "");

  if (!token) return c.json(400, { error: "token required" });
  if (!email || email.indexOf("@") === -1) return c.json(400, { error: "valid email required" });
  if (password.length < 8) return c.json(400, { error: "password must be at least 8 characters" });

  var INVITE_SALT = "kit-tracker-invite-salt-v1";
  var hash = $security.hs256(token, INVITE_SALT);
  var dao = $app.dao();
  var inv;
  try {
    inv = dao.findFirstRecordByFilter("invites", "token_hash = {:h}", { h: hash });
  } catch(_) {
    return c.json(400, { error: "Invalid invite link." });
  }

  var now = new Date().toISOString();
  if (inv.getString("revoked_at")) return c.json(410, { error: "Link revoked." });
  if (inv.getString("used_at"))    return c.json(410, { error: "Link already used." });
  if (inv.getString("expires_at") < now) return c.json(410, { error: "Link expired." });

  // Email binding check — only enforced when invite has an email set (case-insensitive)
  var inviteEmail = inv.getString("email");
  if (inviteEmail && inviteEmail !== email) {
    return c.json(403, { error: "email does not match invite" });
  }

  // Phone binding check — defense-in-depth: if body.phone given, must match invite.phone
  var invitePhone = inv.getString("phone");
  if (bodyPhone && invitePhone && bodyPhone !== invitePhone) {
    return c.json(403, { error: "phone does not match invite" });
  }

  var role = inv.getString("role");

  // Check email collision
  var existing;
  try {
    existing = dao.findFirstRecordByFilter("users", "email = {:e}", { e: email });
  } catch(_) {}
  if (existing) {
    return c.json(409, { error: "You already have an account — please log in." });
  }

  // Create user
  var usersCol = dao.findCollectionByNameOrId("users");
  var user = new Record(usersCol);
  user.set("email", email);
  // username is a required system field on PB auth collections
  var emailLocal = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  user.set("username", emailLocal + "_" + $security.randomString(6).toLowerCase());
  user.set("name", name || email.split("@")[0]);
  user.set("role", role);
  user.set("emailVisibility", true);
  // Auto-populate phone: prefer invite phone, fall back to body phone
  var resolvedPhone = invitePhone || bodyPhone;
  if (resolvedPhone) {
    user.set("phone", resolvedPhone);
  }
  user.setPassword(password);

  try {
    dao.saveRecord(user);
  } catch(e) {
    return c.json(500, { error: "user create failed: " + String(e) });
  }

  // Mark invite used
  inv.set("used_at", now);
  inv.set("used_by", user.id);
  try { dao.saveRecord(inv); } catch(_) {} // soft-fail — invite is already consumed

  // Issue auth token
  try {
    var authToken = $tokens.recordAuthToken($app, user);
    return c.json(200, {
      token: authToken,
      record: {
        id: user.id,
        email: user.getString("email"),
        name: user.getString("name"),
        role: role,
      },
    });
  } catch(e) {
    return c.json(500, { error: "token gen failed: " + String(e) });
  }
});
