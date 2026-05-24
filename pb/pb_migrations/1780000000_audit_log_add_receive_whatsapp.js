/// <reference path="../pb_data/types.d.ts" />
// Add receive_whatsapp to audit_log.action enum.
//
// receive_whatsapp — written by wa_meta_webhook.pb.js for each inbound message
// so both sides of the conversation appear in the audit_log thread.

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
      "receive_whatsapp",
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
      "send_whatsapp",
    ];
    dao.saveCollection(c);
  }
);
