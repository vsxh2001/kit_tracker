/// <reference path="../pb_data/types.d.ts" />
// Drop the obsolete `type` field from entities.
//
// Background: the original schema declared `type` as required select
// (person|team|lab|storage|customer|maintenance|other). Migration
// 1778929232_add_entity_category.js added `category` (storage|field) as the
// replacement field but did NOT remove `type`. The frontend never sends `type`
// on create/update, so PocketBase rejects every POST/PATCH with 400 "type
// field required". This migration removes the field entirely.
//
// Data concern: existing rows have `type` populated (values set by the old UI
// or seed scripts). Dropping the field discards that data. The values are
// superseded by `category` which has been backfilled for all rows. No app code
// reads `entities.type` from PocketBase records (grepped frontend/src — only
// occurrence is a CSV-import shim that reads row.type from the CSV file, not
// from PB).

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("entities");
    const field = c.schema.getFieldByName("type");
    if (field) {
      c.schema.removeField(field.id);
      dao.saveCollection(c);
      console.log("[entities_drop_type] type field removed.");
    } else {
      console.log("[entities_drop_type] type field not found — already removed.");
    }
  },
  (db) => {
    // Down: re-add type as optional select so rollback is non-destructive.
    // Not required=true on rollback because existing rows have no type value.
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("entities");
    c.schema.addField(new SchemaField({
      "system": false,
      "id": "sjxzwvch",
      "name": "type",
      "type": "select",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "maxSelect": 1,
        "values": ["storage", "field"]
      }
    }));
    dao.saveCollection(c);
    console.log("[entities_drop_type] Down: type field restored as optional.");
  }
);
