/// <reference path="../pb_data/types.d.ts" />
// Adds a nullable `telegram_chat_id` field to the `invites` collection.
// When set, auto-populates the new user's telegram_chat_id on invite accept (Phase 2).
// Reversible: down migration removes the field.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    c.schema.addField(new SchemaField({
      "system": false,
      "id": "invites_tg_chat_id",
      "name": "telegram_chat_id",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" },
    }));

    dao.saveCollection(c);
    console.log("[invites_add_telegram_chat_id] Done: telegram_chat_id field added.");
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    const field = c.schema.getFieldByName("telegram_chat_id");
    if (field) {
      c.schema.removeField(field.id);
    }

    dao.saveCollection(c);
    console.log("[invites_add_telegram_chat_id] Down: telegram_chat_id field removed.");
  }
);
