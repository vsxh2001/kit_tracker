/// <reference path="../pb_data/types.d.ts" />
// Add `phone` and `title` fields to _pb_users_auth_ (users collection).
//
// phone — contact number for on-call use; accepts any string (E.164 recommended in UI).
// title — job context, e.g. "Field Engineer", "Lab Manager".
//
// Both fields are optional text. No validation in this migration (v1).

migrate((db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("_pb_users_auth_");

  col.schema.addField(new SchemaField({
    "system": false,
    "id": "users_phone",
    "name": "phone",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }));

  col.schema.addField(new SchemaField({
    "system": false,
    "id": "users_title",
    "name": "title",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }));

  return dao.saveCollection(col);
}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("_pb_users_auth_");

  col.schema.removeField("users_phone");
  col.schema.removeField("users_title");

  return dao.saveCollection(col);
});
