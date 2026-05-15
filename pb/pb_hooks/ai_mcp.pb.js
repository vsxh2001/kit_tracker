/// <reference path="../pb_data/types.d.ts" />
// POST /api/mcp — Phase 5: MCP server (Streamable HTTP transport, JSON-RPC 2.0)
//
// Exposes the same 11 tools as ai_chat.pb.js via the Model Context Protocol so
// any MCP client (Claude Code, Claude Desktop, Cursor, VS Code) can call them
// directly without going through Anthropic.
//
// Transport: Streamable HTTP (single POST endpoint, JSON-RPC over HTTP body).
//   Spec: https://spec.modelcontextprotocol.io/specification/2025-06-18/basic/transports/
//
// Auth: Authorization: <PB token> header (same as all other PB API calls).
//
// JSON-RPC methods implemented:
//   initialize          — capabilities exchange
//   tools/list          — list all 11 tool definitions
//   tools/call          — execute a tool with given args
//   ping                — heartbeat, returns {}
//   notifications/initialized — no-op (client lifecycle notification)
//
// Permissions:
//   Read tools (list_*, get_*, resolve_*) — any authenticated user
//   Write tools (create_*, move_*)        — admin/technician only
//
// Audit: write tool calls logged with changes.via = "mcp"
// Undo: not provided in MCP v1; issue a reverse operation from the client.
//
// NOTE on inlining: PB v0.22 Goja isolates each routerAdd callback;
// file-scope function declarations are NOT visible inside the handler.
// All tool definitions + executor logic therefore live INSIDE the callback.

routerAdd("POST", "/api/mcp", function(c) {

  // ===== tool layer (inlined; mirrors ai_chat.pb.js — keep in sync structurally) =====
  function getMcpTools() {
    var definitions = [
      {
        name: "list_kits",
        description: "List kits, optionally filtered by search term or entity. Returns up to 50 kits.",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", description: "Serial number substring search" },
            entity_id: { type: "string", description: "Filter by current entity ID" },
            limit: { type: "number", description: "Max results (default 20, max 50)" }
          },
          required: []
        }
      },
      {
        name: "get_kit",
        description: "Get full details of one kit including last 5 transactions and active components.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Kit record ID" }
          },
          required: ["id"]
        }
      },
      {
        name: "list_entities",
        description: "List entities (locations/sites), optionally filtered by search or type.",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", description: "Name substring search" },
            type: { type: "string", description: "Entity type filter" },
            limit: { type: "number", description: "Max results (default 20, max 50)" }
          },
          required: []
        }
      },
      {
        name: "get_entity",
        description: "Get full details of one entity including current kit holdings.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Entity record ID" }
          },
          required: ["id"]
        }
      },
      {
        name: "list_requests",
        description: "List kit requests, optionally filtered by status or requester.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["open", "approved", "rejected", "fulfilled", "cancelled"],
              description: "Filter by request status"
            },
            requester_id: { type: "string", description: "Filter by requester user ID" },
            limit: { type: "number", description: "Max results (default 20, max 50)" }
          },
          required: []
        }
      },
      {
        name: "list_components",
        description: "List components, optionally filtered by search, type, or product.",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", description: "Serial number substring search" },
            type: { type: "string", description: "Component type filter" },
            product_id: { type: "string", description: "Filter by product ID" },
            limit: { type: "number", description: "Max results (default 20, max 50)" }
          },
          required: []
        }
      },
      {
        name: "resolve_kit",
        description: "Fuzzy-match a kit by serial number fragment. Returns up to 5 candidates with confidence.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Serial number or partial serial to search" }
          },
          required: ["query"]
        }
      },
      {
        name: "resolve_entity",
        description: "Fuzzy-match an entity by name fragment. Returns up to 5 candidates with confidence.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Entity name or partial name to search" }
          },
          required: ["query"]
        }
      },
      {
        name: "create_entity",
        description: "Create a new entity (location/site). Returns the new entity record ID. Undo not available via MCP — issue a reverse operation from the client. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Entity name (required)" },
            type: { type: "string", description: "Entity type (e.g. storage, lab, site)" },
            description: { type: "string", description: "Optional description" }
          },
          required: ["name"]
        }
      },
      {
        name: "create_kit",
        description: "Create a new kit record. Returns the new kit record ID. Undo not available via MCP — issue a reverse operation from the client. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            serial: { type: "string", description: "Kit serial number (required)" },
            tags: { type: "string", description: "Optional tags (comma-separated)" },
            notes: { type: "string", description: "Optional notes" }
          },
          required: ["serial"]
        }
      },
      {
        name: "move_kit",
        description: "Move a kit to a new entity by creating a transaction. Call resolve_kit and resolve_entity FIRST to confirm single matches. Undo not available via MCP — issue a reverse operation from the client. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            kit_id: { type: "string", description: "Kit record ID (use resolve_kit first)" },
            to_entity_id: { type: "string", description: "Destination entity record ID (use resolve_entity first)" },
            notes: { type: "string", description: "Optional notes for the transaction" }
          },
          required: ["kit_id", "to_entity_id"]
        }
      },
      {
        name: "resolve_product",
        description: "Fuzzy-match a product by name, manufacturer, or model. Returns up to 5 candidates with confidence. Use before create_component to find the product_id.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Product name, manufacturer, or model to search" }
          },
          required: ["query"]
        }
      },
      {
        name: "create_product",
        description: "Create a new product catalog entry. ALWAYS call directly. Do NOT resolve_* first. Duplicate names allowed. Returns the new product record ID. Undo not available via MCP. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Product name (required)" },
            category: { type: "string", description: "Optional category" },
            manufacturer: { type: "string", description: "Optional manufacturer name" },
            model: { type: "string", description: "Optional model identifier" },
            description: { type: "string", description: "Optional description" },
            url: { type: "string", description: "Optional URL (product page, datasheet)" },
            specs: { type: "string", description: "Optional specs (JSON string or plain text)" }
          },
          required: ["name"]
        }
      },
      {
        name: "create_component",
        description: "Create a new component record. Components MUST have a product — resolve_product or create_product first to get product_id. Serial required when is_bulk=false; quantity required when is_bulk=true. After creation the component is unplaced — call move_component to place it. Undo not available via MCP. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            product_id: { type: "string", description: "Product record ID (required)" },
            serial: { type: "string", description: "Serial number (required when is_bulk=false)" },
            is_bulk: { type: "boolean", description: "True for bulk/consumable components (default false)" },
            quantity: { type: "number", description: "Quantity (required when is_bulk=true)" },
            notes: { type: "string", description: "Optional notes" }
          },
          required: ["product_id"]
        }
      },
      {
        name: "move_component",
        description: "Move a component to a kit or entity by creating a component_transactions record. Exactly one of to_kit_id or to_entity_id required. For bulk components, quantity defaults to the full component quantity. Undo not available via MCP — issue a reverse move_component. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            component_id: { type: "string", description: "Component record ID (required)" },
            to_kit_id: { type: "string", description: "Destination kit ID (mutually exclusive with to_entity_id)" },
            to_entity_id: { type: "string", description: "Destination entity ID (mutually exclusive with to_kit_id)" },
            quantity: { type: "number", description: "Quantity to move (bulk only; defaults to full quantity)" },
            notes: { type: "string", description: "Optional notes for the transaction" }
          },
          required: ["component_id"]
        }
      },
      {
        name: "decide_request",
        description: "Approve or reject a kit request. Updates the request status to 'approved' or 'rejected'. Does NOT fulfill the request — fulfillment is a separate step. Undo not available via MCP — set status back to 'open' manually. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: { type: "string", description: "Request record ID (required)" },
            decision: { type: "string", enum: ["approve", "reject"], description: "approve or reject" },
            decision_notes: { type: "string", description: "Optional notes explaining the decision" }
          },
          required: ["request_id", "decision"]
        }
      },
      {
        name: "link_component_to_product",
        description: "Re-assigns a component to a different product. Use when a component was linked to the wrong product or to migrate Legacy:* products into proper catalog entries. Undo not available via MCP — call again with previous product_id. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            component_id: { type: "string", description: "Component record ID (required)" },
            product_id: { type: "string", description: "New product record ID (required)" }
          },
          required: ["component_id", "product_id"]
        }
      }
    ];

    function clamp(val, def, max) {
      var n = parseInt(val, 10);
      if (!n || n < 1) return def;
      return Math.min(n, max);
    }

    function safeStr(r, field) {
      try { return r.getString(field) || ""; } catch (_) { return ""; }
    }

    // Find most recent transaction for a kit → current entity name
    function kitCurrentEntity(dao, kitId) {
      try {
        var txns = dao.findRecordsByFilter(
          "transactions",
          "kit = {:kitId}",
          "-timestamp",
          1,
          0,
          { kitId: kitId }
        );
        if (txns.length === 0) return { id: "", name: "" };
        var tx = txns[0];
        var entityId = safeStr(tx, "to_entity");
        if (!entityId) return { id: "", name: "" };
        try {
          var entity = dao.findRecordById("entities", entityId);
          return { id: entityId, name: safeStr(entity, "name") };
        } catch (_) {
          return { id: entityId, name: "" };
        }
      } catch (_) {
        return { id: "", name: "" };
      }
    }

    function executeListKits(dao, args) {
      var limit = clamp(args.limit, 20, 50);
      var filters = ["is_active = true"];
      var params = {};

      if (args.search) {
        filters.push("serial ~ {:search}");
        params.search = args.search;
      }
      var filterStr = filters.join(" && ");
      var kits = dao.findRecordsByFilter("kits", filterStr, "serial", limit * 3, 0, params);

      var results = [];
      for (var i = 0; i < kits.length && results.length < limit; i++) {
        var k = kits[i];
        var ce = kitCurrentEntity(dao, k.id);
        if (args.entity_id && ce.id !== args.entity_id) continue;
        var lastMovedAt = "";
        try {
          var txns = dao.findRecordsByFilter(
            "transactions",
            "kit = {:kitId}",
            "-timestamp",
            1,
            0,
            { kitId: k.id }
          );
          if (txns.length > 0) lastMovedAt = safeStr(txns[0], "timestamp");
        } catch (_) {}

        results.push({
          id: k.id,
          serial: safeStr(k, "serial"),
          current_entity_id: ce.id,
          current_entity_name: ce.name,
          last_moved_at: lastMovedAt,
          tags: safeStr(k, "tags")
        });
      }
      return results;
    }

    function executeGetKit(dao, args) {
      var kit;
      try {
        kit = dao.findRecordById("kits", args.id);
      } catch (_) {
        return { error: "kit not found", id: args.id };
      }

      var ce = kitCurrentEntity(dao, kit.id);

      var txns = [];
      try {
        var rawTxns = dao.findRecordsByFilter(
          "transactions",
          "kit = {:kitId}",
          "-timestamp",
          5,
          0,
          { kitId: kit.id }
        );
        for (var t = 0; t < rawTxns.length; t++) {
          var tx = rawTxns[t];
          var fromName = "";
          var toName = "";
          var fromEntityId = safeStr(tx, "from_entity");
          var toEntityId = safeStr(tx, "to_entity");
          if (fromEntityId) {
            try { fromName = safeStr(dao.findRecordById("entities", fromEntityId), "name"); } catch (_) {}
          }
          if (toEntityId) {
            try { toName = safeStr(dao.findRecordById("entities", toEntityId), "name"); } catch (_) {}
          }
          txns.push({
            id: tx.id,
            from_entity_id: fromEntityId,
            from_entity_name: fromName,
            to_entity_id: toEntityId,
            to_entity_name: toName,
            timestamp: safeStr(tx, "timestamp"),
            notes: safeStr(tx, "notes")
          });
        }
      } catch (_) {}

      var components = [];
      try {
        var rawComps = dao.findRecordsByFilter(
          "components",
          "kit = {:kitId} && is_active = true",
          "serial",
          50,
          0,
          { kitId: kit.id }
        );
        for (var ci = 0; ci < rawComps.length; ci++) {
          var comp = rawComps[ci];
          components.push({
            id: comp.id,
            serial: safeStr(comp, "serial"),
            type: safeStr(comp, "type"),
            notes: safeStr(comp, "notes")
          });
        }
      } catch (_) {}

      return {
        id: kit.id,
        serial: safeStr(kit, "serial"),
        notes: safeStr(kit, "notes"),
        tags: safeStr(kit, "tags"),
        is_active: kit.getBool ? kit.getBool("is_active") : (safeStr(kit, "is_active") === "true"),
        current_entity_id: ce.id,
        current_entity_name: ce.name,
        last_5_transactions: txns,
        active_components: components
      };
    }

    function executeListEntities(dao, args) {
      var limit = clamp(args.limit, 20, 50);
      var filters = ["is_active = true"];
      var params = {};

      if (args.search) {
        filters.push("name ~ {:search}");
        params.search = args.search;
      }
      if (args.type) {
        filters.push("type = {:type}");
        params.type = args.type;
      }

      var entities = dao.findRecordsByFilter(
        "entities",
        filters.join(" && "),
        "name",
        limit,
        0,
        params
      );

      var results = [];
      for (var i = 0; i < entities.length; i++) {
        var e = entities[i];
        results.push({
          id: e.id,
          name: safeStr(e, "name"),
          type: safeStr(e, "type"),
          description: safeStr(e, "description")
        });
      }
      return results;
    }

    function executeGetEntity(dao, args) {
      var entity;
      try {
        entity = dao.findRecordById("entities", args.id);
      } catch (_) {
        return { error: "entity not found", id: args.id };
      }

      var currentKits = [];
      try {
        var activeKits = dao.findRecordsByFilter(
          "kits",
          "is_active = true",
          "serial",
          200,
          0,
          {}
        );
        for (var i = 0; i < activeKits.length; i++) {
          var k = activeKits[i];
          var ce = kitCurrentEntity(dao, k.id);
          if (ce.id === entity.id) {
            currentKits.push({ id: k.id, serial: safeStr(k, "serial"), tags: safeStr(k, "tags") });
          }
        }
      } catch (_) {}

      return {
        id: entity.id,
        name: safeStr(entity, "name"),
        type: safeStr(entity, "type"),
        description: safeStr(entity, "description"),
        is_active: entity.getBool ? entity.getBool("is_active") : (safeStr(entity, "is_active") === "true"),
        current_kits: currentKits,
        current_kit_count: currentKits.length
      };
    }

    function executeListRequests(dao, args) {
      var limit = clamp(args.limit, 20, 50);
      var filters = [];
      var params = {};

      if (args.status) {
        filters.push("status = {:status}");
        params.status = args.status;
      }
      if (args.requester_id) {
        filters.push("requester = {:requesterId}");
        params.requesterId = args.requester_id;
      }

      var filterStr = filters.length > 0 ? filters.join(" && ") : "id != ''";
      var requests = dao.findRecordsByFilter(
        "requests",
        filterStr,
        "-created",
        limit,
        0,
        params
      );

      var results = [];
      for (var i = 0; i < requests.length; i++) {
        var r = requests[i];
        var requesterName = "";
        var requesterId = safeStr(r, "requester");
        if (requesterId) {
          try {
            var requester = dao.findRecordById("users", requesterId);
            requesterName = safeStr(requester, "name") || safeStr(requester, "email");
          } catch (_) {}
        }
        var kitSerial = "";
        var kitId = safeStr(r, "designated_kit");
        if (kitId) {
          try {
            var kit = dao.findRecordById("kits", kitId);
            kitSerial = safeStr(kit, "serial");
          } catch (_) {}
        }
        var entityName = "";
        var entityId = safeStr(r, "target_entity");
        if (entityId) {
          try {
            var targetEntity = dao.findRecordById("entities", entityId);
            entityName = safeStr(targetEntity, "name");
          } catch (_) {}
        }

        results.push({
          id: r.id,
          status: safeStr(r, "status"),
          requester_id: requesterId,
          requester_name: requesterName,
          designated_kit_id: kitId,
          designated_kit_serial: kitSerial,
          target_entity_id: entityId,
          target_entity_name: entityName,
          date: safeStr(r, "date"),
          notes: safeStr(r, "notes"),
          expected_return: safeStr(r, "expected_return")
        });
      }
      return results;
    }

    function executeListComponents(dao, args) {
      var limit = clamp(args.limit, 20, 50);
      var filters = ["is_active = true"];
      var params = {};

      if (args.search) {
        filters.push("serial ~ {:search}");
        params.search = args.search;
      }
      if (args.type) {
        filters.push("type = {:type}");
        params.type = args.type;
      }
      if (args.product_id) {
        filters.push("product = {:productId}");
        params.productId = args.product_id;
      }

      var components = dao.findRecordsByFilter(
        "components",
        filters.join(" && "),
        "serial",
        limit,
        0,
        params
      );

      var results = [];
      for (var i = 0; i < components.length; i++) {
        var c = components[i];
        var productName = "";
        var productId = safeStr(c, "product");
        if (productId) {
          try {
            var product = dao.findRecordById("products", productId);
            productName = safeStr(product, "name");
          } catch (_) {}
        }
        results.push({
          id: c.id,
          serial: safeStr(c, "serial"),
          type: safeStr(c, "type"),
          notes: safeStr(c, "notes"),
          product_id: productId,
          product_name: productName
        });
      }
      return results;
    }

    function executeResolveKit(dao, args) {
      var q = String(args.query || "").trim();
      if (!q) return [];

      var candidates = [];
      try {
        var kits = dao.findRecordsByFilter(
          "kits",
          "serial ~ {:q}",
          "serial",
          20,
          0,
          { q: q }
        );
        for (var i = 0; i < kits.length; i++) {
          var k = kits[i];
          var serial = safeStr(k, "serial");
          var ce = kitCurrentEntity(dao, k.id);
          var confidence = "fuzzy";
          var lowerSerial = serial.toLowerCase();
          var lowerQ = q.toLowerCase();
          if (lowerSerial === lowerQ) confidence = "exact";
          else if (lowerSerial.indexOf(lowerQ) === 0) confidence = "prefix";
          candidates.push({
            id: k.id,
            serial: serial,
            current_entity_name: ce.name,
            confidence: confidence
          });
        }
      } catch (_) {}

      var order = { exact: 0, prefix: 1, fuzzy: 2 };
      candidates.sort(function(a, b) { return order[a.confidence] - order[b.confidence]; });
      return candidates.slice(0, 5);
    }

    function executeResolveEntity(dao, args) {
      var q = String(args.query || "").trim();
      if (!q) return [];

      var candidates = [];
      try {
        var entities = dao.findRecordsByFilter(
          "entities",
          "name ~ {:q}",
          "name",
          20,
          0,
          { q: q }
        );
        for (var i = 0; i < entities.length; i++) {
          var e = entities[i];
          var name = safeStr(e, "name");
          var confidence = "fuzzy";
          var lowerName = name.toLowerCase();
          var lowerQ = q.toLowerCase();
          if (lowerName === lowerQ) confidence = "exact";
          else if (lowerName.indexOf(lowerQ) === 0) confidence = "prefix";
          candidates.push({
            id: e.id,
            name: name,
            type: safeStr(e, "type"),
            confidence: confidence
          });
        }
      } catch (_) {}

      var order = { exact: 0, prefix: 1, fuzzy: 2 };
      candidates.sort(function(a, b) { return order[a.confidence] - order[b.confidence]; });
      return candidates.slice(0, 5);
    }

    // --- Write tools ---

    function saveMcpAuditLog(dao, opts) {
      // opts: { collection_name, record_id, actor, action, tool }
      try {
        var auditCollection = dao.findCollectionByNameOrId("audit_log");
        var auditRecord = new Record(auditCollection);
        auditRecord.set("collection_name", opts.collection_name);
        auditRecord.set("record_id", opts.record_id);
        auditRecord.set("actor", opts.actor);
        auditRecord.set("action", opts.action);
        auditRecord.set("changes", JSON.stringify({
          via: "mcp",
          tool: opts.tool
        }));
        dao.save(auditRecord);
      } catch (auditErr) {
        console.log("[ai_mcp] audit log error: " + auditErr);
      }
    }

    function executeCreateEntity(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can create entities." };
      }
      var name = String(args.name || "").trim();
      if (!name) {
        return { error: "missing_required", detail: "name is required" };
      }

      try {
        var collection = dao.findCollectionByNameOrId("entities");
        var record = new Record(collection);
        record.set("name", name);
        record.set("type", args.type ? String(args.type) : "storage");
        record.set("description", args.description ? String(args.description) : "");
        record.set("is_active", true);
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "entities",
          record_id: record.id,
          actor: userId,
          action: "create",
          tool: "create_entity"
        });

        return {
          success: true,
          record_id: record.id,
          name: name,
          description: "Created entity: " + name + ". Note: undo is not available via MCP — issue a reverse operation if needed.",
          collection: "entities"
        };
      } catch (err) {
        return { error: "create_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeCreateKit(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can create kits." };
      }
      var serial = String(args.serial || "").trim();
      if (!serial) {
        return { error: "missing_required", detail: "serial is required" };
      }

      try {
        var collection = dao.findCollectionByNameOrId("kits");
        var record = new Record(collection);
        record.set("serial", serial);
        record.set("tags", args.tags ? String(args.tags) : "");
        record.set("notes", args.notes ? String(args.notes) : "");
        record.set("is_active", true);
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "kits",
          record_id: record.id,
          actor: userId,
          action: "create",
          tool: "create_kit"
        });

        return {
          success: true,
          record_id: record.id,
          serial: serial,
          description: "Created kit: " + serial + ". Note: undo is not available via MCP — issue a reverse operation if needed.",
          collection: "kits"
        };
      } catch (err) {
        return { error: "create_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeMoveKit(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can move kits." };
      }
      var kitId = String(args.kit_id || "").trim();
      var toEntityId = String(args.to_entity_id || "").trim();
      if (!kitId) {
        return { error: "missing_required", detail: "kit_id is required" };
      }
      if (!toEntityId) {
        return { error: "missing_required", detail: "to_entity_id is required" };
      }

      var kit;
      try {
        kit = dao.findRecordById("kits", kitId);
      } catch (_) {
        return { error: "not_found", detail: "kit not found: " + kitId };
      }
      try {
        dao.findRecordById("entities", toEntityId);
      } catch (_) {
        return { error: "not_found", detail: "entity not found: " + toEntityId };
      }

      var currentEntity = kitCurrentEntity(dao, kitId);

      try {
        var txCollection = dao.findCollectionByNameOrId("transactions");
        var txRecord = new Record(txCollection);
        txRecord.set("kit", kitId);
        if (currentEntity.id) {
          txRecord.set("from_entity", currentEntity.id);
        }
        txRecord.set("to_entity", toEntityId);
        txRecord.set("timestamp", new Date().toISOString());
        txRecord.set("notes", args.notes ? String(args.notes) : "MCP-executed move");
        txRecord.set("created_by", userId);
        dao.save(txRecord);

        var kitSerial = "";
        try { kitSerial = kit.getString ? kit.getString("serial") : ""; } catch (_) {}
        var toEntityName = "";
        try {
          var toEnt = dao.findRecordById("entities", toEntityId);
          toEntityName = toEnt.getString ? toEnt.getString("name") : toEntityId;
        } catch (_) { toEntityName = toEntityId; }

        saveMcpAuditLog(dao, {
          collection_name: "transactions",
          record_id: txRecord.id,
          actor: userId,
          action: "create",
          tool: "move_kit"
        });

        return {
          success: true,
          record_id: txRecord.id,
          kit_serial: kitSerial,
          to_entity_name: toEntityName,
          description: "Moved kit " + kitSerial + " to " + toEntityName + ". Note: undo is not available via MCP — issue a reverse move_kit to undo.",
          collection: "transactions"
        };
      } catch (err) {
        return { error: "move_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeResolveProduct(dao, args) {
      var q = String(args.query || "").trim();
      if (!q) return [];

      var candidates = [];
      try {
        var products = dao.findRecordsByFilter(
          "products",
          "name ~ {:q} || manufacturer ~ {:q} || model ~ {:q}",
          "name",
          20,
          0,
          { q: q }
        );
        var order = { exact: 0, prefix: 1, fuzzy: 2 };
        for (var i = 0; i < products.length; i++) {
          var p = products[i];
          var name = safeStr(p, "name");
          var manufacturer = safeStr(p, "manufacturer");
          var model = safeStr(p, "model");
          var confidence = "fuzzy";
          var lowerQ = q.toLowerCase();
          if (name.toLowerCase() === lowerQ || manufacturer.toLowerCase() === lowerQ || model.toLowerCase() === lowerQ) {
            confidence = "exact";
          } else if (name.toLowerCase().indexOf(lowerQ) === 0 || manufacturer.toLowerCase().indexOf(lowerQ) === 0 || model.toLowerCase().indexOf(lowerQ) === 0) {
            confidence = "prefix";
          }
          candidates.push({
            id: p.id,
            name: name,
            manufacturer: manufacturer,
            model: model,
            category: safeStr(p, "category"),
            confidence: confidence
          });
        }
        candidates.sort(function(a, b) { return order[a.confidence] - order[b.confidence]; });
      } catch (_) {}

      return candidates.slice(0, 5);
    }

    function executeCreateProduct(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can create products." };
      }
      var name = String(args.name || "").trim();
      if (!name) {
        return { error: "missing_required", detail: "name is required" };
      }

      try {
        var collection = dao.findCollectionByNameOrId("products");
        var record = new Record(collection);
        record.set("name", name);
        record.set("category", args.category ? String(args.category) : "");
        record.set("manufacturer", args.manufacturer ? String(args.manufacturer) : "");
        record.set("model", args.model ? String(args.model) : "");
        record.set("description", args.description ? String(args.description) : "");
        record.set("url", args.url ? String(args.url) : "");
        record.set("specs", args.specs ? String(args.specs) : "");
        record.set("is_active", true);
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "products",
          record_id: record.id,
          actor: userId,
          action: "create",
          tool: "create_product"
        });

        return {
          success: true,
          record_id: record.id,
          name: name,
          description: "Created product: " + name + ". Note: undo is not available via MCP.",
          collection: "products"
        };
      } catch (err) {
        return { error: "create_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeCreateComponent(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can create components." };
      }
      var productId = String(args.product_id || "").trim();
      if (!productId) {
        return { error: "missing_required", detail: "product_id is required" };
      }

      var isBulk = args.is_bulk === true;
      var serial = String(args.serial || "").trim();
      var quantity = parseInt(args.quantity, 10);

      if (!isBulk && !serial) {
        return { error: "validation_error", detail: "serial is required when is_bulk=false" };
      }
      if (isBulk && (!quantity || quantity < 1)) {
        return { error: "validation_error", detail: "quantity (>=1) is required when is_bulk=true" };
      }

      try {
        dao.findRecordById("products", productId);
      } catch (_) {
        return { error: "not_found", detail: "product not found: " + productId };
      }

      try {
        var collection = dao.findCollectionByNameOrId("components");
        var record = new Record(collection);
        record.set("product", productId);
        record.set("serial", serial);
        record.set("is_bulk", isBulk);
        record.set("quantity", isBulk ? quantity : 0);
        record.set("notes", args.notes ? String(args.notes) : "");
        record.set("is_active", true);
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "components",
          record_id: record.id,
          actor: userId,
          action: "create",
          tool: "create_component"
        });

        return {
          success: true,
          record_id: record.id,
          serial: serial,
          is_bulk: isBulk,
          description: "Created component" + (serial ? ": " + serial : " (bulk, qty=" + quantity + ")") + ". Call move_component to place it. Note: undo is not available via MCP.",
          collection: "components"
        };
      } catch (err) {
        return { error: "create_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeMoveComponent(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can move components." };
      }
      var componentId = String(args.component_id || "").trim();
      if (!componentId) {
        return { error: "missing_required", detail: "component_id is required" };
      }
      var toKitId = args.to_kit_id ? String(args.to_kit_id).trim() : "";
      var toEntityId = args.to_entity_id ? String(args.to_entity_id).trim() : "";

      if (!toKitId && !toEntityId) {
        return { error: "validation_error", detail: "Exactly one of to_kit_id or to_entity_id is required" };
      }
      if (toKitId && toEntityId) {
        return { error: "validation_error", detail: "Provide only one of to_kit_id or to_entity_id, not both" };
      }

      var component;
      try {
        component = dao.findRecordById("components", componentId);
      } catch (_) {
        return { error: "not_found", detail: "component not found: " + componentId };
      }

      if (toKitId) {
        try { dao.findRecordById("kits", toKitId); } catch (_) {
          return { error: "not_found", detail: "kit not found: " + toKitId };
        }
      }
      if (toEntityId) {
        try { dao.findRecordById("entities", toEntityId); } catch (_) {
          return { error: "not_found", detail: "entity not found: " + toEntityId };
        }
      }

      var fromKitId = "";
      var fromEntityId = "";
      try {
        var prevTxns = dao.findRecordsByFilter(
          "component_transactions",
          "component = {:cid}",
          "-timestamp,-created",
          1,
          0,
          { cid: componentId }
        );
        if (prevTxns.length > 0) {
          fromKitId = safeStr(prevTxns[0], "to_kit") || "";
          fromEntityId = safeStr(prevTxns[0], "to_entity") || "";
        }
      } catch (_) {}

      var qty = 0;
      var isBulk = component.getBool ? component.getBool("is_bulk") : (safeStr(component, "is_bulk") === "true");
      if (isBulk) {
        var compQty = parseInt(safeStr(component, "quantity"), 10);
        qty = (args.quantity && parseInt(args.quantity, 10) > 0) ? parseInt(args.quantity, 10) : compQty;
      }

      try {
        var txCollection = dao.findCollectionByNameOrId("component_transactions");
        var txRecord = new Record(txCollection);
        txRecord.set("component", componentId);
        if (fromKitId) txRecord.set("from_kit", fromKitId);
        if (fromEntityId) txRecord.set("from_entity", fromEntityId);
        if (toKitId) txRecord.set("to_kit", toKitId);
        if (toEntityId) txRecord.set("to_entity", toEntityId);
        if (isBulk && qty > 0) txRecord.set("quantity", qty);
        txRecord.set("timestamp", new Date().toISOString());
        txRecord.set("notes", args.notes ? String(args.notes) : "MCP-executed component move");
        txRecord.set("created_by", userId);
        dao.save(txRecord);

        var destName = toKitId || toEntityId;
        try {
          if (toKitId) {
            var toKit = dao.findRecordById("kits", toKitId);
            destName = safeStr(toKit, "serial");
          } else if (toEntityId) {
            var toEnt = dao.findRecordById("entities", toEntityId);
            destName = safeStr(toEnt, "name");
          }
        } catch (_) {}

        var compSerial = safeStr(component, "serial") || componentId;

        saveMcpAuditLog(dao, {
          collection_name: "component_transactions",
          record_id: txRecord.id,
          actor: userId,
          action: "create",
          tool: "move_component"
        });

        return {
          success: true,
          record_id: txRecord.id,
          component_serial: compSerial,
          destination: destName,
          description: "Moved component " + compSerial + " to " + destName + ". Note: undo is not available via MCP — issue a reverse move_component.",
          collection: "component_transactions"
        };
      } catch (err) {
        return { error: "move_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeDecideRequest(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can decide requests." };
      }
      var requestId = String(args.request_id || "").trim();
      if (!requestId) {
        return { error: "missing_required", detail: "request_id is required" };
      }
      var decision = String(args.decision || "").trim();
      if (decision !== "approve" && decision !== "reject") {
        return { error: "validation_error", detail: "decision must be 'approve' or 'reject'" };
      }

      var request;
      try {
        request = dao.findRecordById("requests", requestId);
      } catch (_) {
        return { error: "not_found", detail: "request not found: " + requestId };
      }

      var newStatus = decision === "approve" ? "approved" : "rejected";

      try {
        request.set("status", newStatus);
        if (args.decision_notes) {
          request.set("decision_notes", String(args.decision_notes));
        }
        dao.save(request);

        saveMcpAuditLog(dao, {
          collection_name: "requests",
          record_id: requestId,
          actor: userId,
          action: "update",
          tool: "decide_request"
        });

        return {
          success: true,
          record_id: requestId,
          new_status: newStatus,
          description: "Request " + requestId + " " + newStatus + ". Note: fulfillment is a separate step. Undo not available via MCP.",
          collection: "requests"
        };
      } catch (err) {
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeLinkComponentToProduct(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can re-link components." };
      }
      var componentId = String(args.component_id || "").trim();
      var productId = String(args.product_id || "").trim();
      if (!componentId) {
        return { error: "missing_required", detail: "component_id is required" };
      }
      if (!productId) {
        return { error: "missing_required", detail: "product_id is required" };
      }

      var component;
      try {
        component = dao.findRecordById("components", componentId);
      } catch (_) {
        return { error: "not_found", detail: "component not found: " + componentId };
      }
      try {
        dao.findRecordById("products", productId);
      } catch (_) {
        return { error: "not_found", detail: "product not found: " + productId };
      }

      try {
        component.set("product", productId);
        dao.save(component);

        saveMcpAuditLog(dao, {
          collection_name: "components",
          record_id: componentId,
          actor: userId,
          action: "update",
          tool: "link_component_to_product"
        });

        var compSerial = safeStr(component, "serial") || componentId;
        return {
          success: true,
          record_id: componentId,
          component_serial: compSerial,
          new_product_id: productId,
          description: "Re-linked component " + compSerial + " to product " + productId + ". Note: undo is not available via MCP — call again with previous product_id.",
          collection: "components"
        };
      } catch (err) {
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function execute(toolName, args, dao, userId, userRole) {
      try {
        if (toolName === "list_kits") return executeListKits(dao, args);
        if (toolName === "get_kit") return executeGetKit(dao, args);
        if (toolName === "list_entities") return executeListEntities(dao, args);
        if (toolName === "get_entity") return executeGetEntity(dao, args);
        if (toolName === "list_requests") return executeListRequests(dao, args);
        if (toolName === "list_components") return executeListComponents(dao, args);
        if (toolName === "resolve_kit") return executeResolveKit(dao, args);
        if (toolName === "resolve_entity") return executeResolveEntity(dao, args);
        if (toolName === "create_entity") return executeCreateEntity(dao, args, userId, userRole);
        if (toolName === "create_kit") return executeCreateKit(dao, args, userId, userRole);
        if (toolName === "move_kit") return executeMoveKit(dao, args, userId, userRole);
        if (toolName === "resolve_product") return executeResolveProduct(dao, args);
        if (toolName === "create_product") return executeCreateProduct(dao, args, userId, userRole);
        if (toolName === "create_component") return executeCreateComponent(dao, args, userId, userRole);
        if (toolName === "move_component") return executeMoveComponent(dao, args, userId, userRole);
        if (toolName === "decide_request") return executeDecideRequest(dao, args, userId, userRole);
        if (toolName === "link_component_to_product") return executeLinkComponentToProduct(dao, args, userId, userRole);
        return { error: "unknown tool: " + toolName };
      } catch (err) {
        return { error: "tool execution error", detail: String(err && err.message ? err.message : err) };
      }
    }

    return { definitions: definitions, execute: execute };
  }

  // ===== JSON-RPC 2.0 dispatcher =====

  // Helper: build a JSON-RPC success response
  function rpcOk(id, result) {
    return { jsonrpc: "2.0", id: id, result: result };
  }

  // Helper: build a JSON-RPC error response
  function rpcErr(id, code, message) {
    return { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
  }

  try {
    var info = $apis.requestInfo(c);
    var auth = info.authRecord;
    if (!auth) {
      // Return JSON-RPC error (not HTTP 401) so MCP clients parse it correctly
      return c.json(401, rpcErr(null, -32600, "auth_required"));
    }

    var userId = auth.id;
    var userRole = auth.getString ? auth.getString("role") : (auth.role || "");

    // Parse JSON-RPC body
    var body = info.data || {};
    var rpcId = (body.id !== undefined && body.id !== null) ? body.id : null;
    var method = body.method ? String(body.method) : "";
    var params = body.params || {};

    if (!method) {
      return c.json(400, rpcErr(rpcId, -32600, "invalid_request: method is required"));
    }

    console.log("[ai_mcp] user=" + userId + " method=" + method);

    // ---- initialize ----
    if (method === "initialize") {
      return c.json(200, rpcOk(rpcId, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "kit-tracker-mcp", version: "0.1.0" }
      }));
    }

    // ---- notifications/initialized (no-op) ----
    if (method === "notifications/initialized") {
      // Notifications have no id; return 200 with no result body per spec
      return c.json(200, {});
    }

    // ---- ping ----
    if (method === "ping") {
      return c.json(200, rpcOk(rpcId, {}));
    }

    // ---- tools/list ----
    if (method === "tools/list") {
      var mcpTools = getMcpTools();
      return c.json(200, rpcOk(rpcId, { tools: mcpTools.definitions }));
    }

    // ---- tools/call ----
    if (method === "tools/call") {
      var toolName = params.name ? String(params.name) : "";
      var toolArgs = params.arguments || {};

      if (!toolName) {
        return c.json(200, rpcErr(rpcId, -32602, "invalid_params: name is required"));
      }

      var writeTool = (
        toolName === "create_entity" ||
        toolName === "create_kit" ||
        toolName === "move_kit" ||
        toolName === "create_product" ||
        toolName === "create_component" ||
        toolName === "move_component" ||
        toolName === "decide_request" ||
        toolName === "link_component_to_product"
      );

      // Permission gate for write tools
      if (writeTool && userRole !== "admin" && userRole !== "technician") {
        return c.json(200, rpcErr(rpcId, -32603, "permission_denied"));
      }

      var dao = $app.dao();
      var mcpTools2 = getMcpTools();
      var toolResult = mcpTools2.execute(toolName, toolArgs, dao, userId, userRole);

      // If the tool itself returned a permission_denied (shouldn't happen after the gate above,
      // but keep consistent with write tool internal checks), surface as JSON-RPC error.
      if (toolResult && toolResult.error === "permission_denied") {
        return c.json(200, rpcErr(rpcId, -32603, "permission_denied"));
      }

      var resultText = JSON.stringify(toolResult);
      var isError = !!(toolResult && toolResult.error);

      var mcpResult = {
        content: [{ type: "text", text: resultText }]
      };
      if (isError) {
        mcpResult.isError = true;
      }

      return c.json(200, rpcOk(rpcId, mcpResult));
    }

    // ---- method not found ----
    return c.json(200, rpcErr(rpcId, -32601, "method not found: " + method));

  } catch (err) {
    console.log("[ai_mcp] error: " + (err && err.message ? err.message : err));
    return c.json(500, rpcErr(null, -32603, "internal error: " + String(err && err.message ? err.message : err)));
  }
});
