/// <reference path="../pb_data/types.d.ts" />
// Adds a nullable `email` field to the `invites` collection.
// When set, the accepter must present this exact email (case-insensitive).
// Existing invites (email = null) retain the old any-email behavior.
// Reversible: down migration removes the field.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    c.schema.addField(new SchemaField({
      "system": false,
      "id": "invites_email",
      "name": "email",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" },
    }));

    dao.saveCollection(c);
    console.log("[invites_add_email] Done: email field added.");
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("invites");

    const emailField = c.schema.getFieldByName("email");
    if (emailField) {
      c.schema.removeField(emailField.id);
    }

    dao.saveCollection(c);
    console.log("[invites_add_email] Down: email field removed.");
  }
);
