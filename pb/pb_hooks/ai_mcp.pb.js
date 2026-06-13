/// <reference path="../pb_data/types.d.ts" />
// POST /api/mcp — MCP server (Streamable HTTP transport, JSON-RPC 2.0)
//
// Exposes 27 kit-tracker tools (14 read, 13 write) via the Model Context Protocol
// so any MCP client (Claude Code, Claude Desktop, Cursor, VS Code) can call them
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

  // ===== tool layer (inlined; PB v0.22 Goja isolation — see header comment) =====
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
            category: { type: "string", enum: ["storage", "field"], description: "'field' = in-use unit/site (default). 'storage' = warehouse/depot." },
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
            specs: { type: "string", description: "Optional specs (JSON string or plain text)" },
            reorder_point: { type: "number", description: "Optional low-stock threshold (>=0, integer). Surfaces low-stock badge on product detail when on-hand below this. 0 or omitted = no threshold." },
            is_consumable: { type: "boolean", description: "Optional flag for one-way inventory (tape, screws, adhesives) — components consumed not returned." },
            is_serialized: { type: "boolean", description: "Whether components of this product carry per-unit serials (true, default) or are tracked as bulk quantities (false). Omitting defaults to true to match the schema backfill." }
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
            notes: { type: "string", description: "Optional notes" },
            bin_code: { type: "string", description: "Optional shelf/bin location code within an entity, max 16 chars (e.g. 'A-12-03')" },
            lot_code: { type: "string", description: "Optional lot/batch code, max 32 chars" },
            expires_at: { type: "string", description: "Optional expiry date (ISO 8601: YYYY-MM-DD or full timestamp)" }
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
      },
      {
        name: "update_entity",
        description: "Update fields on an existing entity. Only specified fields are changed. Use for renaming, soft-deleting (is_active=false), reactivating (is_active=true), or fixing typos. Undo not available via MCP — issue a reverse update_entity. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Entity record ID (required)" },
            name: { type: "string", description: "New entity name" },
            category: { type: "string", enum: ["storage", "field"], description: "New category. 'field' = in-use; 'storage' = warehouse/depot." },
            description: { type: "string", description: "New description" },
            is_active: { type: "boolean", description: "Set to false to soft-delete, true to reactivate" }
          },
          required: ["id"]
        }
      },
      {
        name: "update_kit",
        description: "Update fields on an existing kit. Only specified fields are changed. Use for renaming, soft-deleting (is_active=false), reactivating (is_active=true), or fixing typos. Undo not available via MCP — issue a reverse update_kit. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Kit record ID (required)" },
            serial: { type: "string", description: "New serial number" },
            notes: { type: "string", description: "New notes" },
            tags: { type: "string", description: "New tags (comma-separated)" },
            is_active: { type: "boolean", description: "Set to false to soft-delete, true to reactivate" }
          },
          required: ["id"]
        }
      },
      {
        name: "update_product",
        description: "Update fields on an existing product. Only specified fields are changed. Use for renaming, soft-deleting (is_active=false), reactivating (is_active=true), or fixing typos. Undo not available via MCP — issue a reverse update_product. Only admin/technician can call this.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Product record ID (required)" },
            name: { type: "string", description: "New product name" },
            category: { type: "string", description: "New category" },
            manufacturer: { type: "string", description: "New manufacturer" },
            model: { type: "string", description: "New model identifier" },
            description: { type: "string", description: "New description" },
            url: { type: "string", description: "New URL" },
            specs: { type: "string", description: "New specs" },
            is_active: { type: "boolean", description: "Set to false to soft-delete, true to reactivate" },
            reorder_point: { type: "number", description: "New low-stock threshold (>=0, integer). Pass 0 to clear / disable." },
            is_consumable: { type: "boolean", description: "Set true to mark as one-way consumable inventory" }
          },
          required: ["id"]
        }
      },
      {
        name: "update_user_phone",
        description: "Set the phone number for a user (E.164 format). Admin can update any user; non-admin can only update self. Undo not available via MCP — issue a reverse update_user_phone. Only admin/technician+ can call this.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Target user email (required)" },
            phone: { type: "string", description: "Phone in E.164 format. Empty string clears." }
          },
          required: ["email", "phone"]
        }
      },
      {
        name: "update_user_telegram_chat_id",
        description: "Set the Telegram chat_id for a user. Used to bind a Telegram account to a user record for direct messaging. Admin can update any user; non-admin can only update self. Undo not available via MCP — issue a reverse update_user_telegram_chat_id. Only admin/technician+ can call this.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Target user email (required)" },
            telegram_chat_id: { type: "string", description: "Telegram chat_id (numeric string, e.g. '123456789'). Must be non-empty." }
          },
          required: ["email", "telegram_chat_id"]
        }
      },
      {
        name: "report_kits_by_entity",
        description: "Report how many active kits are currently at each entity, sorted by count descending. Use when user asks 'where are kits located', 'how many kits at each site', 'kit distribution'.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "report_recent_activity",
        description: "Return the last N kit transactions across all kits with expanded kit serial, entity names, and actor email. Use when user asks 'what happened recently', 'recent moves', 'activity log'.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of transactions to return (default 10, max 50)" }
          },
          required: []
        }
      },
      {
        name: "report_open_requests",
        description: "Return open and approved kit requests sorted by delivery_date ascending. Use when user asks 'what requests are pending', 'open requests', 'approved requests', 'upcoming deliveries'.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of requests to return (default 20, max 50)" }
          },
          required: []
        }
      },
      {
        name: "report_overdue_returns",
        description: "Return fulfilled requests where expected_return is in the past. Use when user asks 'what\\'s overdue', 'late returns', 'who hasn\\'t returned a kit', 'overdue kits'.",
        inputSchema: {
          type: "object",
          properties: {
            now: { type: "string", description: "ISO timestamp for 'now' (optional, defaults to current time; useful for testing)" }
          },
          required: []
        }
      },
      {
        name: "report_maintenance_due",
        description: "Return maintenance schedules due within N days from now. Use when user asks 'what maintenance is due', 'upcoming maintenance', 'overdue maintenance'.",
        inputSchema: {
          type: "object",
          properties: {
            days_ahead: { type: "number", description: "Look-ahead window in days (default 7)" }
          },
          required: []
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

      // Active components — derived from component_transactions (components has no kit field)
      var components = [];
      try {
        var incomingTx = dao.findRecordsByFilter(
          "component_transactions",
          "to_kit = {:kid}",
          "-timestamp,-created",
          500,
          0,
          { kid: kit.id }
        );
        var seenComp = {};
        var compIds = [];
        for (var ci = 0; ci < incomingTx.length; ci++) {
          var cid = incomingTx[ci].getString("component");
          if (cid && !seenComp[cid]) {
            seenComp[cid] = true;
            compIds.push(cid);
          }
        }
        for (var cj = 0; cj < compIds.length && components.length < 50; cj++) {
          var compId = compIds[cj];
          var comp;
          try { comp = dao.findRecordById("components", compId); } catch (_) { continue; }
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
          } catch (_) { continue; }
          if (!latestArr || !latestArr.length) continue;
          if (latestArr[0].getString("to_kit") !== kit.id) continue;
          var productId = safeStr(comp, "product");
          var productName = "";
          if (productId) {
            try { productName = safeStr(dao.findRecordById("products", productId), "name"); } catch (_) {}
          }
          components.push({
            id: comp.id,
            serial: safeStr(comp, "serial"),
            product_id: productId,
            product_name: productName,
            notes: safeStr(comp, "notes"),
            is_bulk: comp.getBool("is_bulk"),
            quantity: comp.getInt("quantity")
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
      // opts: { collection_name, record_id, actor, action, tool, changes? }
      try {
        var auditCollection = dao.findCollectionByNameOrId("audit_log");
        var auditRecord = new Record(auditCollection);
        auditRecord.set("collection_name", opts.collection_name);
        auditRecord.set("record_id", opts.record_id);
        auditRecord.set("actor", opts.actor);
        auditRecord.set("action", opts.action);
        var changesObj = { via: "mcp", tool: opts.tool };
        if (opts.changes) {
          changesObj.before = opts.changes.before;
          changesObj.after = opts.changes.after;
        }
        auditRecord.set("changes", JSON.stringify(changesObj));
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
        var cat = String(args.category || "").toLowerCase();
        record.set("category", cat === "storage" ? "storage" : "field");
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
        saveMcpAuditLog(dao, { collection_name: "entities", record_id: "", actor: userId, action: "create_failed", tool: "create_entity", changes: { error_detail: String(err) } });
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
        saveMcpAuditLog(dao, { collection_name: "kits", record_id: "", actor: userId, action: "create_failed", tool: "create_kit", changes: { error_detail: String(err) } });
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

      // No-op if kit is already at the requested destination (B-G3-1)
      if (currentEntity.id === toEntityId) {
        var kitSerial0 = "";
        try { kitSerial0 = kit.getString ? kit.getString("serial") : ""; } catch (_) {}
        var toEntityName0 = "";
        try {
          var toEnt0 = dao.findRecordById("entities", toEntityId);
          toEntityName0 = toEnt0.getString ? toEnt0.getString("name") : toEntityId;
        } catch (_) { toEntityName0 = toEntityId; }
        return {
          ok: true,
          no_op: true,
          message: "Kit " + kitSerial0 + " already at " + toEntityName0 + " — no transaction created."
        };
      }

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
        saveMcpAuditLog(dao, { collection_name: "transactions", record_id: "", actor: userId, action: "create_failed", tool: "move_kit", changes: { error_detail: String(err) } });
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
        if (args.reorder_point !== undefined && args.reorder_point !== null) {
          var rp = parseInt(args.reorder_point, 10);
          if (!isNaN(rp) && rp >= 0) record.set("reorder_point", rp);
        }
        if (args.is_consumable !== undefined) {
          record.set("is_consumable", args.is_consumable === true);
        }
        // Honor caller-supplied is_serialized. Default true to match the
        // 1778960000 migration's backfill default for products with no
        // linked components — otherwise the downstream
        // components_product_serialized_check hook rejects any
        // create_component call that includes a serial.
        record.set("is_serialized", args.is_serialized === false ? false : true);
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
        saveMcpAuditLog(dao, { collection_name: "products", record_id: "", actor: userId, action: "create_failed", tool: "create_product", changes: { error_detail: String(err) } });
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
        record.set("quantity", isBulk ? quantity : null);
        record.set("notes", args.notes ? String(args.notes) : "");
        record.set("is_active", true);
        if (args.bin_code !== undefined) record.set("bin_code", String(args.bin_code));
        if (args.lot_code !== undefined) record.set("lot_code", String(args.lot_code));
        if (args.expires_at !== undefined && String(args.expires_at).trim() !== "") {
          record.set("expires_at", String(args.expires_at));
        }
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
        saveMcpAuditLog(dao, { collection_name: "components", record_id: "", actor: userId, action: "create_failed", tool: "create_component", changes: { error_detail: String(err) } });
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

      // No-op if component is already at the requested destination (B-G3-1 symmetry with move_kit).
      // Prevents duplicate component_transactions across repeat MCP calls.
      if ((toKitId && fromKitId === toKitId) || (toEntityId && fromEntityId === toEntityId)) {
        var compSerial0 = safeStr(component, "serial") || componentId;
        var destName0 = toKitId || toEntityId;
        try {
          if (toKitId) {
            var toKit0 = dao.findRecordById("kits", toKitId);
            destName0 = safeStr(toKit0, "serial") || toKitId;
          } else if (toEntityId) {
            var toEnt0 = dao.findRecordById("entities", toEntityId);
            destName0 = safeStr(toEnt0, "name") || toEntityId;
          }
        } catch (_) {}
        return {
          ok: true,
          no_op: true,
          message: "Component " + compSerial0 + " already at " + destName0 + " — no transaction created."
        };
      }

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
        saveMcpAuditLog(dao, { collection_name: "component_transactions", record_id: "", actor: userId, action: "create_failed", tool: "move_component", changes: { error_detail: String(err) } });
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

      // No-op if the request is already in the target status (symmetry with the
      // move_kit / move_component no-op guards). Without the check, a repeat MCP
      // call writes a redundant audit_log row each time.
      var currentStatus = safeStr(request, "status");
      if (currentStatus === newStatus) {
        return {
          ok: true,
          no_op: true,
          message: "Request " + requestId + " already " + newStatus + " — no change made."
        };
      }

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
        saveMcpAuditLog(dao, { collection_name: "requests", record_id: requestId, actor: userId, action: "update_failed", tool: "decide_request", changes: { error_detail: String(err) } });
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

      // No-op if the component is already linked to the target product (symmetry
      // with the move_kit / move_component / decide_request no-op guards).
      // Without the check, a repeat MCP call writes a redundant audit_log row.
      var currentProductId = safeStr(component, "product");
      if (currentProductId === productId) {
        var compSerialNoop = safeStr(component, "serial") || componentId;
        return {
          ok: true,
          no_op: true,
          message: "Component " + compSerialNoop + " already linked to product " + productId + " — no change made."
        };
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
        saveMcpAuditLog(dao, { collection_name: "components", record_id: componentId, actor: userId, action: "update_failed", tool: "link_component_to_product", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeUpdateEntity(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can update entities." };
      }
      var id = String(args.id || "").trim();
      if (!id) {
        return { error: "missing_required", detail: "id is required" };
      }
      var mutableFields = ["name", "category", "description", "is_active"];
      var hasUpdate = false;
      for (var fi = 0; fi < mutableFields.length; fi++) {
        if (args[mutableFields[fi]] !== undefined) { hasUpdate = true; break; }
      }
      if (!hasUpdate) {
        return { error: "no_fields_to_update", detail: "no fields to update" };
      }

      var record;
      try {
        record = dao.findRecordById("entities", id);
      } catch (_) {
        return { error: "not_found", detail: "entity not found: " + id };
      }

      var before = {};
      var after = {};
      if (args.name !== undefined) {
        before.name = safeStr(record, "name");
        record.set("name", String(args.name));
        after.name = String(args.name);
      }
      if (args.category !== undefined) {
        before.category = safeStr(record, "category");
        var newCat = String(args.category).toLowerCase();
        var safeCat = newCat === "storage" ? "storage" : "field";
        record.set("category", safeCat);
        after.category = safeCat;
      }
      if (args.description !== undefined) {
        before.description = safeStr(record, "description");
        record.set("description", String(args.description));
        after.description = String(args.description);
      }
      if (args.is_active !== undefined) {
        before.is_active = record.getBool ? record.getBool("is_active") : (safeStr(record, "is_active") === "true");
        record.set("is_active", args.is_active === true);
        after.is_active = args.is_active === true;
      }

      var entityNoOp = true;
      for (var ebk in before) {
        if (Object.prototype.hasOwnProperty.call(before, ebk)) {
          if (before[ebk] !== after[ebk]) { entityNoOp = false; break; }
        }
      }
      if (entityNoOp) {
        return {
          ok: true,
          no_op: true,
          message: "Entity " + id + " already matches the requested values; no update performed"
        };
      }

      try {
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "entities",
          record_id: id,
          actor: userId,
          action: "update",
          tool: "update_entity",
          changes: { before: before, after: after }
        });

        return {
          success: true,
          record_id: id,
          before: before,
          after: after,
          description: "Updated entity: " + id + ". Note: undo is not available via MCP — issue a reverse update_entity.",
          collection: "entities"
        };
      } catch (err) {
        saveMcpAuditLog(dao, { collection_name: "entities", record_id: id, actor: userId, action: "update_failed", tool: "update_entity", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeUpdateKit(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can update kits." };
      }
      var id = String(args.id || "").trim();
      if (!id) {
        return { error: "missing_required", detail: "id is required" };
      }
      var mutableFields = ["serial", "notes", "tags", "is_active"];
      var hasUpdate = false;
      for (var fi = 0; fi < mutableFields.length; fi++) {
        if (args[mutableFields[fi]] !== undefined) { hasUpdate = true; break; }
      }
      if (!hasUpdate) {
        return { error: "no_fields_to_update", detail: "no fields to update" };
      }

      var record;
      try {
        record = dao.findRecordById("kits", id);
      } catch (_) {
        return { error: "not_found", detail: "kit not found: " + id };
      }

      var before = {};
      var after = {};
      if (args.serial !== undefined) {
        before.serial = safeStr(record, "serial");
        record.set("serial", String(args.serial));
        after.serial = String(args.serial);
      }
      if (args.notes !== undefined) {
        before.notes = safeStr(record, "notes");
        record.set("notes", String(args.notes));
        after.notes = String(args.notes);
      }
      if (args.tags !== undefined) {
        before.tags = safeStr(record, "tags");
        record.set("tags", String(args.tags));
        after.tags = String(args.tags);
      }
      if (args.is_active !== undefined) {
        before.is_active = record.getBool ? record.getBool("is_active") : (safeStr(record, "is_active") === "true");
        record.set("is_active", args.is_active === true);
        after.is_active = args.is_active === true;
      }

      try {
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "kits",
          record_id: id,
          actor: userId,
          action: "update",
          tool: "update_kit",
          changes: { before: before, after: after }
        });

        return {
          success: true,
          record_id: id,
          before: before,
          after: after,
          description: "Updated kit: " + id + ". Note: undo is not available via MCP — issue a reverse update_kit.",
          collection: "kits"
        };
      } catch (err) {
        saveMcpAuditLog(dao, { collection_name: "kits", record_id: id, actor: userId, action: "update_failed", tool: "update_kit", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeUpdateProduct(dao, args, userId, userRole) {
      if (userRole !== "admin" && userRole !== "technician") {
        return { error: "permission_denied", detail: "Only admin or technician can update products." };
      }
      var id = String(args.id || "").trim();
      if (!id) {
        return { error: "missing_required", detail: "id is required" };
      }
      var mutableFields = ["name", "category", "manufacturer", "model", "description", "url", "specs", "is_active", "reorder_point", "is_consumable"];
      var hasUpdate = false;
      for (var fi = 0; fi < mutableFields.length; fi++) {
        if (args[mutableFields[fi]] !== undefined) { hasUpdate = true; break; }
      }
      if (!hasUpdate) {
        return { error: "no_fields_to_update", detail: "no fields to update" };
      }

      var record;
      try {
        record = dao.findRecordById("products", id);
      } catch (_) {
        return { error: "not_found", detail: "product not found: " + id };
      }

      var before = {};
      var after = {};
      var strFields = ["name", "category", "manufacturer", "model", "description", "url", "specs"];
      for (var si = 0; si < strFields.length; si++) {
        var sf = strFields[si];
        if (args[sf] !== undefined) {
          before[sf] = safeStr(record, sf);
          record.set(sf, String(args[sf]));
          after[sf] = String(args[sf]);
        }
      }
      if (args.is_active !== undefined) {
        before.is_active = record.getBool ? record.getBool("is_active") : (safeStr(record, "is_active") === "true");
        record.set("is_active", args.is_active === true);
        after.is_active = args.is_active === true;
      }
      if (args.reorder_point !== undefined) {
        before.reorder_point = record.getInt ? record.getInt("reorder_point") : parseInt(safeStr(record, "reorder_point"), 10) || 0;
        var newRp = parseInt(args.reorder_point, 10);
        if (isNaN(newRp) || newRp < 0) newRp = 0;
        record.set("reorder_point", newRp);
        after.reorder_point = newRp;
      }
      if (args.is_consumable !== undefined) {
        before.is_consumable = record.getBool ? record.getBool("is_consumable") : (safeStr(record, "is_consumable") === "true");
        record.set("is_consumable", args.is_consumable === true);
        after.is_consumable = args.is_consumable === true;
      }

      try {
        dao.save(record);

        saveMcpAuditLog(dao, {
          collection_name: "products",
          record_id: id,
          actor: userId,
          action: "update",
          tool: "update_product",
          changes: { before: before, after: after }
        });

        return {
          success: true,
          record_id: id,
          before: before,
          after: after,
          description: "Updated product: " + id + ". Note: undo is not available via MCP — issue a reverse update_product.",
          collection: "products"
        };
      } catch (err) {
        saveMcpAuditLog(dao, { collection_name: "products", record_id: id, actor: userId, action: "update_failed", tool: "update_product", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeUpdateUserPhone(dao, args, userId, userRole) {
      var email = String(args.email || "").trim();
      if (!email) {
        return { error: "missing_required", detail: "email is required" };
      }
      var newPhone = String(args.phone === undefined ? "" : args.phone).trim();
      var target;
      try {
        var matches = dao.findRecordsByFilter("users", "email = {:e}", "", 1, 0, { e: email });
        if (matches && matches.length > 0) target = matches[0];
      } catch (_) {}
      if (!target) {
        return { error: "not_found", detail: "no user with email: " + email };
      }
      if (userRole !== "admin" && target.id !== userId) {
        return { error: "permission_denied", detail: "Only admin can update another user's phone." };
      }
      var currentPhone = target.getString ? target.getString("phone") : "";
      if (currentPhone === newPhone) {
        return {
          ok: true,
          no_op: true,
          message: "phone for " + email + " is already " + (newPhone || "(empty)") + "; no update performed"
        };
      }
      var before = { phone: currentPhone };
      target.set("phone", newPhone);
      try {
        dao.save(target);
        saveMcpAuditLog(dao, {
          collection_name: "users",
          record_id: target.id,
          actor: userId,
          action: "update",
          tool: "update_user_phone",
          changes: { before: before, after: { phone: newPhone } }
        });
        return {
          success: true,
          record_id: target.id,
          email: email,
          before: before,
          after: { phone: newPhone },
          description: "Updated phone for " + email + ". Note: undo is not available via MCP — issue a reverse update_user_phone."
        };
      } catch (err) {
        saveMcpAuditLog(dao, { collection_name: "users", record_id: target.id, actor: userId, action: "update_failed", tool: "update_user_phone", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeUpdateUserTelegramChatId(dao, args, userId, userRole) {
      var email = String(args.email || "").trim();
      if (!email) {
        return { error: "missing_required", detail: "email is required" };
      }
      var rawChatId = String(args.telegram_chat_id === undefined ? "" : args.telegram_chat_id);
      var newChatId = rawChatId.trim();
      if (!newChatId) {
        return { error: "invalid_input", detail: "telegram_chat_id must not be empty or whitespace-only" };
      }
      var target;
      try {
        var matches = dao.findRecordsByFilter("users", "email = {:e}", "", 1, 0, { e: email });
        if (matches && matches.length > 0) target = matches[0];
      } catch (_) {}
      if (!target) {
        return { error: "not_found", detail: "no user with email: " + email };
      }
      if (userRole !== "admin" && target.id !== userId) {
        return { error: "permission_denied", detail: "Only admin can update another user's telegram_chat_id." };
      }
      var currentChatId = target.getString ? target.getString("telegram_chat_id") : "";
      if (currentChatId === newChatId) {
        return {
          ok: true,
          no_op: true,
          message: "telegram_chat_id for " + email + " is already " + newChatId + "; no update performed"
        };
      }
      var before = { telegram_chat_id: currentChatId };
      target.set("telegram_chat_id", newChatId);
      try {
        dao.save(target);
        saveMcpAuditLog(dao, {
          collection_name: "users",
          record_id: target.id,
          actor: userId,
          action: "update",
          tool: "update_user_telegram_chat_id",
          changes: { before: before, after: { telegram_chat_id: newChatId } }
        });
        return {
          success: true,
          record_id: target.id,
          email: email,
          before: before,
          after: { telegram_chat_id: newChatId },
          description: "Updated telegram_chat_id for " + email + ". Note: undo is not available via MCP — issue a reverse update_user_telegram_chat_id."
        };
      } catch (err) {
        saveMcpAuditLog(dao, { collection_name: "users", record_id: target.id, actor: userId, action: "update_failed", tool: "update_user_telegram_chat_id", changes: { error_detail: String(err) } });
        return { error: "update_failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeReportKitsByEntity(dao) {
      try {
        var kits = dao.findRecordsByFilter("kits", "is_active = true", "serial", 500, 0, {});
        var entityMap = {};
        for (var i = 0; i < kits.length; i++) {
          var k = kits[i];
          var ce = kitCurrentEntity(dao, k.id);
          var eid = ce.id || "__unassigned__";
          var ename = ce.name || "(unassigned)";
          if (!entityMap[eid]) {
            entityMap[eid] = { id: eid, name: ename, kit_count: 0, sample_serials: [] };
          }
          entityMap[eid].kit_count++;
          if (entityMap[eid].sample_serials.length < 5) {
            entityMap[eid].sample_serials.push(safeStr(k, "serial"));
          }
        }
        var entities = [];
        var keys = Object.keys(entityMap);
        for (var j = 0; j < keys.length; j++) {
          entities.push(entityMap[keys[j]]);
        }
        entities.sort(function(a, b) { return b.kit_count - a.kit_count; });
        return { entities: entities };
      } catch (err) {
        return { error: "report_kits_by_entity failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeReportRecentActivity(dao, args) {
      try {
        var limit = clamp(args.limit, 10, 50);
        var txns = dao.findRecordsByFilter("transactions", "id != ''", "-timestamp,-created", limit, 0, {});
        var results = [];
        for (var i = 0; i < txns.length; i++) {
          var tx = txns[i];
          var kitSerial = "";
          var kitId = safeStr(tx, "kit");
          if (kitId) {
            try { kitSerial = safeStr(dao.findRecordById("kits", kitId), "serial"); } catch (_) {}
          }
          var fromName = "";
          var fromId = safeStr(tx, "from_entity");
          if (fromId) {
            try { fromName = safeStr(dao.findRecordById("entities", fromId), "name"); } catch (_) {}
          }
          var toName = "";
          var toId = safeStr(tx, "to_entity");
          if (toId) {
            try { toName = safeStr(dao.findRecordById("entities", toId), "name"); } catch (_) {}
          }
          var actorEmail = "";
          var actorId = safeStr(tx, "created_by");
          if (actorId) {
            try { actorEmail = safeStr(dao.findRecordById("users", actorId), "email"); } catch (_) {}
          }
          results.push({
            id: tx.id,
            timestamp: safeStr(tx, "timestamp"),
            kit_serial: kitSerial,
            from_entity: fromName,
            to_entity: toName,
            actor_email: actorEmail,
            notes: safeStr(tx, "notes")
          });
        }
        return { transactions: results };
      } catch (err) {
        return { error: "report_recent_activity failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeReportOpenRequests(dao, args) {
      try {
        var limit = clamp(args.limit, 20, 50);
        var reqs = dao.findRecordsByFilter(
          "requests",
          "status = 'open' || status = 'approved'",
          "delivery_date",
          limit,
          0,
          {}
        );
        var results = [];
        for (var i = 0; i < reqs.length; i++) {
          var r = reqs[i];
          var requesterEmail = "";
          var rid = safeStr(r, "requester");
          if (rid) {
            try { requesterEmail = safeStr(dao.findRecordById("users", rid), "email"); } catch (_) {}
          }
          var kitSerial = "";
          var kid = safeStr(r, "designated_kit");
          if (kid) {
            try { kitSerial = safeStr(dao.findRecordById("kits", kid), "serial"); } catch (_) {}
          }
          var targetEntityName = "";
          var eid = safeStr(r, "target_entity");
          if (eid) {
            try { targetEntityName = safeStr(dao.findRecordById("entities", eid), "name"); } catch (_) {}
          }
          results.push({
            id: r.id,
            status: safeStr(r, "status"),
            requester_email: requesterEmail,
            delivery_date: safeStr(r, "delivery_date"),
            kit_serial: kitSerial,
            target_entity_name: targetEntityName,
            notes: safeStr(r, "notes")
          });
        }
        return { requests: results };
      } catch (err) {
        return { error: "report_open_requests failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeReportOverdueReturns(dao, args) {
      try {
        var nowDate = args.now ? String(args.now).slice(0, 10) : new Date().toISOString().slice(0, 10);
        var overdueReqs = dao.findRecordsByFilter(
          "requests",
          "status = 'fulfilled' && expected_return != '' && expected_return < {:today}",
          "-expected_return",
          100,
          0,
          { today: nowDate }
        );
        var overdue = [];
        for (var i = 0; i < overdueReqs.length; i++) {
          var r = overdueReqs[i];
          var expectedReturn = safeStr(r, "expected_return");
          var kitSerial = "";
          var currentEntityName = "";
          var kid = safeStr(r, "designated_kit");
          if (kid) {
            try {
              var kit = dao.findRecordById("kits", kid);
              kitSerial = safeStr(kit, "serial");
              var ce = kitCurrentEntity(dao, kit.id);
              currentEntityName = ce.name;
            } catch (_) {}
          }
          var requesterEmail = "";
          var rid = safeStr(r, "requester");
          if (rid) {
            try { requesterEmail = safeStr(dao.findRecordById("users", rid), "email"); } catch (_) {}
          }
          var dueMs = new Date(expectedReturn).getTime();
          var nowMs = new Date(nowDate).getTime();
          var daysOverdue = isNaN(dueMs) ? 0 : Math.floor((nowMs - dueMs) / 86400000);
          overdue.push({
            kit_serial: kitSerial,
            current_entity_name: currentEntityName,
            expected_return: expectedReturn,
            days_overdue: daysOverdue,
            requester_email: requesterEmail
          });
        }
        return { overdue: overdue };
      } catch (err) {
        return { error: "report_overdue_returns failed", detail: String(err && err.message ? err.message : err) };
      }
    }

    function executeReportMaintenanceDue(dao, args) {
      try {
        var daysAhead = args.days_ahead ? parseInt(args.days_ahead, 10) : 7;
        if (isNaN(daysAhead) || daysAhead < 0) daysAhead = 7;
        var horizon = new Date();
        horizon.setDate(horizon.getDate() + daysAhead);
        var horizonStr = horizon.toISOString().slice(0, 10);
        var todayStr = new Date().toISOString().slice(0, 10);
        var schedules = [];
        try {
          schedules = dao.findRecordsByFilter(
            "kit_maintenance_schedules",
            "is_active = true && next_due_at <= {:horizon}",
            "next_due_at",
            100,
            0,
            { horizon: horizonStr }
          );
        } catch (_) {
          return { due: [], note: "kit_maintenance_schedules collection not available" };
        }
        var due = [];
        for (var i = 0; i < schedules.length; i++) {
          var s = schedules[i];
          var kitSerial = "";
          try {
            var kit = dao.findRecordById("kits", safeStr(s, "kit"));
            if (!kit || !kit.getBool("is_active")) continue;
            kitSerial = safeStr(kit, "serial");
          } catch (_) { continue; }
          var nextDueAt = safeStr(s, "next_due_at");
          var dueMs = new Date(nextDueAt).getTime();
          var nowMs = new Date(todayStr).getTime();
          var daysUntilDue = isNaN(dueMs) ? 0 : Math.floor((dueMs - nowMs) / 86400000);
          due.push({
            kit_serial: kitSerial,
            kms_type: safeStr(s, "type"),
            next_due_at: nextDueAt,
            days_until_due: daysUntilDue,
            notes: safeStr(s, "description")
          });
        }
        return { due: due };
      } catch (err) {
        return { error: "report_maintenance_due failed", detail: String(err && err.message ? err.message : err) };
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
        if (toolName === "update_entity") return executeUpdateEntity(dao, args, userId, userRole);
        if (toolName === "update_kit") return executeUpdateKit(dao, args, userId, userRole);
        if (toolName === "update_product") return executeUpdateProduct(dao, args, userId, userRole);
        if (toolName === "update_user_phone") return executeUpdateUserPhone(dao, args, userId, userRole);
        if (toolName === "update_user_telegram_chat_id") return executeUpdateUserTelegramChatId(dao, args, userId, userRole);
        if (toolName === "report_kits_by_entity") return executeReportKitsByEntity(dao);
        if (toolName === "report_recent_activity") return executeReportRecentActivity(dao, args);
        if (toolName === "report_open_requests") return executeReportOpenRequests(dao, args);
        if (toolName === "report_overdue_returns") return executeReportOverdueReturns(dao, args);
        if (toolName === "report_maintenance_due") return executeReportMaintenanceDue(dao, args);
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

    // T6: tag audit rows from this handler as "mcp". Non-overwrite guard per spec.
    try {
      if (!c.get("audit_via")) c.set("audit_via", "mcp");
    } catch (_) {}

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
        toolName === "link_component_to_product" ||
        toolName === "update_entity" ||
        toolName === "update_kit" ||
        toolName === "update_product" ||
        toolName === "update_user_phone" ||
        toolName === "update_user_telegram_chat_id"
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
