/// <reference path="../pb_data/types.d.ts" />
// Extends `kit_maintenance_schedules` to support per-component schedules.
//
// Changes:
//   1. Make `kit` field optional (was required).
//   2. Add `component` relation field (optional, points to components collection).
//
// Exactly one of kit/component must be set per row — enforced by the
// maintenance_xor_target.pb.js hook (not the schema, since PB rules can't do XOR).

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");

    // 1. Make kit field optional.
    const kitField = c.schema.getFieldByName("kit");
    if (kitField) {
      kitField.required = false;
    }

    // 2. Add component relation field.
    const compCol = dao.findCollectionByNameOrId("components");
    c.schema.addField(new SchemaField({
      "system": false,
      "id": "kms_component",
      "name": "component",
      "type": "relation",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "collectionId": compCol.id,
        "cascadeDelete": false,
        "minSelect": null,
        "maxSelect": 1,
        "displayFields": null
      }
    }));

    dao.saveCollection(c);
    console.log("[add_component_to_maintenance] Done: kit made optional, component field added.");
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");

    // Rollback: remove component field, make kit required again.
    const compField = c.schema.getFieldByName("component");
    if (compField) {
      c.schema.removeField(compField.id);
    }

    const kitField = c.schema.getFieldByName("kit");
    if (kitField) {
      kitField.required = true;
    }

    dao.saveCollection(c);
    console.log("[add_component_to_maintenance] Down: component field removed, kit made required again.");
  }
);
