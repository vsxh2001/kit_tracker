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
// Write commands (/move, /approve, /reject, /request) are P2 — not yet implemented.
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
//   registered with a secret_token. Logic mirrors wa_meta_webhook.pb.js:
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

  // sendTelegram — copied verbatim from tg_send.pb.js / tg_group_digest.pb.js.
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
  // Secret-token verification (mirrors wa_meta_webhook.pb.js pattern)
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
      ];
      sendTelegram(chatId, lines.join("\n"));
      break;
    }

    case "/me": {
      var name = tgUser.getString("name") || "";
      var email = tgUser.getString("email") || "";
      var lines = [
        "<b>Your account</b>",
        "Name: " + (name || "(none)"),
        "Email: " + email,
        "Role: " + tgRole,
        "Chat ID: " + chatId,
      ];
      sendTelegram(chatId, lines.join("\n"));
      break;
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
        sendTelegram(chatId, "No active kits found.");
        break;
      }
      var truncated = kits.length > MAX_KITS;
      var showing = truncated ? kits.slice(0, MAX_KITS) : kits;
      var countLabel = truncated ? (MAX_KITS + "+") : String(kits.length);
      var lines = ["<b>Active kits (" + countLabel + ")</b>"];
      for (var ki = 0; ki < showing.length; ki++) {
        var k = showing[ki];
        var holder = getKitHolder(dao, k.id);
        lines.push("• " + k.getString("serial") + " — " + holder);
      }
      if (truncated) {
        lines.push("… showing " + MAX_KITS + ". Use /kit &lt;serial&gt; for details.");
      }
      sendTelegram(chatId, lines.join("\n"));
      break;
    }

    case "/kit": {
      var serial = parts[1] || "";
      if (!serial) {
        sendTelegram(chatId, "Usage: /kit &lt;serial&gt;  or  /kit &lt;serial&gt; all");
        break;
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
        sendTelegram(chatId, "Kit not found: " + serial);
        break;
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

      var lines = ["<b>Kit " + kit.getString("serial") + "</b>"];
      lines.push("Holder: " + holder);
      if (lastMoveDate) lines.push("Last move: " + lastMoveDate);
      if (kitNotes) lines.push("Notes: " + kitNotes);

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
            lines.push("  • " + tp.getString("name") + " ✗ missing");
          } else {
            var qty = 0;
            for (var qi = 0; qi < tpComps.length; qi++) {
              qty += (tpComps[qi].getInt("quantity") || 1);
            }
            lines.push("  • " + tp.getString("name") + " ✓ \xd7" + qty);
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
              lines.push("  • " + pname + " \xb7SN" + compSerial);
            } else {
              var qty2 = comp2.getInt("quantity") || 1;
              lines.push("  • " + pname + " \xd7" + qty2);
            }
          }
        }
        lines.push("(/kit " + serial + " for tracked summary)");
      } else {
        lines.push("(/kit " + serial + " all for full contents)");
      }

      sendTelegram(chatId, lines.join("\n"));
      break;
    }

    case "/requests": {
      var reqs = [];
      try {
        reqs = dao.findRecordsByFilter("requests", "status = 'open'", "-created", 20, 0);
      } catch (e) {}
      if (!reqs.length) {
        sendTelegram(chatId, "No open requests.");
        break;
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
        lines.push("[" + handle + "] " + reqName + " → " + kitLabel + (delivDate ? " by " + delivDate : ""));
      }
      sendTelegram(chatId, lines.join("\n"));
      break;
    }

    case "/find": {
      var query = parts.slice(1).join(" ");
      if (!query) {
        sendTelegram(chatId, "Usage: /find &lt;text&gt;");
        break;
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

      var lines = ["<b>Search: " + query + "</b>"];
      if (!matchedKits.length && !matchedEntities.length) {
        lines.push("No results found.");
      } else {
        if (matchedKits.length) {
          lines.push("Kits:");
          for (var mki = 0; mki < matchedKits.length; mki++) {
            var mk = matchedKits[mki];
            var mkNotes = mk.getString("notes") || "";
            lines.push("  • " + mk.getString("serial") + (mkNotes ? " — " + mkNotes : ""));
          }
        }
        if (matchedEntities.length) {
          lines.push("Entities:");
          for (var mei = 0; mei < matchedEntities.length; mei++) {
            var me = matchedEntities[mei];
            var meType = me.getString("type") || "";
            lines.push("  • " + me.getString("name") + (meType ? " (" + meType + ")" : ""));
          }
        }
      }
      sendTelegram(chatId, lines.join("\n"));
      break;
    }

    default: {
      sendTelegram(chatId, "Unknown command — try /help");
      break;
    }
  }

  return c.json(200, { ok: true });
});
