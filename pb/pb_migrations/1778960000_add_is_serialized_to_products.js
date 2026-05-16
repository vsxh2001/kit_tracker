/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");

    collection.schema.addField(new SchemaField({
      name: "is_serialized",
      type: "bool",
      required: false,
      options: {},
    }));

    dao.saveCollection(collection);

    // Backfill: for each existing product, set is_serialized based on linked components.
    // If any linked component has a non-empty serial -> is_serialized = true.
    // If all linked components are is_bulk=true and none have a serial -> is_serialized = false.
    // If no linked components, default true.
    const products = dao.findRecordsByFilter("products", "id != ''", "", 0, 0);
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const linked = dao.findRecordsByFilter(
        "components",
        "product = {:pid}",
        "",
        0,
        0,
        { pid: p.id }
      );
      let isSerialized = true; // default
      if (linked.length > 0) {
        let anySerial = false;
        for (let j = 0; j < linked.length; j++) {
          const serial = linked[j].getString("serial");
          if (serial && serial.length > 0) {
            anySerial = true;
            break;
          }
        }
        let allBulk = true;
        for (let j = 0; j < linked.length; j++) {
          if (!linked[j].getBool("is_bulk")) {
            allBulk = false;
            break;
          }
        }
        if (allBulk && !anySerial) isSerialized = false;
      }
      p.set("is_serialized", isSerialized);
      dao.saveRecord(p);
    }
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("products");
    const field = collection.schema.getFieldByName("is_serialized");
    if (field) {
      collection.schema.removeField(field.id);
      dao.saveCollection(collection);
    }
  }
);
