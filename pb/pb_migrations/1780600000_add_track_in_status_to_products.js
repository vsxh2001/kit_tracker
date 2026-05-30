/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");

    collection.schema.addField(new SchemaField({
      name: "track_in_status",
      type: "bool",
      required: false,
      options: {},
    }));

    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");
    const field = collection.schema.getFieldByName("track_in_status");
    if (field) {
      collection.schema.removeField(field.id);
      dao.saveCollection(collection);
    }
  }
);
