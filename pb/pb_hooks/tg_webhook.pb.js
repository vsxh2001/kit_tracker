/// <reference path="../pb_data/types.d.ts" />
// POST /api/tg/webhook — Telegram webhook receiver.
//
// P1 (TG slash-command redesign, 2026-05-30):
//   /start <code> account linking unchanged (Phase 4/5).
//   All other text routed to a switch(cmd) command handler. No AI call.
//
// Read commands (P1):
//   /help, /me, /kits, /kit <serial> [all], /requests, /find <text>
//
// Write commands (P2, role-gated, audit-logged):
//   /move <kit> <entity>         — admin/technician only
//   /approve <handle> [notes]    — admin/technician only
//   /reject  <handle> [notes]    — admin/technician only
//   /request <kit> <entity> [YYYY-MM-DD]  — admin/technician/user only (viewer excluded)
//
// Unknown command / non-slash text → "Unknown command — try /help".
//
// SECURITY (high-risk — read before changing):
//   The link code is a BEARER CREDENTIAL. Any Telegram user who sends /start <code>
//   gets their chat_id bound to the PB user that owns the code. Therefore:
//     - 128-bit entropy codes only (minted by tg_link.pb.js).
//     - 10-minute TTL enforced at redeem time.
//     - Single-use: used flag set atomically before reply.
//     - tg_link_codes collection rules are all null (not enumerable via REST).
//   Expiry AND used checks happen BEFORE any DB write.
//
// Secret token verification:
//   Telegram sends X-Telegram-Bot-Api-Secret-Token header when the webhook is
//   registered with a secret_token:
//     - TELEGRAM_BOT_SECRET set  → header must match, else 401.
//     - TELEGRAM_BOT_SECRET unset → log warning + proceed (local dev / CI without secrets).
//     - TG_SKIP_SIGNATURE_CHECK=1 → always proceed (explicit dev escape hatch).
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN       — from @BotFather; used to send replies.
//   TELEGRAM_BOT_SECRET      — random string (openssl rand -hex 20); must match
//                               secret_token used in setWebhook registration.
//   TG_SKIP_SIGNATURE_CHECK  — set to "1" to bypass secret check (local dev only).
//
// NO module-level vars — PB v0.22 Goja isolation.
// All helpers defined INSIDE the routerAdd callback.

routerAdd("POST", "/api/tg/webhook", function(c) {

  // ===========================================================================
  // INLINE HELPERS (inside callback — Goja isolation)
  // ===========================================================================

  // Constant-time string compare (mitigate header timing attacks).
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    var la = [], lb = [];
    for (var i = 0; i < a.length; i++) la.push(a.charCodeAt(i));
    for (var i = 0; i < b.length; i++) lb.push(b.charCodeAt(i));
    var maxLen = Math.max(la.length, lb.length);
    var result = la.length ^ lb.length;
    for (var i = 0; i < maxLen; i++) result |= (la[i] || 0) ^ (lb[i] || 0);
    return result === 0;
  }

  // escapeHtml — escape &/</>  for Telegram parse_mode:HTML.
  // All dynamic values interpolated into reply strings must be wrapped with this.
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // sendTelegram — mirrors the helper in tg_send.pb.js.
  // Reads TELEGRAM_BOT_TOKEN at call time. If unset, logs and skips (no crash).
  function sendTelegram(chatId, text) {
    var tok = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!tok) {
      console.log("[tg_webhook] TELEGRAM_BOT_TOKEN not set — skipping reply to chatId=" + chatId);
      return;
    }
    var MAX = 4000;
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) {
        breakAt = dbl + 2;
      } else {
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) {
          breakAt = nl + 1;
        } else {
          var sp = remaining.lastIndexOf(" ", MAX);
          breakAt = sp > 0 ? sp + 1 : MAX;
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());

    var url = "https://api.telegram.org/bot" + tok + "/sendMessage";
    for (var i = 0; i < chunks.length; i++) {
      try {
        var res = $http.send({
          url: url,
          method: "POST",
          body: JSON.stringify({
            chat_id: chatId,
            text: chunks[i],
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          headers: { "content-type": "application/json" },
          timeout: 20000,
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.log("[tg_webhook] Telegram API error status=" + res.statusCode + " chatId=" + chatId);
        }
      } catch (e) {
        console.log("[tg_webhook] sendTelegram HTTP error: " + e);
      }
    }
  }

  // reply — send text to the current chatId and return a JSON response body.
  // The reply text is included in the response for testability (Telegram ignores it).
  // Use this instead of the sendTelegram(chatId,X); return c.json(200,{ok:true}); pair.
  function reply(text) {
    sendTelegram(chatId, text);
    return c.json(200, { ok: true, reply: text });
  }

  // getKitHolder: return current holder name from latest transaction, or "(no transactions)".
  function getKitHolder(dao, kitId) {
    try {
      var txArr = dao.findRecordsByFilter(
        "transactions",
        "kit = {:kid}",
        "-timestamp,-created",
        1,
        0,
        { kid: kitId }
      );
      if (!txArr || !txArr.length) return "(no transactions)";
      var toEntityId = txArr[0].getString("to_entity");
      if (!toEntityId) return "(no holder)";
      var entity = dao.findRecordById("entities", toEntityId);
      return entity.getString("name");
    } catch (e) {
      return "(unknown)";
    }
  }

  // getLastMoveDate: return YYYY-MM-DD of latest transaction, or "".
  function getLastMoveDate(dao, kitId) {
    try {
      var txArr = dao.findRecordsByFilter(
        "transactions",
        "kit = {:kid}",
        "-timestamp,-created",
        1,
        0,
        { kid: kitId }
      );
      if (!txArr || !txArr.length) return "";
      var ts = txArr[0].getString("timestamp") || txArr[0].getString("created") || "";
      return ts.slice(0, 10);
    } catch (e) {
      return "";
    }
  }

  // getKitContents: return array of component records currently in the kit.
  // Algorithm mirrors frontend listComponentsInKit:
  //   1. Get component_transactions where to_kit=kitId (bounded to this kit's history)
  //   2. Collect unique component IDs that ever entered the kit
  //   3. For each, verify its absolute latest tx still has to_kit=kitId and is_active=true
  function getKitContents(dao, kitId) {
    var incomingTx;
    try {
      incomingTx = dao.findRecordsByFilter(
        "component_transactions",
        "to_kit = {:kid}",
        "-timestamp,-created",
        500,
        0,
        { kid: kitId }
      );
    } catch (e) {
      return [];
    }
    if (!incomingTx || !incomingTx.length) return [];

    var seen = {};
    var compIds = [];
    for (var i = 0; i < incomingTx.length; i++) {
      var cid = incomingTx[i].getString("component");
      if (cid && !seen[cid]) {
        seen[cid] = true;
        compIds.push(cid);
      }
    }

    var inKit = [];
    for (var j = 0; j < compIds.length; j++) {
      var compId = compIds[j];
      var comp;
      try {
        comp = dao.findRecordById("components", compId);
      } catch (e) {
        continue;
      }
      if (!comp.getBool("is_active")) continue;

      var latestArr;
      try {
        latestArr = dao.findRecordsByFilter(
          "component_transactions",
          "component = {:cid}",
          "-timestamp,-created",
          1,
          0,
          { cid: compId }
        );
      } catch (e) {
        continue;
      }
      if (!latestArr || !latestArr.length) continue;
      if (latestArr[0].getString("to_kit") !== kitId) continue;
      inKit.push(comp);
    }
    return inKit;
  }

  // ===========================================================================
  // Secret-token verification
  // ===========================================================================
  var expectedSecret = $os.getenv("TELEGRAM_BOT_SECRET") || "";
  var skipCheck = $os.getenv("TG_SKIP_SIGNATURE_CHECK") === "1";

  if (!skipCheck) {
    if (!expectedSecret) {
      console.log("[tg_webhook] TELEGRAM_BOT_SECRET not set — proceeding without verification (set in prod)");
    } else {
      var headerSecret = c.request().header.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!safeEqual(headerSecret, expectedSecret)) {
        console.log("[tg_webhook] bad secret token — rejecting");
        return c.json(401, { error: "bad secret" });
      }
    }
  } else {
    console.log("[tg_webhook] TG_SKIP_SIGNATURE_CHECK=1 — skipping secret verification");
  }

  // ===========================================================================
  // Parse body via $apis.requestInfo(c).data (NOT c.bind — PB v0.22 Goja)
  // ===========================================================================
  var update = $apis.requestInfo(c).data || {};

  var message = update.message;
  if (!message) {
    // Telegram sends non-message updates (edited_message, channel_post, etc.) — ack silently.
    return c.json(200, { ok: true });
  }

  var text = (message.text) ? String(message.text) : "";
  var chat = message.chat;
  if (!chat || !text) {
    return c.json(200, { ok: true });
  }

  var chatId = String(chat.id);

  // SECURITY: never log /start text — the code IS the bearer credential.
  var logVerb = text.startsWith("/start") ? "/start <redacted>" :
    (text.startsWith("/") ? text.split(" ")[0] : "len=" + text.length);
  console.log("[tg_webhook] inbound chatId=" + chatId + " msg=" + logVerb);

  // ===========================================================================
  // Route: /start <code>
  // ===========================================================================
  var startMatch = text.match(/^\/start\s+(\S+)/);
  if (startMatch) {
    var code = startMatch[1];

    // Look up the code row (DAO — collection rules are null)
    var dao = $app.dao();
    var codeRec = null;
    try {
      codeRec = dao.findFirstRecordByFilter(
        "tg_link_codes",
        "code = {:code}",
        { code: code }
      );
    } catch (_) {
      // findFirstRecordByFilter throws when no record found
    }

    if (!codeRec) {
      console.log("[tg_webhook] /start code not found chatId=" + chatId);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Check used BEFORE expiry (fail fast on already-used)
    if (codeRec.getBool("used")) {
      console.log("[tg_webhook] /start code already used chatId=" + chatId);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Check expiry
    var expiresAtStr = codeRec.getString("expires_at") || "";
    var now = new Date();
    var expiresAt = new Date(expiresAtStr.replace(" ", "T").replace(/Z$/, "+00:00"));
    if (isNaN(expiresAt.getTime()) || expiresAt < now) {
      console.log("[tg_webhook] /start code expired chatId=" + chatId + " expires=" + expiresAtStr);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // SECURITY: consume code FIRST, then link user.
    // PB v0.22 Goja does not expose $app.dao().runInTransaction — no transaction API
    // is available in this runtime. We use a consume-first + both-fatal pattern instead:
    //   1. Mark code used=true and save (FATAL if it fails — code stays clean).
    //   2. Load user and set telegram_chat_id and save (FATAL if it fails — code is
    //      burned but user not linked; user must re-mint. This is the safe failure mode:
    //      an attacker who obtained the code cannot replay it, and the victim re-mints).
    //   3. Write audit log (non-fatal — linking already succeeded).
    var userId = codeRec.getString("user");

    // Step 1: consume the code (FATAL — no silent swallow)
    var nowIso = now.toISOString().replace("T", " ").replace("Z", "") + "Z";
    codeRec.set("used", true);
    codeRec.set("used_at", nowIso);
    try {
      dao.saveRecord(codeRec);
    } catch (e) {
      console.log("[tg_webhook] saveRecord(code) consume error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Step 2: load user and link (FATAL — code is already burned; user must re-mint)
    var userRec = null;
    try {
      userRec = dao.findRecordById("users", userId);
    } catch (e) {
      console.log("[tg_webhook] user lookup error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Internal error — please try again.");
      return c.json(200, { ok: true });
    }

    userRec.set("telegram_chat_id", chatId);
    try {
      dao.saveRecord(userRec);
    } catch (e) {
      console.log("[tg_webhook] saveRecord(user) link error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Internal error — please try again.");
      return c.json(200, { ok: true });
    }

    // Step 3: audit log (non-fatal — linking already succeeded)
    try {
      var auditCol = dao.findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("collection_name", "users");
      auditRec.set("record_id", userId);
      auditRec.set("actor", userId);
      auditRec.set("action", "update");
      auditRec.set("changes", JSON.stringify({
        via: "tg-link",
        telegram_chat_id: chatId,
      }));
      dao.saveRecord(auditRec);
      console.log("[tg_webhook] audit_log written for user=" + userId);
    } catch (auditErr) {
      console.log("[tg_webhook] audit_log write error: " + auditErr);
    }

    console.log("[tg_webhook] linked user=" + userId + " chatId=" + chatId);
    sendTelegram(chatId, "Linked! You'll receive kit-tracker notifications here.");
    return c.json(200, { ok: true });
  }

  // ===========================================================================
  // Route: /start with no code → hint
  // ===========================================================================
  if (text.startsWith("/start")) {
    sendTelegram(chatId, "Open kit-tracker → Profile → Link Telegram to connect your account.");
    return c.json(200, { ok: true });
  }

  // ===========================================================================
  // All other messages: command dispatch (P1 — replaces Phase 5 AI bot)
  // ===========================================================================

  // Resolve user from telegram_chat_id.
  // telegram_chat_id has no uniqueness constraint — ambiguous state (>1 user) is
  // treated as a security error and must NOT proceed.
  var dao = $app.dao();
  var tgUsers = [];
  try {
    tgUsers = dao.findRecordsByFilter(
      "users",
      "telegram_chat_id = {:cid}",
      "",
      2,
      0,
      { cid: chatId }
    );
  } catch (e) {
    console.log("[tg_webhook] user lookup error chatId=" + chatId + ": " + e);
  }

  if (!tgUsers || tgUsers.length === 0) {
    console.log("[tg_webhook] no user linked for chatId=" + chatId);
    sendTelegram(chatId, "Your Telegram isn't linked. Open kit-tracker → Profile → Link Telegram to connect.");
    return c.json(200, { ok: true });
  }

  if (tgUsers.length > 1) {
    console.log("[tg_webhook] ambiguous: " + tgUsers.length + " users share chatId=" + chatId);
    sendTelegram(chatId, "Multiple accounts are linked to this Telegram. Contact an admin.");
    return c.json(200, { ok: true });
  }

  var tgUser = tgUsers[0];
  var tgRole = tgUser.getString("role");
  if (!tgRole || tgRole === "denied") {
    console.log("[tg_webhook] user=" + tgUser.id + " role=" + tgRole + " — awaiting approval");
    sendTelegram(chatId, "Your account is awaiting approval — an admin needs to set your role.");
    return c.json(200, { ok: true });
  }

  // Parse command: first token (lowercase). parts = all whitespace-split tokens.
  var parts = text.trim().split(/\s+/);
  var cmd = parts[0].toLowerCase();

  // Non-slash text is not a command.
  if (!cmd.startsWith("/")) {
    sendTelegram(chatId, "Unknown command — try /help");
    return c.json(200, { ok: true });
  }

  switch (cmd) {

    case "/help": {
      var lines = [
        "<b>Kit-Tracker commands</b>",
        "/help — this list",
        "/me — your account info",
        "/kits — active kits with holders",
        "/kit &lt;serial&gt; — kit details + tracked products",
        "/kit &lt;serial&gt; all — full kit contents",
        "/requests — open requests",
        "/find &lt;text&gt; — search kits &amp; entities",
        "/request &lt;kit&gt; &lt;entity&gt; [YYYY-MM-DD] — open a request",
      ];
      if (tgRole === "admin" || tgRole === "technician") {
        lines.push("");
        lines.push("<b>Write (admin/technician only)</b>");
        lines.push("/move &lt;kit&gt; &lt;entity&gt; — move kit to entity");
        lines.push("/approve &lt;handle&gt; [notes] — approve request");
        lines.push("/reject &lt;handle&gt; [notes] — reject request");
      }
      return reply(lines.join("\n"));
    }

    case "/me": {
      var name = tgUser.getString("name") || "";
      var email = tgUser.getString("email") || "";
      var lines = [
        "<b>Your account</b>",
        "Name: " + escapeHtml(name || "(none)"),
        "Email: " + escapeHtml(email),
        "Role: " + escapeHtml(tgRole),
        "Chat ID: " + escapeHtml(chatId),
      ];
      return reply(lines.join("\n"));
    }

    case "/kits": {
      var MAX_KITS = 20;
      var kits = [];
      try {
        kits = dao.findRecordsByFilter("kits", "is_active = true", "serial", MAX_KITS + 1, 0);
      } catch (e) {
        console.log("[tg_webhook] /kits query error: " + e);
      }
      if (!kits.length) {
        return reply("No active kits found.");
      }
      var truncated = kits.length > MAX_KITS;
      var showing = truncated ? kits.slice(0, MAX_KITS) : kits;
      var countLabel = truncated ? (MAX_KITS + "+") : String(kits.length);
      var lines = ["<b>Active kits (" + countLabel + ")</b>"];
      for (var ki = 0; ki < showing.length; ki++) {
        var k = showing[ki];
        var holder = getKitHolder(dao, k.id);
        lines.push("• " + escapeHtml(k.getString("serial")) + " — " + escapeHtml(holder));
      }
      if (truncated) {
        lines.push("… showing " + MAX_KITS + ". Use /kit &lt;serial&gt; for details.");
      }
      return reply(lines.join("\n"));
    }

    case "/kit": {
      var serial = parts[1] || "";
      if (!serial) {
        return reply("Usage: /kit &lt;serial&gt;  or  /kit &lt;serial&gt; all");
      }
      var showAll = (parts[2] || "").toLowerCase() === "all";

      var kitArr = [];
      try {
        kitArr = dao.findRecordsByFilter(
          "kits",
          "serial = {:s} && is_active = true",
          "",
          1,
          0,
          { s: serial }
        );
      } catch (e) {}
      if (!kitArr.length) {
        return reply("Kit not found: " + escapeHtml(serial));
      }
      var kit = kitArr[0];

      var holder = getKitHolder(dao, kit.id);
      var lastMoveDate = getLastMoveDate(dao, kit.id);
      var kitNotes = kit.getString("notes") || "";

      // Fetch tracked products
      var trackedProds = [];
      try {
        trackedProds = dao.findRecordsByFilter("products", "track_in_status = true", "name", 100, 0);
      } catch (e) {}

      // Fetch kit contents (needed for tracked checks and "all" view)
      var contents = [];
      if (trackedProds.length > 0 || showAll) {
        contents = getKitContents(dao, kit.id);
      }

      // Build product_id → components map
      var byProduct = {};
      for (var ci = 0; ci < contents.length; ci++) {
        var cp = contents[ci];
        var cpPid = cp.getString("product");
        if (!byProduct[cpPid]) byProduct[cpPid] = [];
        byProduct[cpPid].push(cp);
      }

      var lines = ["<b>Kit " + escapeHtml(kit.getString("serial")) + "</b>"];
      lines.push("Holder: " + escapeHtml(holder));
      if (lastMoveDate) lines.push("Last move: " + escapeHtml(lastMoveDate));
      if (kitNotes) lines.push("Notes: " + escapeHtml(kitNotes));

      // Tracked section
      lines.push("");
      if (trackedProds.length === 0) {
        lines.push("Tracked: (none configured)");
      } else {
        lines.push("Tracked:");
        for (var ti = 0; ti < trackedProds.length; ti++) {
          var tp = trackedProds[ti];
          var tpComps = byProduct[tp.id] || [];
          if (tpComps.length === 0) {
            lines.push("  • " + escapeHtml(tp.getString("name")) + " ✗ missing");
          } else {
            var qty = 0;
            for (var qi = 0; qi < tpComps.length; qi++) {
              qty += (tpComps[qi].getInt("quantity") || 1);
            }
            lines.push("  • " + escapeHtml(tp.getString("name")) + " ✓ \xd7" + qty);
          }
        }
      }

      if (showAll) {
        lines.push("");
        lines.push("Contents:");
        if (contents.length === 0) {
          lines.push("  (empty)");
        } else {
          // Build products map for name + is_serialized lookup
          var prodMap = {};
          for (var cj = 0; cj < contents.length; cj++) {
            var cpid2 = contents[cj].getString("product");
            if (!prodMap[cpid2]) {
              try { prodMap[cpid2] = dao.findRecordById("products", cpid2); } catch (e) {}
            }
          }
          for (var ck = 0; ck < contents.length; ck++) {
            var comp2 = contents[ck];
            var cpid3 = comp2.getString("product");
            var prod = prodMap[cpid3];
            var pname = prod ? prod.getString("name") : cpid3;
            var isSerialized = prod && prod.getBool("is_serialized");
            var compSerial = comp2.getString("serial") || "";
            if (isSerialized && compSerial) {
              lines.push("  • " + escapeHtml(pname) + " \xb7SN" + escapeHtml(compSerial));
            } else {
              var qty2 = comp2.getInt("quantity") || 1;
              lines.push("  • " + escapeHtml(pname) + " \xd7" + qty2);
            }
          }
        }
        lines.push("(/kit " + escapeHtml(serial) + " for tracked summary)");
      } else {
        lines.push("(/kit " + escapeHtml(serial) + " all for full contents)");
      }

      return reply(lines.join("\n"));
    }

    case "/requests": {
      var reqs = [];
      try {
        reqs = dao.findRecordsByFilter("requests", "status = 'open'", "-created", 20, 0);
      } catch (e) {}
      if (!reqs.length) {
        return reply("No open requests.");
      }
      var lines = ["<b>Open requests (" + reqs.length + ")</b>"];
      for (var ri = 0; ri < reqs.length; ri++) {
        var req = reqs[ri];
        var handle = req.id.slice(-6);
        var reqKitSerial = "";
        var reqKitId = req.getString("designated_kit");
        if (reqKitId) {
          try {
            var kitRec = dao.findRecordById("kits", reqKitId);
            reqKitSerial = kitRec.getString("serial");
          } catch (e) {}
        }
        var reqName = "";
        var reqUserId = req.getString("requester");
        if (reqUserId) {
          try {
            var reqUser = dao.findRecordById("users", reqUserId);
            reqName = reqUser.getString("name") || reqUser.getString("email") || "";
          } catch (e) {}
        }
        var delivDate = (req.getString("delivery_date") || req.getString("date") || "").slice(0, 10);
        var kitLabel = reqKitSerial || "(any kit)";
        lines.push("[" + escapeHtml(handle) + "] " + escapeHtml(reqName) + " → " + escapeHtml(kitLabel) + (delivDate ? " by " + escapeHtml(delivDate) : ""));
      }
      return reply(lines.join("\n"));
    }

    case "/find": {
      var query = parts.slice(1).join(" ");
      if (!query) {
        return reply("Usage: /find &lt;text&gt;");
      }

      var matchedKits = [];
      try {
        matchedKits = dao.findRecordsByFilter(
          "kits",
          "is_active = true && (serial ~ {:q} || notes ~ {:q})",
          "serial",
          10,
          0,
          { q: query }
        );
      } catch (e) {}

      var matchedEntities = [];
      try {
        matchedEntities = dao.findRecordsByFilter(
          "entities",
          "is_active = true && name ~ {:q}",
          "name",
          10,
          0,
          { q: query }
        );
      } catch (e) {}

      var lines = ["<b>Search: " + escapeHtml(query) + "</b>"];
      if (!matchedKits.length && !matchedEntities.length) {
        lines.push("No results found.");
      } else {
        if (matchedKits.length) {
          lines.push("Kits:");
          for (var mki = 0; mki < matchedKits.length; mki++) {
            var mk = matchedKits[mki];
            var mkNotes = mk.getString("notes") || "";
            lines.push("  • " + escapeHtml(mk.getString("serial")) + (mkNotes ? " — " + escapeHtml(mkNotes) : ""));
          }
        }
        if (matchedEntities.length) {
          lines.push("Entities:");
          for (var mei = 0; mei < matchedEntities.length; mei++) {
            var me = matchedEntities[mei];
            var meType = me.getString("type") || "";
            lines.push("  • " + escapeHtml(me.getString("name")) + (meType ? " (" + escapeHtml(meType) + ")" : ""));
          }
        }
      }
      return reply(lines.join("\n"));
    }

    // -----------------------------------------------------------------------
    // P2 — gated write commands
    // -----------------------------------------------------------------------

    case "/move": {
      if (tgRole !== "admin" && tgRole !== "technician") {
        return reply("Permission denied. /move requires admin or technician role.");
      }
      var mvSerial = parts[1] || "";
      var mvEntityRaw = parts.slice(2).join(" ");
      if (!mvSerial || !mvEntityRaw) {
        return reply("Usage: /move &lt;kit-serial&gt; &lt;entity-name&gt;");
      }

      // Resolve kit (exact serial, active)
      var mvKitArr = [];
      try {
        mvKitArr = dao.findRecordsByFilter("kits", "serial = {:s} && is_active = true", "", 1, 0, { s: mvSerial });
      } catch (e) {}
      if (!mvKitArr.length) {
        return reply("Kit not found: " + escapeHtml(mvSerial));
      }
      var mvKit = mvKitArr[0];

      // Resolve entity (case-insensitive exact name, active; no fuzzy)
      var mvEntityCands = [];
      try {
        mvEntityCands = dao.findRecordsByFilter("entities", "is_active = true && name ~ {:n}", "", 100, 0, { n: mvEntityRaw });
      } catch (e) {}
      var mvEntityMatches = [];
      for (var mvi = 0; mvi < mvEntityCands.length; mvi++) {
        if (mvEntityCands[mvi].getString("name").toLowerCase() === mvEntityRaw.toLowerCase()) {
          mvEntityMatches.push(mvEntityCands[mvi]);
        }
      }
      if (!mvEntityMatches.length) {
        return reply("Entity not found: " + escapeHtml(mvEntityRaw));
      }
      if (mvEntityMatches.length > 1) {
        return reply("Ambiguous entity name: " + escapeHtml(mvEntityRaw) + ". Contact admin.");
      }
      var mvEntity = mvEntityMatches[0];

      // Derive from_entity from kit's latest transaction
      var mvFromId = "";
      try {
        var mvLastTxArr = dao.findRecordsByFilter("transactions", "kit = {:kid}", "-timestamp,-created", 1, 0, { kid: mvKit.id });
        if (mvLastTxArr && mvLastTxArr.length) mvFromId = mvLastTxArr[0].getString("to_entity") || "";
      } catch (e) {}

      // No-op if kit is already at the requested destination (B-G3-1 symmetry with MCP move_kit).
      if (mvFromId && mvFromId === mvEntity.id) {
        return reply("Kit " + escapeHtml(mvSerial) + " already at " + escapeHtml(mvEntity.getString("name")) + " — no transaction created.");
      }

      // Create transaction
      var mvNow = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
      var mvTxCol = dao.findCollectionByNameOrId("transactions");
      var mvTxRec = new Record(mvTxCol);
      mvTxRec.set("kit", mvKit.id);
      if (mvFromId) mvTxRec.set("from_entity", mvFromId);
      mvTxRec.set("to_entity", mvEntity.id);
      mvTxRec.set("timestamp", mvNow);
      mvTxRec.set("created_by", tgUser.id);
      try {
        dao.saveRecord(mvTxRec);
      } catch (e) {
        console.log("[tg_webhook] /move saveRecord error: " + e);
        return reply("Error creating transaction. Please try again.");
      }

      // Audit log (actor required — do not swallow)
      try {
        var mvAuditCol = dao.findCollectionByNameOrId("audit_log");
        var mvAuditRec = new Record(mvAuditCol);
        mvAuditRec.set("collection_name", "transactions");
        mvAuditRec.set("record_id", mvTxRec.id);
        mvAuditRec.set("actor", tgUser.id);
        mvAuditRec.set("action", "create");
        mvAuditRec.set("changes", JSON.stringify({ via: "tg-command", kit: mvSerial, to_entity: mvEntity.getString("name") }));
        dao.saveRecord(mvAuditRec);
      } catch (auditE) {
        console.log("[tg_webhook] /move audit error: " + auditE);
      }

      return reply("Moved " + escapeHtml(mvSerial) + " → " + escapeHtml(mvEntity.getString("name")));
    }

    case "/approve":
    case "/reject": {
      if (tgRole !== "admin" && tgRole !== "technician") {
        return reply("Permission denied. /" + cmd.slice(1) + " requires admin or technician role.");
      }
      var dcHandle = parts[1] || "";
      if (!dcHandle) {
        return reply("Usage: /" + cmd.slice(1) + " &lt;handle&gt; [notes]");
      }
      var dcNotes = parts.slice(2).join(" ");

      // Search all requests (any status); match by last-6-char ID suffix so the
      // no-op / wrong-status branches below can give an accurate reply instead of
      // a misleading "no open request" when the request is already approved /
      // rejected / fulfilled. B-G3-1 symmetry with MCP decide_request.
      var dcAllReqs = [];
      try {
        dcAllReqs = dao.findRecordsByFilter("requests", "id != ''", "-created", 500, 0);
      } catch (e) {}
      var dcMatching = [];
      for (var dci = 0; dci < dcAllReqs.length; dci++) {
        if (dcAllReqs[dci].id.slice(-6) === dcHandle) dcMatching.push(dcAllReqs[dci]);
      }
      if (!dcMatching.length) {
        return reply("No request found with handle: " + escapeHtml(dcHandle));
      }
      if (dcMatching.length > 1) {
        return reply("Ambiguous handle (multiple requests match). Contact admin.");
      }
      var dcReq = dcMatching[0];
      var dcCurrentStatus = dcReq.getString("status");
      var dcNewStatus = (cmd === "/approve") ? "approved" : "rejected";

      // No-op if already in target status (B-G3-1 symmetry with MCP decide_request).
      if (dcCurrentStatus === dcNewStatus) {
        return reply("Request " + escapeHtml(dcHandle) + " already " + dcNewStatus + " — no change made.");
      }
      // Block transition from non-open statuses (fulfilled / cancelled / opposite decision).
      if (dcCurrentStatus !== "open") {
        return reply("Request " + escapeHtml(dcHandle) + " is " + escapeHtml(dcCurrentStatus) + " — cannot " + cmd.slice(1) + ".");
      }

      dcReq.set("status", dcNewStatus);
      if (dcNotes) dcReq.set("decision_notes", dcNotes);
      try {
        dao.saveRecord(dcReq);
      } catch (e) {
        console.log("[tg_webhook] /" + cmd.slice(1) + " saveRecord error: " + e);
        return reply("Error updating request. Please try again.");
      }

      // Audit log (actor required)
      try {
        var dcAuditCol = dao.findCollectionByNameOrId("audit_log");
        var dcAuditRec = new Record(dcAuditCol);
        dcAuditRec.set("collection_name", "requests");
        dcAuditRec.set("record_id", dcReq.id);
        dcAuditRec.set("actor", tgUser.id);
        dcAuditRec.set("action", "update");
        dcAuditRec.set("changes", JSON.stringify({ via: "tg-command", status: dcNewStatus }));
        dao.saveRecord(dcAuditRec);
      } catch (auditE) {
        console.log("[tg_webhook] /" + cmd.slice(1) + " audit error: " + auditE);
      }

      var dcVerb = (cmd === "/approve") ? "Approved" : "Rejected";
      return reply(dcVerb + " request [" + escapeHtml(dcHandle) + "]");
    }

    case "/request": {
      // SECURITY: viewer role must not create requests — PB createRule excludes viewer,
      // but dao.saveRecord() bypasses collection rules. Gate explicitly here.
      if (tgRole !== "admin" && tgRole !== "technician" && tgRole !== "user") {
        return reply("Permission denied — /request requires a requester role.");
      }

      var rqKit = parts[1] || "";
      // Remaining args: entity name, with optional YYYY-MM-DD at the end.
      var rqRemainder = parts.slice(2);
      var rqDate = "";
      var rqEntityRaw = "";
      if (rqRemainder.length > 0) {
        var rqLast = rqRemainder[rqRemainder.length - 1];
        if (/^\d{4}-\d{2}-\d{2}$/.test(rqLast)) {
          rqDate = rqLast;
          rqEntityRaw = rqRemainder.slice(0, -1).join(" ");
        } else {
          rqEntityRaw = rqRemainder.join(" ");
        }
      }
      if (!rqKit || !rqEntityRaw) {
        return reply("Usage: /request &lt;kit-serial&gt; &lt;entity-name&gt; [YYYY-MM-DD]");
      }
      if (!rqDate) rqDate = new Date().toISOString().slice(0, 10);

      // Resolve kit
      var rqKitArr = [];
      try {
        rqKitArr = dao.findRecordsByFilter("kits", "serial = {:s} && is_active = true", "", 1, 0, { s: rqKit });
      } catch (e) {}
      if (!rqKitArr.length) {
        return reply("Kit not found: " + escapeHtml(rqKit));
      }
      var rqKitRec = rqKitArr[0];

      // Resolve entity (case-insensitive exact name)
      var rqEntityCands = [];
      try {
        rqEntityCands = dao.findRecordsByFilter("entities", "is_active = true && name ~ {:n}", "", 100, 0, { n: rqEntityRaw });
      } catch (e) {}
      var rqEntityMatches = [];
      for (var rqi = 0; rqi < rqEntityCands.length; rqi++) {
        if (rqEntityCands[rqi].getString("name").toLowerCase() === rqEntityRaw.toLowerCase()) {
          rqEntityMatches.push(rqEntityCands[rqi]);
        }
      }
      if (!rqEntityMatches.length) {
        return reply("Entity not found: " + escapeHtml(rqEntityRaw));
      }
      if (rqEntityMatches.length > 1) {
        return reply("Ambiguous entity name: " + escapeHtml(rqEntityRaw) + ". Contact admin.");
      }
      var rqEntityRec = rqEntityMatches[0];

      // No-op if the same requester already has an OPEN request with this exact
      // kit + entity + delivery_date. B-G3-1 symmetry with MCP move_kit / decide_request
      // and Telegram /move / /approve no-op guards (#430, #431). Prevents duplicate
      // open rows when a user retypes or resends the same /request line.
      // delivery_date is a PB `date` field; range bounds use YYYY-MM-DD to match a
      // full calendar day regardless of the stored time suffix.
      var rqDateNext = new Date(rqDate + "T00:00:00Z");
      rqDateNext.setUTCDate(rqDateNext.getUTCDate() + 1);
      var rqDateNextStr = rqDateNext.toISOString().slice(0, 10);
      var rqDupes = [];
      try {
        rqDupes = dao.findRecordsByFilter(
          "requests",
          "status = 'open' && requester = {:r} && designated_kit = {:k} && target_entity = {:e} && delivery_date >= {:d1} && delivery_date < {:d2}",
          "-created",
          1,
          0,
          {
            r: tgUser.id,
            k: rqKitRec.id,
            e: rqEntityRec.id,
            d1: rqDate,
            d2: rqDateNextStr,
          }
        );
      } catch (e) {}
      if (rqDupes.length > 0) {
        return reply(
          "Open request already exists for " + escapeHtml(rqKit) + " → " +
          escapeHtml(rqEntityRec.getString("name")) + " by " + escapeHtml(rqDate) +
          " [" + escapeHtml(rqDupes[0].id.slice(-6)) + "] — no new request created."
        );
      }

      // Create request
      var rqToday = new Date().toISOString().slice(0, 10);
      var rqCol = dao.findCollectionByNameOrId("requests");
      var rqRec = new Record(rqCol);
      rqRec.set("requester", tgUser.id);
      rqRec.set("date", rqToday);
      rqRec.set("delivery_date", rqDate);
      rqRec.set("status", "open");
      rqRec.set("designated_kit", rqKitRec.id);
      rqRec.set("target_entity", rqEntityRec.id);
      try {
        dao.saveRecord(rqRec);
      } catch (e) {
        console.log("[tg_webhook] /request saveRecord error: " + e);
        return reply("Error creating request. Please try again.");
      }

      // Audit log (actor required)
      try {
        var rqAuditCol = dao.findCollectionByNameOrId("audit_log");
        var rqAuditRec = new Record(rqAuditCol);
        rqAuditRec.set("collection_name", "requests");
        rqAuditRec.set("record_id", rqRec.id);
        rqAuditRec.set("actor", tgUser.id);
        rqAuditRec.set("action", "create");
        rqAuditRec.set("changes", JSON.stringify({ via: "tg-command", kit: rqKit, entity: rqEntityRec.getString("name") }));
        dao.saveRecord(rqAuditRec);
      } catch (auditE) {
        console.log("[tg_webhook] /request audit error: " + auditE);
      }

      return reply("Requested kit " + escapeHtml(rqKit) + " → " + escapeHtml(rqEntityRec.getString("name")) + " by " + escapeHtml(rqDate));
    }

    default: {
      return reply("Unknown command — try /help");
    }
  }

  return c.json(200, { ok: true });
});
