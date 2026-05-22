/// <reference path="../pb_data/types.d.ts" />
// Add send_whatsapp to audit_log.action enum.
//
// send_whatsapp — written by wa_meta_send.pb.js when an admin initiates an
// outbound WhatsApp message via POST /api/wa/send.
// Without this migration the audit_log write fails enum validation and the
// send action is not recorded.

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
