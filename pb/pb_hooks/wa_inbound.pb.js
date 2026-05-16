/// <reference path="../pb_data/types.d.ts" />
// POST /api/wa/webhook — Twilio WhatsApp inbound webhook (Phase A).
//
// Reuses the existing /api/ai/chat endpoint by minting a short-lived auth
// token for the user matched by phone number. No new tool surface — same
// 20 tools as ai_chat / ai_mcp.
//
// Phase A scope: inbound Q&A. Read-only AI loop (write tools still gated by
// role inside ai_chat). Signature verification (Twilio HMAC-SHA1) deferred
// to Phase B/C — PB v0.22 Goja exposes hs256/hs512 but NOT hs1. Sandbox
// path is dev-only; phone-match acts as soft auth.
//
// Environment:
//   TWILIO_ACCOUNT_SID   — for outbound API URL
//   TWILIO_BASIC_AUTH    — pre-computed base64("SID:AUTH_TOKEN") (Goja has no btoa)
//   TWILIO_WA_FROM       — "whatsapp:+14155238886" sandbox sender
//
// Inbound payload (form-urlencoded):
//   From=whatsapp%3A%2B972527799932
//   Body=where+is+DEMO-KIT-005
//   MessageSid=SMxxxxx (idempotency key — TODO)
//
// All logic inlined per PB v0.22 Goja runtime isolation.

routerAdd("POST", "/api/wa/webhook", function(c) {
  // --- Parse form body ---
  var from = "";
  var body = "";
  try {
    from = c.request().formValue("From") || "";
    body = c.request().formValue("Body") || "";
  } catch (e) {
    console.log("[wa_inbound] form parse error: " + e);
    return c.string(200, "");
  }

  console.log("[wa_inbound] inbound from=" + from + " body=" + (body || "").slice(0, 80));

  if (!from || !body) {
    console.log("[wa_inbound] missing From or Body");
    return c.string(200, "");
  }

  // Strip "whatsapp:" prefix
  var phone = from;
  if (phone.indexOf("whatsapp:") === 0) {
    phone = phone.substring("whatsapp:".length);
  }

  // --- Look up user by phone ---
  var user = null;
  try {
    var matches = $app.dao().findRecordsByFilter(
      "users",
      "phone = {:phone}",
      "",
      1,
      0,
      { phone: phone }
    );
    if (matches && matches.length > 0) user = matches[0];
  } catch (e) {
    console.log("[wa_inbound] user lookup error: " + e);
  }

  if (!user) {
    console.log("[wa_inbound] no user found for phone=" + phone);
    return replyViaTwilio(phone, "Unknown number. Ask an admin to add your phone to your user profile.");
  }

  // Reject if role is empty or denied — gate inbound at transport layer.
  var role = user.getString("role");
  if (!role || role === "denied") {
    console.log("[wa_inbound] user " + user.id + " role=" + role + " — rejected");
    return replyViaTwilio(phone, "Your account isn't approved for WhatsApp access yet.");
  }

  // --- Mint internal auth token + call /api/ai/chat ---
  var token = "";
  try {
    token = $tokens.recordAuthToken($app, user);
  } catch (e) {
    console.log("[wa_inbound] token mint error: " + e);
    return replyViaTwilio(phone, "Internal error (auth). Try again.");
  }

  var aiRes;
  try {
    aiRes = $http.send({
      method: "POST",
      url: "http://127.0.0.1:8090/api/ai/chat",
      body: JSON.stringify({ message: body, sessionId: "wa:" + user.id }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      timeout: 30000
    });
  } catch (e) {
    console.log("[wa_inbound] /api/ai/chat HTTP error: " + e);
    return replyViaTwilio(phone, "Internal error talking to AI. Try again.");
  }

  if (aiRes.statusCode !== 200) {
    console.log("[wa_inbound] /api/ai/chat returned " + aiRes.statusCode + ": " + aiRes.raw);
    return replyViaTwilio(phone, "AI error (" + aiRes.statusCode + "). Try again.");
  }

  var reply = "(no reply)";
  try {
    var parsed = JSON.parse(aiRes.raw);
    if (parsed && parsed.reply) reply = String(parsed.reply);
  } catch (e) {
    console.log("[wa_inbound] reply parse error: " + e);
  }

  // Cap reply length (WhatsApp 1600 char limit per message).
  if (reply.length > 1500) reply = reply.slice(0, 1490) + " […]";

  return replyViaTwilio(phone, reply);

  // ===== Twilio outbound helper (defined inside callback per Goja isolation) =====
  function replyViaTwilio(toPhone, text) {
    var sid = $os.getenv("TWILIO_ACCOUNT_SID") || "";
    var basicAuthB64 = $os.getenv("TWILIO_BASIC_AUTH") || "";
    var waFrom = $os.getenv("TWILIO_WA_FROM") || "";

    if (!sid || !basicAuthB64 || !waFrom) {
      console.log("[wa_inbound] TWILIO_* env missing — cannot send outbound");
      return c.string(200, "");
    }

    var url = "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json";
    var basicAuth = "Basic " + basicAuthB64;

    var formBody = "From=" + encodeURIComponent(waFrom) +
                   "&To=" + encodeURIComponent("whatsapp:" + toPhone) +
                   "&Body=" + encodeURIComponent(text);

    try {
      var res = $http.send({
        method: "POST",
        url: url,
        body: formBody,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": basicAuth
        },
        timeout: 10000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.log("[wa_inbound] Twilio send failed " + res.statusCode + ": " + res.raw);
      } else {
        console.log("[wa_inbound] sent reply to " + toPhone);
      }
    } catch (e) {
      console.log("[wa_inbound] Twilio HTTP error: " + e);
    }

    return c.string(200, "");
  }
});
