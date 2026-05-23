/// <reference path="../pb_data/types.d.ts" />
// Add `notification_prefs` JSON text field to users collection.
//
// Stores per-user notification channel + event toggles as a JSON string.
// Default empty string — hooks treat empty/missing as full opt-in (preserves
// current behavior for existing users).
//
// Shape (when populated):
//   {
//     "channels": ["whatsapp", "email"],
//     "events": {
//       "request_fulfilled": true,
//       "kit_moved": false,
//       "maintenance_digest": true,
//       "overdue_return": true
//     }
//   }

migrate(
  (db) => {
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("_pb_users_auth_");

    col.schema.addField(new SchemaField({
      "system": false,
      "id": "users_notification_prefs",
      "name": "notification_prefs",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" }
    }));

    return dao.saveCollection(col);
  },
  (db) => {
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("_pb_users_auth_");
    col.schema.removeField("users_notification_prefs");
    return dao.saveCollection(col);
  }
);
