/// <reference path="../pb_data/types.d.ts" />
// Add is_active bool to on_call_shifts for soft-delete parity with other
// collections (kits, entities, products, components).
// Defaults to true; soft-delete sets to false; UI filters by default.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("on_call_shifts");
    c.schema.addField(new SchemaField({
      "system": false,
      "id": "ocs_is_active",
      "name": "is_active",
      "type": "bool",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {}
    }));
    dao.saveCollection(c);

    // Backfill existing rows to is_active=true.
    db.newQuery("UPDATE on_call_shifts SET is_active = 1 WHERE is_active IS NULL OR is_active = 0")
      .execute();
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("on_call_shifts");
    c.schema.removeField("ocs_is_active");
    dao.saveCollection(c);
  }
);
