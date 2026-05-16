/// <reference path="../pb_data/types.d.ts" />
// POST /api/wa/webhook — Twilio WhatsApp inbound webhook (Phase B).
//
// Phase A: basic inbound → /api/ai/chat → Twilio reply.
// Phase B adds:
//   1. Confirmation flow — write-tool responses require YES within 30s.
//   2. Multi-message replies — split at 1500-char paragraph boundary with (N/M) suffix.
//   3. WA-friendly formatting — strip markdown headers, convert **bold** → *bold*, strip code blocks.
//   4. HMAC-SHA1 signature verification (manual JS impl; Goja has no hs1).
//
// Environment:
//   TWILIO_ACCOUNT_SID   — for outbound API URL
//   TWILIO_BASIC_AUTH    — pre-computed base64("SID:AUTH_TOKEN") (Goja has no btoa)
//   TWILIO_AUTH_TOKEN    — raw auth token, for HMAC-SHA1 signature verification
//   TWILIO_WA_FROM       — "whatsapp:+14155238886" sandbox sender
//   APP_BASE_URL         — canonical HTTPS URL (e.g. "https://kit-tracker.fly.dev")
//                          If unset, falls back to host header (for ngrok/local dev).
//   WA_SKIP_SIGNATURE_CHECK=1 — bypass HMAC verification via ENV VAR ONLY (ngrok/local dev).
//                               Header-based bypass was removed (security: any caller could set it).
//
// $app.store() keys:
//   wa_pending:<phone>  — JSON { messageText, expiresAtMs } (30s TTL, cleared on YES/cancel)
//   wa_rate:<phone>     — JSON { count, windowStartMs } (1h sliding window, max 30 msgs/hr)
//
// All logic inlined per PB v0.22 Goja runtime isolation (no cross-function scope).

routerAdd("POST", "/api/wa/webhook", function(c) {

  // =====================================================================
  // INLINE HELPERS (must be inside callback — Goja isolation)
  // =====================================================================

  // --- SHA-1 (pure JS, RFC 3174) ---
  // Takes a byte array (Array of ints 0-255), returns 5-element word array.
  function sha1Bytes(bytesIn) {
    function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
    var h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    var bytes = bytesIn.slice();
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // Append length as 64-bit big-endian (only handle < 2^32 bits — fine for webhooks)
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
    for (var chunk = 0; chunk < bytes.length; chunk += 64) {
      var w = [];
      for (var j = 0; j < 16; j++) {
        w[j] = (bytes[chunk + j * 4] << 24) | (bytes[chunk + j * 4 + 1] << 16) |
                (bytes[chunk + j * 4 + 2] << 8) | bytes[chunk + j * 4 + 3];
      }
      for (var j = 16; j < 80; j++) w[j] = rotl(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
      var a = h[0], b = h[1], cc = h[2], d = h[3], e = h[4];
      for (var j = 0; j < 80; j++) {
        var f, k;
        if      (j < 20) { f = (b & cc) | ((~b) & d); k = 0x5A827999; }
        else if (j < 40) { f = b ^ cc ^ d;             k = 0x6ED9EBA1; }
        else if (j < 60) { f = (b & cc) | (b & d) | (cc & d); k = 0x8F1BBCDC; }
        else             { f = b ^ cc ^ d;             k = 0xCA62C1D6; }
        var t = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
        e = d; d = cc; cc = rotl(b, 30); b = a; a = t;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + cc) >>> 0;
      h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
    }
    return h;
  }

  // Convert string to UTF-8 byte array
  function strToUtf8Bytes(s) {
    var b = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) b.push(c);
      else if (c < 2048) { b.push((c >> 6) | 192); b.push((c & 63) | 128); }
      else { b.push((c >> 12) | 224); b.push(((c >> 6) & 63) | 128); b.push((c & 63) | 128); }
    }
    return b;
  }

  // Convert word array to byte array
  function wordsToBytes(words) {
    var out = [];
    for (var i = 0; i < words.length; i++) {
      out.push((words[i] >>> 24) & 0xff, (words[i] >>> 16) & 0xff,
               (words[i] >>> 8) & 0xff, words[i] & 0xff);
    }
    return out;
  }

  // Base64 encode byte array
  function b64Encode(bytes) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
      result += chars[b0 >> 2];
      result += chars[((b0 & 3) << 4) | (b1 >> 4)];
      result += i + 1 < bytes.length ? chars[((b1 & 0xf) << 2) | (b2 >> 6)] : "=";
      result += i + 2 < bytes.length ? chars[b2 & 0x3f] : "=";
    }
    return result;
  }

  // HMAC-SHA1, returns base64 string
  function hmacSha1Base64(keyStr, msgStr) {
    var BLOCK = 64;
    var keyBytes = strToUtf8Bytes(keyStr);
    if (keyBytes.length > BLOCK) keyBytes = wordsToBytes(sha1Bytes(keyBytes));
    while (keyBytes.length < BLOCK) keyBytes.push(0);
    var opad = keyBytes.map(function(b) { return b ^ 0x5C; });
    var ipad = keyBytes.map(function(b) { return b ^ 0x36; });
    var msgBytes = strToUtf8Bytes(msgStr);
    var innerHash = wordsToBytes(sha1Bytes(ipad.concat(msgBytes)));
    var outerHash = wordsToBytes(sha1Bytes(opad.concat(innerHash)));
    return b64Encode(outerHash);
  }

  // Constant-time string comparison (avoid timing attack on signatures)
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    var la = strToUtf8Bytes(a);
    var lb = strToUtf8Bytes(b);
    // Pad to same length (both are base64 of same-length digest so should be equal;
    // but we XOR them all to avoid early exit)
    var maxLen = Math.max(la.length, lb.length);
    var result = la.length ^ lb.length; // non-zero if lengths differ
    for (var i = 0; i < maxLen; i++) {
      result |= (la[i] || 0) ^ (lb[i] || 0);
    }
    return result === 0;
  }

  // --- WA-friendly text formatting ---
  function formatForWA(text) {
    var lines = text.split("\n");
    var out = [];
    var inCodeBlock = false;
    var codeLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Toggle code block state
      if (line.indexOf("```") === 0 || line.match(/^```/)) {
        if (inCodeBlock) {
          // End of code block — emit collected lines as plain quote
          if (codeLines.length > 0) {
            out.push("> " + codeLines.join(" | "));
          }
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }
      // Strip markdown headers (# ## ###)
      line = line.replace(/^#{1,6}\s+/, "");
      // Convert **bold** → *bold* (WA bold)
      line = line.replace(/\*\*([^*]+)\*\*/g, "*$1*");
      // Convert __bold__ → *bold*
      line = line.replace(/__([^_]+)__/g, "*$1*");
      out.push(line);
    }
    // If code block wasn't closed, flush it
    if (inCodeBlock && codeLines.length > 0) {
      out.push("> " + codeLines.join(" | "));
    }
    return out.join("\n");
  }

  // --- Split text into chunks ≤ 1500 chars, prefer paragraph breaks ---
  function splitChunks(text) {
    var MAX = 1500;
    if (text.length <= MAX) return [text];
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      // Try to split at last paragraph break (double newline) before MAX
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) { breakAt = dbl + 2; }
      else {
        // Fall back to last single newline
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) { breakAt = nl + 1; }
        else {
          // Fall back to last space
          var sp = remaining.lastIndexOf(" ", MAX);
          if (sp > 0) { breakAt = sp + 1; }
          else { breakAt = MAX; }
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());
    return chunks;
  }

  // --- Twilio outbound helper ---
  function sendViaTwilio(toPhone, text) {
    var sid = $os.getenv("TWILIO_ACCOUNT_SID") || "";
    var basicAuthB64 = $os.getenv("TWILIO_BASIC_AUTH") || "";
    var waFrom = $os.getenv("TWILIO_WA_FROM") || "";

    if (!sid || !basicAuthB64 || !waFrom) {
      console.log("[wa_inbound] TWILIO_* env missing — cannot send outbound");
      return;
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
        console.log("[wa_inbound] sent msg to " + toPhone);
      }
    } catch (e) {
      console.log("[wa_inbound] Twilio HTTP error: " + e);
    }
  }

  // --- Send multi-chunk reply (with (N/M) suffix if multi-part) ---
  function replyViaTwilio(toPhone, text) {
    var formatted = formatForWA(text);
    var chunks = splitChunks(formatted);
    var total = chunks.length;
    for (var i = 0; i < chunks.length; i++) {
      var msg = total > 1 ? chunks[i] + "\n(" + (i + 1) + "/" + total + ")" : chunks[i];
      sendViaTwilio(toPhone, msg);
      console.log("[wa_inbound] sent reply chunk " + (i + 1) + "/" + total + " to " + toPhone);
    }
    return c.string(200, "");
  }

  // Write tools — detection set (must match CLAUDE.md list)
  var WRITE_TOOLS = {
    create_entity: true, create_kit: true, move_kit: true,
    create_product: true, create_component: true, move_component: true,
    decide_request: true, link_component_to_product: true,
    update_entity: true, update_kit: true, update_product: true
  };

  // Detect if an AI response involved a write-tool call
  // ai_chat returns { reply, toolsUsed: [...tool names...] } — check that field
  function detectWriteTool(parsed) {
    if (!parsed) return null;
    var toolsUsed = parsed.toolsUsed || parsed.tools_used || parsed.toolsCalled || [];
    if (!Array.isArray(toolsUsed)) return null;
    for (var i = 0; i < toolsUsed.length; i++) {
      if (WRITE_TOOLS[toolsUsed[i]]) return toolsUsed[i];
    }
    // Also check confirmation_required field
    if (parsed.confirmation_required === true) return "write";
    return null;
  }

  // =====================================================================
  // ENHANCEMENT 4 — HMAC-SHA1 signature verification
  // =====================================================================
  // Bypass only via env var — header bypass removed (P0 security fix: any external
  // caller could set WA_SKIP_SIGNATURE_CHECK: 1 header to skip verification entirely).
  var skipSig = $os.getenv("WA_SKIP_SIGNATURE_CHECK") === "1";

  if (!skipSig) {
    var authToken = $os.getenv("TWILIO_AUTH_TOKEN") || "";
    if (!authToken) {
      console.log("[wa_inbound] TWILIO_AUTH_TOKEN not set — cannot verify signature");
      return c.string(401, "");
    }

    var twilioSig = c.request().header.get("X-Twilio-Signature") || "";
    if (!twilioSig) {
      console.log("[wa_inbound] missing X-Twilio-Signature");
      return c.string(401, "");
    }

    // Build the URL Twilio signed
    var appBaseUrl = $os.getenv("APP_BASE_URL") || "";
    var webhookUrl;
    if (appBaseUrl) {
      webhookUrl = appBaseUrl.replace(/\/$/, "") + "/api/wa/webhook";
    } else {
      var host = c.request().host || c.request().header.get("Host") || "";
      webhookUrl = "https://" + host + "/api/wa/webhook";
    }

    // Parse all form fields for signature base string
    // c.request().form is a Go url.Values — we need to iterate via formValue
    // Build sorted param list from known Twilio fields + any others present
    var allFormKeys = [];
    try {
      // PB v0.22 exposes c.request().form as a parsed form — we can get all keys
      // via parseForm. We iterate known Twilio fields + extras via a combined approach.
      // Safe fallback: enumerate likely Twilio form field names
      var knownTwilioKeys = [
        "AccountSid","ApiVersion","Body","From","FromCity","FromCountry","FromState","FromZip",
        "MessageSid","MessageStatus","MessagingServiceSid","NumMedia","NumSegments",
        "ProfileName","SmsSid","SmsStatus","To","ToCity","ToCountry","ToState","ToZip",
        "WaId","SmsMessageSid","ReferralNumMedia","ButtonText","ButtonPayload",
        "OriginalRepliedMessageSid","OriginalRepliedMessageSender"
      ];
      // Collect present keys
      var presentParams = {};
      for (var ki = 0; ki < knownTwilioKeys.length; ki++) {
        var kv = c.request().formValue(knownTwilioKeys[ki]);
        if (kv !== "") presentParams[knownTwilioKeys[ki]] = kv;
      }
      allFormKeys = Object.keys(presentParams).sort();
      // Build base string
      var sigBase = webhookUrl;
      for (var ki = 0; ki < allFormKeys.length; ki++) {
        sigBase += allFormKeys[ki] + presentParams[allFormKeys[ki]];
      }
      var computed = hmacSha1Base64(authToken, sigBase);
      if (!safeEqual(computed, twilioSig)) {
        // P1: do NOT log computed value (would help attacker verify forgery attempts)
        console.log("[wa_inbound] signature mismatch from " + (c.request().header.get("X-Forwarded-For") || "unknown"));
        return c.string(401, "");
      }
      console.log("[wa_inbound] signature OK");
    } catch (e) {
      console.log("[wa_inbound] signature check error: " + e);
      return c.string(401, "");
    }
  } else {
    console.log("[wa_inbound] signature check skipped (WA_SKIP_SIGNATURE_CHECK=1)");
  }

  // =====================================================================
  // Parse inbound form fields
  // =====================================================================
  var from = "";
  var body = "";
  var msgSid = "";
  try {
    from = c.request().formValue("From") || "";
    body = c.request().formValue("Body") || "";
    msgSid = c.request().formValue("MessageSid") || "";
  } catch (e) {
    console.log("[wa_inbound] form parse error: " + e);
    return c.string(200, "");
  }

  console.log("[wa_inbound] inbound from=" + from + " sid=" + msgSid + " body=" + (body || "").slice(0, 80));

  if (!from || !body) {
    console.log("[wa_inbound] missing From or Body");
    return c.string(200, "");
  }

  // --- MessageSid idempotency (Twilio retries on 5xx/timeout) ---
  // Cache seen SIDs for 1h. If already processed, ack 200 silently.
  if (msgSid) {
    var seenKey = "wa_seen:" + msgSid;
    var alreadySeen = false;
    try { alreadySeen = !!$app.store().get(seenKey); } catch (e) {}
    if (alreadySeen) {
      console.log("[wa_inbound] duplicate MessageSid " + msgSid + " — skipping");
      return c.string(200, "");
    }
    try { $app.store().set(seenKey, String(Date.now() + 3600000)); } catch (e) {}
  }

  // Strip "whatsapp:" prefix
  var phone = from;
  if (phone.indexOf("whatsapp:") === 0) phone = phone.substring("whatsapp:".length);

  // =====================================================================
  // P0: Per-phone rate limit — max 30 messages per phone per hour
  // Uses $app.store() (Go-side concurrent-safe). Window resets after 1h.
  // Silent 200 on excess — don't reveal limit to attacker.
  // =====================================================================
  var RATE_WINDOW_MS = 3600000; // 1 hour
  var RATE_MAX = 30;
  var rateKey = "wa_rate:" + phone;
  var rateRaw = null;
  try { rateRaw = $app.store().get(rateKey); } catch (e) {}
  var rateEntry = { count: 0, windowStartMs: Date.now() };
  if (rateRaw) {
    try {
      var rp = JSON.parse(rateRaw);
      if (rp && rp.windowStartMs && (Date.now() - rp.windowStartMs) <= RATE_WINDOW_MS) {
        rateEntry = rp;
      }
      // else: window expired — reset (rateEntry already defaulted above)
    } catch (e) { /* corrupt entry — reset */ }
  }
  rateEntry.count = (rateEntry.count || 0) + 1;
  if (rateEntry.count > RATE_MAX) {
    console.log("[wa_inbound] rate limit hit for " + phone + " (" + rateEntry.count + " msgs in window)");
    try { $app.store().set(rateKey, JSON.stringify(rateEntry)); } catch (e) {}
    return c.string(200, ""); // silent — don't reveal limit
  }
  try { $app.store().set(rateKey, JSON.stringify(rateEntry)); } catch (e) {}

  // =====================================================================
  // Look up user by phone
  // =====================================================================
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

  var role = user.getString("role");
  if (!role || role === "denied") {
    console.log("[wa_inbound] user " + user.id + " role=" + role + " — rejected");
    return replyViaTwilio(phone, "Your account isn't approved for WhatsApp access yet.");
  }

  // =====================================================================
  // ENHANCEMENT 1 — Confirmation flow
  // =====================================================================
  var pendingKey = "wa_pending:" + phone;
  var bodyTrimmed = body.trim();

  // Check if there's a pending confirmation for this phone
  var pendingRaw = null;
  try { pendingRaw = $app.store().get(pendingKey); } catch (e) {}

  var pending = null;
  if (pendingRaw) {
    try {
      var p = JSON.parse(pendingRaw);
      if (p && p.expiresAtMs && Date.now() < p.expiresAtMs) {
        pending = p;
      } else {
        // Expired — clear it
        try { $app.store().remove(pendingKey); } catch (e) {}
        console.log("[wa_inbound] pending confirmation expired for " + phone);
      }
    } catch (e) {
      try { $app.store().remove(pendingKey); } catch (e2) {}
    }
  }

  if (pending) {
    // User has a pending confirmation
    if (bodyTrimmed.toLowerCase() === "yes") {
      // Confirmed — re-send the original message to /api/ai/chat
      console.log("[wa_inbound] YES received — re-executing: " + pending.messageText.slice(0, 80));
      try { $app.store().remove(pendingKey); } catch (e) {}

      // Mint token
      var token2 = "";
      try {
        token2 = $tokens.recordAuthToken($app, user);
      } catch (e) {
        console.log("[wa_inbound] token mint error: " + e);
        return replyViaTwilio(phone, "Internal error (auth). Try again.");
      }

      var aiRes2;
      try {
        // Re-send the original message; the AI should execute since it already resolved intent.
        // We append "CONFIRM: " prefix to make the instruction more imperative.
        var confirmedMsg = "CONFIRM AND EXECUTE: " + pending.messageText;
        aiRes2 = $http.send({
          method: "POST",
          url: "http://127.0.0.1:8090/api/ai/chat",
          body: JSON.stringify({ message: confirmedMsg, sessionId: "wa:" + user.id }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": token2
          },
          timeout: 30000
        });
      } catch (e) {
        console.log("[wa_inbound] /api/ai/chat HTTP error (confirm): " + e);
        return replyViaTwilio(phone, "Internal error talking to AI. Try again.");
      }

      var reply2 = "(no reply)";
      if (aiRes2 && aiRes2.statusCode === 200) {
        try {
          var parsed2 = JSON.parse(aiRes2.raw);
          if (parsed2 && parsed2.reply) reply2 = String(parsed2.reply);
        } catch (e) {
          console.log("[wa_inbound] reply parse error (confirm): " + e);
        }
      } else if (aiRes2) {
        console.log("[wa_inbound] /api/ai/chat returned " + aiRes2.statusCode + " (confirm)");
        reply2 = "AI error (" + aiRes2.statusCode + "). Try again.";
      }

      return replyViaTwilio(phone, reply2);
    } else {
      // User replied something other than YES — cancel and process as new message
      console.log("[wa_inbound] pending confirmation cancelled for " + phone);
      try { $app.store().remove(pendingKey); } catch (e) {}
      // Fall through to normal processing below
    }
  }

  // =====================================================================
  // Normal flow — mint token + call /api/ai/chat
  // =====================================================================
  // --- Pre-flight write-intent detection (Phase B confirmation flow) ---
  // We can't rely on POST-hoc detection because by then the AI has already
  // executed the write. Use lexical keyword match on the inbound body: if it
  // looks like a write command, stash pending + send confirmation prompt
  // WITHOUT calling /api/ai/chat. The actual execution happens on the YES
  // reply (re-entry via the pendingKey branch above).
  //
  // P1 fix: dropped ^\s* anchor — now matches write verbs ANYWHERE in body so
  // Hebrew/Arabic/emoji prefixes (e.g. "🔄 move kit X", "תעביר...") are caught.
  // Trade-off: "tell me where it moved" triggers confirm — acceptable false positive.
  var writeVerbs = /\b(move|create|add|new|make|delete|deactivate|remove|update|change|set|edit|approve|reject|fulfill|rename|reassign|transfer|put|send|cancel)\b/i;
  if (writeVerbs.test(body)) {
    var pendingEntry0 = JSON.stringify({
      messageText: body,
      expiresAtMs: Date.now() + 30000
    });
    try {
      $app.store().set(pendingKey, pendingEntry0);
    } catch (e) {
      console.log("[wa_inbound] failed to set pending store (pre-flight): " + e);
    }
    var confirmMsg0 = "Confirm: " + body.slice(0, 120) + "\n\nReply YES within 30s to execute, or anything else to cancel.";
    console.log("[wa_inbound] write-intent detected pre-flight — sending confirmation");
    return replyViaTwilio(phone, confirmMsg0);
  }

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
  var parsedAi = null;
  try {
    parsedAi = JSON.parse(aiRes.raw);
    if (parsedAi && parsedAi.reply) reply = String(parsedAi.reply);
  } catch (e) {
    console.log("[wa_inbound] reply parse error: " + e);
  }

  // =====================================================================
  // ENHANCEMENT 1 (continued) — check if response needs confirmation
  // =====================================================================
  // Note: detectWriteTool checks parsedAi.toolsUsed but ai_chat.pb.js does NOT
  // include that field in its response — so this branch is effectively dead code.
  // The pre-flight writeVerbs regex above is now the primary (and more aggressive)
  // guard, making this post-call check redundant. Kept for defence-in-depth but
  // will rarely/never fire in practice.
  var writeTool = detectWriteTool(parsedAi);
  if (writeTool) {
    // Stash pending confirmation
    var pendingEntry = JSON.stringify({
      messageText: body,
      expiresAtMs: Date.now() + 30000
    });
    try {
      $app.store().set(pendingKey, pendingEntry);
    } catch (e) {
      console.log("[wa_inbound] failed to set pending store: " + e);
    }

    // Extract a short action description from the AI reply (first sentence / first 120 chars)
    var actionDesc = reply.replace(/\n/g, " ").slice(0, 120);
    var confirmMsg = "Confirm: " + actionDesc + "\n\nReply YES within 30s to proceed, or anything else to cancel.";
    console.log("[wa_inbound] write-tool detected (" + writeTool + ") — sending confirmation prompt");
    return replyViaTwilio(phone, confirmMsg);
  }

  // Normal reply — multi-chunk if needed
  return replyViaTwilio(phone, reply);
});
