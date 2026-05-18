/// <reference path="../pb_data/types.d.ts" />
// POST /api/admin/revert-transaction
//
// Hard-deletes the latest transaction for a kit (DAO-level bypass of
// append-only REST deleteRule=null). Only the most-recent transaction
// (highest timestamp,created) may be reverted — enforced server-side.
// Writes an audit_log row with action="delete" before the deletion.
//
// Requires role = "admin".
// Body: { "kit_id": "...", "transaction_id": "..." }
// Returns: { "deleted": true, "transaction_id": "..." }
//
// NOTE: PB v0.22 Goja isolation — all logic is inlined in one routerAdd callback.

routerAdd("POST", "/api/admin/revert-transaction", function(c) {
  var dao = $app.dao();

  // Auth check — must be admin
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  var actorId = info.authRecord.id;

  // Parse body via info.data (PB v0.22 pattern)
  var body = info.data || {};
  var kitId         = (body.kit_id         || "").toString();
  var transactionId = (body.transaction_id || "").toString();

  if (!kitId || !transactionId) {
    return c.json(400, { error: "kit_id and transaction_id are required" });
  }

  // Fetch the transaction
  var txRecord;
  try {
    txRecord = dao.findRecordById("transactions", transactionId);
  } catch(_) {
    return c.json(400, { error: "transaction not found" });
  }

  // Verify cross-kit injection: transaction.kit must equal kit_id
  if (txRecord.getString("kit") !== kitId) {
    return c.json(400, { error: "transaction does not belong to this kit" });
  }

  // Find the latest transaction for this kit (highest timestamp, then created)
  var latestRows;
  try {
    latestRows = dao.findRecordsByFilter(
      "transactions",
      "kit = {:kid}",
      "-timestamp,-created",
      1,
      0,
      { kid: kitId }
    );
  } catch(e) {
    return c.json(500, { error: "failed to query transactions: " + String(e) });
  }

  if (!latestRows || latestRows.length === 0) {
    return c.json(400, { error: "no transactions found for this kit" });
  }

  var latestTx = latestRows[0];
  if (latestTx.id !== transactionId) {
    return c.json(400, { error: "Only the latest transaction may be reverted" });
  }

  // Build snapshot BEFORE delete (for audit log)
  var snapshot = { id: txRecord.id };
  try {
    var fields = txRecord.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f && f.name) {
        snapshot[f.name] = txRecord.get(f.name);
      }
    }
  } catch(_) {}

  // Write audit log BEFORE delete
  try {
    var auditCol = dao.findCollectionByNameOrId("audit_log");
    var auditRecord = new Record(auditCol, {
      collection_name: "transactions",
      record_id:       transactionId,
      actor:           actorId,
      action:          "delete",
      changes:         JSON.stringify({
        before: snapshot,
        via:    "web",
        revert: true
      })
    });
    dao.saveRecord(auditRecord);
  } catch(auditErr) {
    console.log("[admin_revert_transaction] AUDIT WRITE FAILED — aborting:", auditErr);
    return c.json(500, { error: "audit_write_failed", detail: String(auditErr && auditErr.message ? auditErr.message : auditErr) });
  }

  // Hard-delete via DAO (bypasses REST deleteRule=null)
  try {
    dao.deleteRecord(txRecord);
  } catch(delErr) {
    console.log("[admin_revert_transaction] delete failed:", delErr);
    return c.json(500, { error: "delete failed: " + String(delErr && delErr.message ? delErr.message : delErr) });
  }

  return c.json(200, { deleted: true, transaction_id: transactionId });

}, $apis.requireRecordAuth());
