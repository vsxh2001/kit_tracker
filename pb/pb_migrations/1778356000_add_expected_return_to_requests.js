/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("9va9bv4yiwkm4wr");

  // Add the expected_return field
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "exp_ret_1",
    "name": "expected_return",
    "type": "date",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": "",
      "max": ""
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("9va9bv4yiwkm4wr");

  // Remove the expected_return field
  collection.schema.removeField("exp_ret_1");

  return dao.saveCollection(collection);
});
