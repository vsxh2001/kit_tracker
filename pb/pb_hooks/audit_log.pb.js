/// <reference path="../pb_data/types.d.ts" />
// Audit log hook — captures create/update on kits, entities, users.
// Writes to audit_log collection. All logic is inlined per hook callback
// because Goja (PB's JS runtime) does not share top-level function scope
// between separate onRecord* registration calls.
// Errors are caught and logged; they NEVER block the original operation.
//
// T6: via tag detection is inlined in each callback (not extracted to a helper)
// because Goja isolates top-level scope per onRecord* registration — a function
// declared at module level is not visible inside the callbacks.
// Each callback reads e.httpContext.get("audit_via") set by ai_chat/ai_mcp/wa_inbound;
// falls back to "web" for direct REST calls from the browser/frontend.

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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "kits",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "kits",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after, via: via }),
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "entities",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "entities",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after, via: via }),
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "users",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "users",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] users update error:", err);
  }
}, "users");

// users — delete
onRecordAfterDeleteRequest(function(e) {
  try {
    var info = $apis.requestInfo(e.httpContext);
    if (!info || !info.authRecord) return;
    var actorId = info.authRecord.id;

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "users",
      record_id: e.record.id,
      actor: actorId,
      action: "delete",
      changes: JSON.stringify({ before: { email: e.record.getString("email"), role: e.record.getString("role") }, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] users delete error:", err);
  }
}, "users");

// requests — create
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "requests",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] requests create error:", err);
  }
}, "requests");

// requests — update
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "requests",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] requests update error:", err);
  }
}, "requests");

// transactions — create only (append-only collection, no update rule)
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "transactions",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] transactions create error:", err);
  }
}, "transactions");

// on_call_shifts — create
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "on_call_shifts",
      record_id: e.record.id,
      actor: actorId,
      action: "create",
      changes: JSON.stringify({ after: data, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] on_call_shifts create error:", err);
  }
}, "on_call_shifts");

// on_call_shifts — update
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

    var via = "web";
    try { var _v = e.httpContext.get("audit_via"); if (_v) via = String(_v); } catch (_) {}

    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var log = new Record(auditCol, {
      collection_name: "on_call_shifts",
      record_id: e.record.id,
      actor: actorId,
      action: "update",
      changes: JSON.stringify({ before: before, after: after, via: via }),
    });
    $app.dao().saveRecord(log);
  } catch (err) {
    console.log("[audit_log] on_call_shifts update error:", err);
  }
}, "on_call_shifts");
