/// <reference path="../pb_data/types.d.ts" />
// Adds a nullable `telegram_chat_id` field to the users collection.
// Populated when a user links their Telegram account (Phase 2 identity).
// Reversible: down migration removes the field.

migrate(
  (db) => {
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("_pb_users_auth_");

    col.schema.addField(new SchemaField({
      "system": false,
      "id": "users_tg_chat_id",
      "name": "telegram_chat_id",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" },
    }));

    dao.saveCollection(col);
    console.log("[users_add_telegram_chat_id] Done: telegram_chat_id field added.");
  },
  (db) => {
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("_pb_users_auth_");

    const field = col.schema.getFieldByName("telegram_chat_id");
    if (field) {
      col.schema.removeField(field.id);
    }

    dao.saveCollection(col);
    console.log("[users_add_telegram_chat_id] Down: telegram_chat_id field removed.");
  }
);
