/// <reference path="../pb_data/types.d.ts" />
// Adds optional `reorder_point` number field to products for low-stock alerting.
// Pure additive — no constraints, no index. See COMPONENT_HYPERCHARGE_IDEAS.md §4.5.

migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");

    collection.schema.addField(new SchemaField({
      name: "reorder_point",
      type: "number",
      required: false,
      options: { min: 0, max: null, noDecimal: true },
    }));

    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");
    const field = collection.schema.getFieldByName("reorder_point");
    if (field) {
      collection.schema.removeField(field.id);
      dao.saveCollection(collection);
    }
  }
);
