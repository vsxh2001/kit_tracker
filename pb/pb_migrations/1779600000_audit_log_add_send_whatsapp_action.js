/// <reference path="../pb_data/types.d.ts" />
// Add send_whatsapp to audit_log.action select enum.
// Required by wa_meta_auto_notify.pb.js (Phase 2b) and maintenance_reminder.pb.js WhatsApp path.
// Without this, audit_log rows written with action="send_whatsapp" fail enum validation.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    const field = c.schema.getFieldByName("action");
    field.options.values = [
      "create",
      "update",
      "delete",
      "cascade_delete",
      "cascade_partial",
      "create_failed",
      "update_failed",
      "frontend_error",
      "send_whatsapp",
    ];
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    const field = c.schema.getFieldByName("action");
    field.options.values = [
      "create",
      "update",
      "delete",
      "cascade_delete",
      "cascade_partial",
      "create_failed",
      "update_failed",
      "frontend_error",
    ];
    dao.saveCollection(c);
  }
);
