/// <reference path="../pb_data/types.d.ts" />
// GET /api/scan/:kitId
//
// Public endpoint — no auth required. Returns a sanitized subset of kit info
// for QR-code scan landing pages. Lookup by PB record ID or serial number.
// Resolves current holder via latest transaction (DAO bypass of collection rules).
//
// Returns: { serial, holder, tags }
// 404 if kit not found or retired.
//
// NOTE: PB v0.22 Goja isolation — all logic is inlined in one routerAdd callback.

routerAdd("GET", "/api/scan/:kitId", function(c) {
  var dao = $app.dao();
  var kitId = c.pathParam("kitId");

  // Lookup by record ID first, then fall back to serial
  var kit;
  try {
    kit = dao.findRecordById("kits", kitId);
  } catch(_) {
    try {
      kit = dao.findFirstRecordByFilter("kits", "serial = {:s}", { s: kitId });
    } catch(__) {
      return c.json(404, { error: "kit not found" });
    }
  }

  if (!kit.getBool("is_active")) {
    return c.json(404, { error: "kit retired" });
  }

  // Resolve current holder via latest transaction
  var holderName = "";
  try {
    var rows = dao.findRecordsByFilter(
      "transactions",
      "kit = {:k}",
      "-timestamp,-created",
      1,
      0,
      { k: kit.id }
    );
    if (rows && rows.length > 0) {
      var toEntityId = rows[0].getString("to_entity");
      if (toEntityId) {
        try {
          var entity = dao.findRecordById("entities", toEntityId);
          holderName = entity.getString("name");
        } catch(_) {}
      }
    }
  } catch(_) {}

  return c.json(200, {
    serial: kit.getString("serial"),
    holder: holderName,
    tags: kit.getString("tags") || "",
  });
});
