/// <reference path="../pb_data/types.d.ts" />
// POST /api/admin/cascade-delete/preview  — returns blocker counts + row counts for a record
// POST /api/admin/cascade-delete          — cascade hard-deletes a record with audit trail
//
// Whitelisted collections: kits, entities, components, transactions
// Both routes require role = "admin".
// Audit row is written BEFORE any deletion.
// No rollback mechanism: on partial failure a second audit row with action
// "cascade_partial" is written and 500 is returned.
//
// NOTE: PB v0.22 Goja isolation — all helpers are inlined inside each routerAdd callback.

// ───────────────────────────────────────────────
// Preview endpoint
// ───────────────────────────────────────────────
routerAdd("POST", "/api/admin/cascade-delete/preview", function(c) {
  var dao = $app.dao();

  // Auth check
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.get("role") !== "admin") {
    return c.json(403, { error: "forbidden" });
  }

  // Parse body via info.data (PB v0.22 pattern)
  var body = info.data || {};
  var collection = (body.collection || "").toString();
  var recordId   = (body.record_id  || "").toString();

  // Whitelist
  var allowed = { kits: true, entities: true, components: true, transactions: true };
  if (!allowed[collection]) {
    return c.json(400, { error: "invalid_collection" });
  }

  // Fetch record
  var record;
  try {
    record = dao.findRecordById(collection, recordId);
  } catch(_) {
    return c.json(400, { error: "not_found" });
  }

  // Identify field + value
  var identifierField, identifierValue;
  if (collection === "kits") {
    identifierField = "serial";
    identifierValue = record.getString("serial");
  } else if (collection === "entities") {
    identifierField = "name";
    identifierValue = record.getString("name");
  } else if (collection === "components") {
    var compSerial = record.getString("serial");
    if (compSerial) {
      identifierField = "serial";
      identifierValue = compSerial;
    } else {
      identifierField = "id";
      identifierValue = record.id;
    }
  } else {
    // transactions
    identifierField = "id";
    identifierValue = record.id;
  }

  // ---- entity: check blockers ----
  if (collection === "entities") {
    var blockers = [];
    var blocked = false;

    // transactions FROM or TO this entity
    try {
      var txRows = dao.findRecordsByFilter(
        "transactions",
        "from_entity = {:eid} || to_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (txRows.length > 0) {
        blocked = true;
        var sampleTx = [];
        for (var ti = 0; ti < Math.min(3, txRows.length); ti++) {
          sampleTx.push(txRows[ti].id);
        }
        blockers.push({ collection: "transactions", count: txRows.length, sample_ids: sampleTx });
      }
    } catch(_) {}

    // requests targeting this entity
    try {
      var reqRows = dao.findRecordsByFilter(
        "requests",
        "target_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (reqRows.length > 0) {
        blocked = true;
        var sampleReq = [];
        for (var ri = 0; ri < Math.min(3, reqRows.length); ri++) {
          sampleReq.push(reqRows[ri].id);
        }
        blockers.push({ collection: "requests", count: reqRows.length, sample_ids: sampleReq });
      }
    } catch(_) {}

    // component_transactions FROM or TO this entity
    try {
      var ctFromRows = dao.findRecordsByFilter(
        "component_transactions",
        "from_entity = {:eid} || to_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (ctFromRows.length > 0) {
        blocked = true;
        var sampleCt = [];
        for (var cti = 0; cti < Math.min(3, ctFromRows.length); cti++) {
          sampleCt.push(ctFromRows[cti].id);
        }
        blockers.push({ collection: "component_transactions", count: ctFromRows.length, sample_ids: sampleCt });
      }
    } catch(_) {}

    // users with entity field pointing here (optional field — may not exist)
    try {
      var userRows = dao.findRecordsByFilter(
        "users",
        "entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (userRows.length > 0) {
        blocked = true;
        blockers.push({ collection: "users", count: userRows.length });
      }
    } catch(_) {
      // users collection may not have entity field — skip silently
    }

    return c.json(200, {
      collection:       collection,
      record_id:        recordId,
      identifier_field: identifierField,
      identifier_value: identifierValue,
      blocked:          blocked,
      blockers:         blocked ? blockers : [],
      counts:           blocked ? {} : { entities: 1 }
    });
  }

  // ---- kits: compute cascade counts ----
  if (collection === "kits") {
    var counts = { kits: 1, transactions: 0, components: 0,
                   component_transactions: 0,
                   kit_maintenance_schedules: 0, maintenance_records: 0 };

    try {
      var compRecs = dao.findRecordsByFilter(
        "components", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      counts.components = compRecs.length;

      for (var ci2 = 0; ci2 < compRecs.length; ci2++) {
        try {
          var ctRows = dao.findRecordsByFilter(
            "component_transactions", "component = {:cid}", "", 0, 0, { cid: compRecs[ci2].id }
          );
          counts.component_transactions += ctRows.length;
        } catch(_) {}
      }
    } catch(_) {}

    try {
      var schedRecs = dao.findRecordsByFilter(
        "kit_maintenance_schedules", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      counts.kit_maintenance_schedules = schedRecs.length;

      for (var si = 0; si < schedRecs.length; si++) {
        try {
          var mrRows = dao.findRecordsByFilter(
            "maintenance_records", "schedule = {:sid}", "", 0, 0, { sid: schedRecs[si].id }
          );
          counts.maintenance_records += mrRows.length;
        } catch(_) {}
      }
    } catch(_) {}

    try {
      var txnRecs = dao.findRecordsByFilter(
        "transactions", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      counts.transactions = txnRecs.length;
    } catch(_) {}

    return c.json(200, {
      collection:       collection,
      record_id:        recordId,
      identifier_field: identifierField,
      identifier_value: identifierValue,
      blocked:          false,
      blockers:         [],
      counts:           counts
    });
  }

  // ---- components: compute cascade counts ----
  if (collection === "components") {
    var compCounts = { components: 1, component_transactions: 0 };
    try {
      var ctRecs = dao.findRecordsByFilter(
        "component_transactions", "component = {:cid}", "", 0, 0, { cid: recordId }
      );
      compCounts.component_transactions = ctRecs.length;
    } catch(_) {}

    return c.json(200, {
      collection:       collection,
      record_id:        recordId,
      identifier_field: identifierField,
      identifier_value: identifierValue,
      blocked:          false,
      blockers:         [],
      counts:           compCounts
    });
  }

  // ---- transactions: single row ----
  return c.json(200, {
    collection:       collection,
    record_id:        recordId,
    identifier_field: identifierField,
    identifier_value: identifierValue,
    blocked:          false,
    blockers:         [],
    counts:           { transactions: 1 }
  });

}, $apis.requireRecordAuth());

// ───────────────────────────────────────────────
// Cascade delete endpoint
// ───────────────────────────────────────────────
routerAdd("POST", "/api/admin/cascade-delete", function(c) {
  var dao = $app.dao();

  // Auth check
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.get("role") !== "admin") {
    return c.json(403, { error: "forbidden" });
  }

  var actorId = info.authRecord.id;

  // Parse body via info.data (PB v0.22 pattern)
  var body = info.data || {};
  var collection  = (body.collection   || "").toString();
  var recordId    = (body.record_id    || "").toString();
  var confirmText = (body.confirm_text || "").toString();

  // Whitelist
  var allowed = { kits: true, entities: true, components: true, transactions: true };
  if (!allowed[collection]) {
    return c.json(400, { error: "invalid_collection" });
  }

  // Fetch record
  var record;
  try {
    record = dao.findRecordById(collection, recordId);
  } catch(_) {
    return c.json(400, { error: "not_found" });
  }

  // Determine expected confirm text
  var expectedConfirm;
  if (collection === "kits") {
    expectedConfirm = record.getString("serial");
  } else if (collection === "entities") {
    expectedConfirm = record.getString("name");
  } else if (collection === "components") {
    var compSerial2 = record.getString("serial");
    expectedConfirm = compSerial2 ? compSerial2 : record.id;
  } else {
    expectedConfirm = record.id;
  }

  // Confirm text check
  if (confirmText !== expectedConfirm) {
    return c.json(400, { error: "confirm_mismatch", expected: expectedConfirm });
  }

  // ---- entity: blocker check ----
  if (collection === "entities") {
    var blockers2 = [];
    var blocked2 = false;

    try {
      var txRows2 = dao.findRecordsByFilter(
        "transactions",
        "from_entity = {:eid} || to_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (txRows2.length > 0) {
        blocked2 = true;
        var sampleTx2 = [];
        for (var ti2 = 0; ti2 < Math.min(3, txRows2.length); ti2++) {
          sampleTx2.push(txRows2[ti2].id);
        }
        blockers2.push({ collection: "transactions", count: txRows2.length, sample_ids: sampleTx2 });
      }
    } catch(_) {}

    try {
      var reqRows2 = dao.findRecordsByFilter(
        "requests",
        "target_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (reqRows2.length > 0) {
        blocked2 = true;
        var sampleReq2 = [];
        for (var ri2 = 0; ri2 < Math.min(3, reqRows2.length); ri2++) {
          sampleReq2.push(reqRows2[ri2].id);
        }
        blockers2.push({ collection: "requests", count: reqRows2.length, sample_ids: sampleReq2 });
      }
    } catch(_) {}

    try {
      var ctFromRows2 = dao.findRecordsByFilter(
        "component_transactions",
        "from_entity = {:eid} || to_entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (ctFromRows2.length > 0) {
        blocked2 = true;
        var sampleCt2 = [];
        for (var cti2 = 0; cti2 < Math.min(3, ctFromRows2.length); cti2++) {
          sampleCt2.push(ctFromRows2[cti2].id);
        }
        blockers2.push({ collection: "component_transactions", count: ctFromRows2.length, sample_ids: sampleCt2 });
      }
    } catch(_) {}

    try {
      var userRows2 = dao.findRecordsByFilter(
        "users",
        "entity = {:eid}",
        "", 0, 0, { eid: recordId }
      );
      if (userRows2.length > 0) {
        blocked2 = true;
        blockers2.push({ collection: "users", count: userRows2.length });
      }
    } catch(_) {}

    if (blocked2) {
      return c.json(400, { error: "blocked", blockers: blockers2 });
    }
  }

  // ---- build snapshot BEFORE delete ----
  var snapshot = { id: record.id };
  try {
    var fields = record.collection().schema.fields();
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      if (f && f.name) {
        snapshot[f.name] = record.get(f.name);
      }
    }
  } catch(_) {}

  // ---- compute predicted counts ----
  var predictedCounts = {};
  var predictedAt = new Date().toISOString();

  if (collection === "kits") {
    predictedCounts = { kits: 1, transactions: 0, components: 0,
                        component_transactions: 0,
                        kit_maintenance_schedules: 0, maintenance_records: 0 };
    var kitCompIds = [];
    try {
      var kitComps = dao.findRecordsByFilter(
        "components", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      predictedCounts.components = kitComps.length;
      for (var pc = 0; pc < kitComps.length; pc++) {
        kitCompIds.push(kitComps[pc].id);
        try {
          var pct = dao.findRecordsByFilter(
            "component_transactions", "component = {:cid}", "", 0, 0, { cid: kitComps[pc].id }
          );
          predictedCounts.component_transactions += pct.length;
        } catch(_) {}
      }
    } catch(_) {}
    var kitSchedIds = [];
    try {
      var kitScheds = dao.findRecordsByFilter(
        "kit_maintenance_schedules", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      predictedCounts.kit_maintenance_schedules = kitScheds.length;
      for (var ps = 0; ps < kitScheds.length; ps++) {
        kitSchedIds.push(kitScheds[ps].id);
        try {
          var pmr = dao.findRecordsByFilter(
            "maintenance_records", "schedule = {:sid}", "", 0, 0, { sid: kitScheds[ps].id }
          );
          predictedCounts.maintenance_records += pmr.length;
        } catch(_) {}
      }
    } catch(_) {}
    try {
      var kitTxns = dao.findRecordsByFilter(
        "transactions", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      predictedCounts.transactions = kitTxns.length;
    } catch(_) {}
  } else if (collection === "entities") {
    predictedCounts = { entities: 1 };
  } else if (collection === "components") {
    predictedCounts = { components: 1, component_transactions: 0 };
    try {
      var compTxns = dao.findRecordsByFilter(
        "component_transactions", "component = {:cid}", "", 0, 0, { cid: recordId }
      );
      predictedCounts.component_transactions = compTxns.length;
    } catch(_) {}
  } else {
    predictedCounts = { transactions: 1 };
  }

  // ---- write audit row BEFORE delete ----
  try {
    var auditCol = dao.findCollectionByNameOrId("audit_log");
    var auditRecord = new Record(auditCol, {
      collection_name: collection,
      record_id:       recordId,
      actor:           actorId,
      action:          "cascade_delete",
      changes:         JSON.stringify({
        before:  snapshot,
        cascade: { predicted: predictedCounts, predicted_at: predictedAt },
        via:     "web"
      })
    });
    dao.saveRecord(auditRecord);
  } catch(auditErr) {
    console.log("[cascade_delete] AUDIT WRITE FAILED — aborting cascade:", auditErr);
    return c.json(500, { error: "audit_write_failed", detail: String(auditErr && auditErr.message ? auditErr.message : auditErr) });
  }

  // ---- actual cascade delete ----
  var deleted = {};
  var partialError = null;

  if (collection === "kits") {
    deleted = { kits: 0, transactions: 0, components: 0,
                component_transactions: 0,
                kit_maintenance_schedules: 0, maintenance_records: 0 };

    // (a) component_transactions for components in this kit
    try {
      var dcKitComps = dao.findRecordsByFilter(
        "components", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      for (var dci = 0; dci < dcKitComps.length; dci++) {
        try {
          var dcCt = dao.findRecordsByFilter(
            "component_transactions", "component = {:cid}", "", 0, 0, { cid: dcKitComps[dci].id }
          );
          for (var dj = 0; dj < dcCt.length; dj++) {
            try { dao.deleteRecord(dcCt[dj]); deleted.component_transactions++; }
            catch(e) { partialError = e; console.log("[cascade_delete] comp_txn delete error:", e); }
          }
        } catch(_) {}
      }

      // (b) components
      for (var dci2 = 0; dci2 < dcKitComps.length; dci2++) {
        try { dao.deleteRecord(dcKitComps[dci2]); deleted.components++; }
        catch(e) { partialError = e; console.log("[cascade_delete] component delete error:", e); }
      }
    } catch(_) {}

    // (c) maintenance_records for schedules in this kit
    try {
      var dcScheds = dao.findRecordsByFilter(
        "kit_maintenance_schedules", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      for (var dsi = 0; dsi < dcScheds.length; dsi++) {
        try {
          var dcMr = dao.findRecordsByFilter(
            "maintenance_records", "schedule = {:sid}", "", 0, 0, { sid: dcScheds[dsi].id }
          );
          for (var dmj = 0; dmj < dcMr.length; dmj++) {
            try { dao.deleteRecord(dcMr[dmj]); deleted.maintenance_records++; }
            catch(e) { partialError = e; console.log("[cascade_delete] maint_rec delete error:", e); }
          }
        } catch(_) {}
      }

      // (d) schedules
      for (var dsi2 = 0; dsi2 < dcScheds.length; dsi2++) {
        try { dao.deleteRecord(dcScheds[dsi2]); deleted.kit_maintenance_schedules++; }
        catch(e) { partialError = e; console.log("[cascade_delete] schedule delete error:", e); }
      }
    } catch(_) {}

    // (e) transactions
    try {
      var dcTxns = dao.findRecordsByFilter(
        "transactions", "kit = {:kid}", "", 0, 0, { kid: recordId }
      );
      for (var dti = 0; dti < dcTxns.length; dti++) {
        try { dao.deleteRecord(dcTxns[dti]); deleted.transactions++; }
        catch(e) { partialError = e; console.log("[cascade_delete] txn delete error:", e); }
      }
    } catch(_) {}

    // (f) kit itself
    try { dao.deleteRecord(record); deleted.kits++; }
    catch(e) { partialError = e; console.log("[cascade_delete] kit delete error:", e); }

  } else if (collection === "entities") {
    deleted = { entities: 0 };
    try { dao.deleteRecord(record); deleted.entities++; }
    catch(e) { partialError = e; console.log("[cascade_delete] entity delete error:", e); }

  } else if (collection === "components") {
    deleted = { components: 0, component_transactions: 0 };

    // (a) component_transactions
    try {
      var dcCompTxns = dao.findRecordsByFilter(
        "component_transactions", "component = {:cid}", "", 0, 0, { cid: recordId }
      );
      for (var dcj = 0; dcj < dcCompTxns.length; dcj++) {
        try { dao.deleteRecord(dcCompTxns[dcj]); deleted.component_transactions++; }
        catch(e) { partialError = e; console.log("[cascade_delete] comp_txn delete error:", e); }
      }
    } catch(_) {}

    // (b) component itself
    try { dao.deleteRecord(record); deleted.components++; }
    catch(e) { partialError = e; console.log("[cascade_delete] component delete error:", e); }

  } else {
    // transactions — single row
    deleted = { transactions: 0 };
    try { dao.deleteRecord(record); deleted.transactions++; }
    catch(e) { partialError = e; console.log("[cascade_delete] transaction delete error:", e); }
  }

  // If partial failure, write cascade_partial audit row and return 500
  if (partialError) {
    try {
      var auditCol2 = dao.findCollectionByNameOrId("audit_log");
      var partialRecord = new Record(auditCol2, {
        collection_name: collection,
        record_id:       recordId,
        actor:           actorId,
        action:          "cascade_partial",
        changes:         JSON.stringify({
          before:  snapshot,
          cascade: { predicted: predictedCounts, actual: deleted, error: String(partialError), via: "web" }
        })
      });
      dao.saveRecord(partialRecord);
    } catch(_) {}
    return c.json(500, { error: "partial_failure", deleted: deleted });
  }

  return c.json(200, { deleted: deleted });

}, $apis.requireRecordAuth());
