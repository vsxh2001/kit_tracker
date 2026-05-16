/// <reference path="../pb_data/types.d.ts" />
// Add `category` field to entities — binary storage|field classification.
// Replaces the meaningless auto-set `type` field. Default "field".

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("entities");
    c.schema.addField(new SchemaField({
      "system": false,
      "id": "ent_category",
      "name": "category",
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

    // Backfill all existing rows to "field" (default).
    db.newQuery("UPDATE entities SET category = 'field' WHERE category IS NULL OR category = ''")
      .execute();
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("entities");
    c.schema.removeField("ent_category");
    dao.saveCollection(c);
  }
);
