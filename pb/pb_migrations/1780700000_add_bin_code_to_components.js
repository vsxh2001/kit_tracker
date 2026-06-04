/// <reference path="../pb_data/types.d.ts" />
// Adds optional `bin_code` (max 16 chars) to components for shelf/bin
// granularity inside an entity. Pure additive — no constraints, no index.
// See COMPONENT_HYPERCHARGE_IDEAS.md §4.1.

migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("components");

    collection.schema.addField(new SchemaField({
      name: "bin_code",
      type: "text",
      required: false,
      options: { min: null, max: 16, pattern: "" },
    }));

    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("components");
    const field = collection.schema.getFieldByName("bin_code");
    if (field) {
      collection.schema.removeField(field.id);
      dao.saveCollection(collection);
    }
  }
);
