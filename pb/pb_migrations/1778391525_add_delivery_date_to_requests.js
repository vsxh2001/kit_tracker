/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("9va9bv4yiwkm4wr");

  // Add the delivery_date field
  // required:false for safety — existing rows may have NULL data.
  // The field is logically required at the application layer (enforced in
  // setup_collections.sh and the frontend), but a required:true column
  // would fail migrate up on any DB that already has rows without this field.
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "del_date_1",
    "name": "delivery_date",
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

  // Remove the delivery_date field
  collection.schema.removeField("del_date_1");

  return dao.saveCollection(collection);
});
