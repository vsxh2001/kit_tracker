/// <reference path="../pb_data/types.d.ts" />
// Adds a nullable `phone` field to the `invites` collection.
// When set, auto-populates the new user's phone on accept.
// Reversible: down migration removes the field.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    c.schema.addField(new SchemaField({
      "system": false,
      "id": "invites_phone",
      "name": "phone",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" },
    }));

    dao.saveCollection(c);
    console.log("[invites_add_phone] Done: phone field added.");
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    const phoneField = c.schema.getFieldByName("phone");
    if (phoneField) {
      c.schema.removeField(phoneField.id);
    }

    dao.saveCollection(c);
    console.log("[invites_add_phone] Down: phone field removed.");
  }
);
