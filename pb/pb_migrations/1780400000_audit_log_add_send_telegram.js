/// <reference path="../pb_data/types.d.ts" />
// Add send_telegram to audit_log.action enum.
//
// send_telegram — written by tg_send.pb.js when an admin initiates an outbound
// Telegram message via POST /api/tg/send (Phase 3 of the WhatsApp→Telegram
// migration). Mirrors the send_whatsapp precedent (migration 1779600000):
// without this enum value the audit_log write fails select-validation and the
// send action is silently dropped by the hook's non-fatal try/catch.

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
      "send_telegram",
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
      "receive_whatsapp",
    ];
    dao.saveCollection(c);
  }
);
