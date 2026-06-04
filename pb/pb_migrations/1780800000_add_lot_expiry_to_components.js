/// <reference path="../pb_data/types.d.ts" />
// Adds optional `lot_code` (max 32 chars) and `expires_at` (date) to components
// for shelf-life tracking of bulk consumables. Pure additive — no constraints, no index.
// See COMPONENT_HYPERCHARGE_IDEAS.md §4.7.

migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("components");

    collection.schema.addField(new SchemaField({
      name: "lot_code",
      type: "text",
      required: false,
      options: { min: null, max: 32, pattern: "" },
    }));

    collection.schema.addField(new SchemaField({
      name: "expires_at",
      type: "date",
      required: false,
      options: {},
    }));

    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("components");

    const lotField = collection.schema.getFieldByName("lot_code");
    if (lotField) {
      collection.schema.removeField(lotField.id);
    }

    const expField = collection.schema.getFieldByName("expires_at");
    if (expField) {
      collection.schema.removeField(expField.id);
    }

    dao.saveCollection(collection);
  }
);
