/// <reference path="../pb_data/types.d.ts" />
// Adds optional `is_consumable` bool field to products. Marks one-way
// inventory (tape, screws, adhesives) where a transfer to a non-storage
// entity is consumption rather than a loan. Pure additive flag — burn-rate
// integration with reorder_point is a Phase 2 follow-up.
// See COMPONENT_HYPERCHARGE_IDEAS.md §4.15.

migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");

    collection.schema.addField(new SchemaField({
      name: "is_consumable",
      type: "bool",
      required: false,
      options: {},
    }));

    dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");
    const field = collection.schema.getFieldByName("is_consumable");
    if (field) {
      collection.schema.removeField(field.id);
      dao.saveCollection(collection);
    }
  }
);
