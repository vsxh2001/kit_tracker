/// <reference path="../pb_data/types.d.ts" />
// Audit log hook — captures create/update on kits, entities, users.
// Writes to audit_log collection. All logic is inlined per hook callback
// because Goja (PB's JS runtime) does not share top-level function scope
// between separate onRecord* registration calls.
// Errors are caught and logged; they NEVER block the original operation.

// kits — create
onRecordAfterCreateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var data = {};
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f && f.name) {
        data[f.name] = e.record.get(f.name);
      }
    }

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "kits",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] kits create error:", err);
  }
}, "kits");

// kits — update
onRecordAfterUpdateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var original = e.record.originalCopy();
    var before = {};
    var after = {};
    var hasChanges = false;
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.name) continue;
      var oldVal = original.get(f.name);
      var newVal = e.record.get(f.name);
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        before[f.name] = oldVal;
        after[f.name] = newVal;
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "kits",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] kits update error:", err);
  }
}, "kits");

// entities — create
onRecordAfterCreateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var data = {};
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f && f.name) {
        data[f.name] = e.record.get(f.name);
      }
    }

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "entities",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] entities create error:", err);
  }
}, "entities");

// entities — update
onRecordAfterUpdateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var original = e.record.originalCopy();
    var before = {};
    var after = {};
    var hasChanges = false;
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.name) continue;
      var oldVal = original.get(f.name);
      var newVal = e.record.get(f.name);
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        before[f.name] = oldVal;
        after[f.name] = newVal;
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "entities",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] entities update error:", err);
  }
}, "entities");

// users — create
onRecordAfterCreateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var data = {};
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f && f.name) {
        data[f.name] = e.record.get(f.name);
      }
    }

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "users",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] users create error:", err);
  }
}, "users");

// users — update
onRecordAfterUpdateRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var original = e.record.originalCopy();
    var before = {};
    var after = {};
    var hasChanges = false;
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.name) continue;
      var oldVal = original.get(f.name);
      var newVal = e.record.get(f.name);
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        before[f.name] = oldVal;
        after[f.name] = newVal;
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "users",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] users update error:", err);
  }
}, "users");
