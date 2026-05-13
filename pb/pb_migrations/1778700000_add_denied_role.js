/// <reference path="../pb_data/types.d.ts" />
// Adds "denied" role to users:
//   1. Extends users.role select enum to include "denied"
//   2. Adds users.denial_notes text field (optional)

migrate((db) => {
  const dao = new Dao(db);

  // -------- 1. users.role: add "denied" to enum --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    const roleField = c.schema.getFieldByName("role");
    roleField.options.values = ["", "admin", "technician", "user", "viewer", "denied"];
    c.schema.addField(roleField);
    dao.saveCollection(c);
  }

  // -------- 2. users.denial_notes: add optional text field --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    c.schema.addField(new SchemaField({
      name: "denial_notes",
      type: "text",
      required: false,
      options: {},
    }));
    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // -------- 2. users.denial_notes: remove field --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    const f = c.schema.getFieldByName("denial_notes");
    if (f) {
      c.schema.removeField(f.id);
    }
    dao.saveCollection(c);
  }

  // -------- 1. users.role: remove "denied" from enum --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    const roleField = c.schema.getFieldByName("role");
    roleField.options.values = ["", "admin", "technician", "user", "viewer"];
    c.schema.addField(roleField);
    dao.saveCollection(c);
  }

  return null;
});
