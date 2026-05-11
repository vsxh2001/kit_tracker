/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("f47avujqxfu2ouh");

  // Add the tags field as comma-separated text (PB v0.22 limitation).
  // Validation (split, trim, dedupe, lowercase, max 10) is enforced client-side.
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "kits_tags_1",
    "name": "tags",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("f47avujqxfu2ouh");

  collection.schema.removeField("kits_tags_1");

  return dao.saveCollection(collection);
});
