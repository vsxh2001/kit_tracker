/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("f47avujqxfu2ouh");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "kits_attachments_1",
    "name": "attachments",
    "type": "file",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSelect": 10,
      "maxSize": 5242880,
      "mimeTypes": [],
      "thumbs": [],
      "protected": false
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("f47avujqxfu2ouh");

  collection.schema.removeField("kits_attachments_1");

  return dao.saveCollection(collection);
});
