/// <reference path="../pb_data/types.d.ts" />
// Make `category` required on entities — pilot invariant: every entity
// must be classified as field|storage.

migrate(
  (db) => {
    const dao = new Dao(db);

    // Re-run backfill defensively to catch any row that slipped through.
    db.newQuery("UPDATE entities SET category = 'field' WHERE category IS NULL OR category = ''")
      .execute();

    const c = dao.findCollectionByNameOrId("entities");
    const field = c.schema.getFieldByName("category");
    field.required = true;
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("entities");
    const field = c.schema.getFieldByName("category");
    field.required = false;
    dao.saveCollection(c);
  }
);
