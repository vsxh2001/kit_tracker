/// <reference path="../pb_data/types.d.ts" />
// Migration B: make components.product required + drop components.type field.
//
// Prerequisites: Migration A must have run first, ensuring all components
// have a non-empty product. This migration will fail if any component still
// has an empty product (PB schema required=true enforcement).

migrate((db) => {
  const dao = new Dao(db);

  const componentsCol = dao.findCollectionByNameOrId("components");

  // 1. Make product field required
  const productField = componentsCol.schema.getFieldByName("product");
  if (!productField) {
    throw new Error("components.product field not found");
  }
  productField.required = true;

  // 2. Remove type field
  const typeField = componentsCol.schema.getFieldByName("type");
  if (typeField) {
    componentsCol.schema.removeField(typeField.id);
  } else {
    console.log("[components_require_product_drop_type] type field not found — already removed?");
  }

  dao.saveCollection(componentsCol);

  console.log("[components_require_product_drop_type] Done: product=required, type field removed.");

  return null;
}, (db) => {
  const dao = new Dao(db);

  const componentsCol = dao.findCollectionByNameOrId("components");

  // Restore product to optional
  const productField = componentsCol.schema.getFieldByName("product");
  if (productField) {
    productField.required = false;
  }

  // Re-add type field
  componentsCol.schema.addField(new SchemaField({
    "system": false,
    "id": "comp_type",
    "name": "type",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": 100, "pattern": "" }
  }));

  dao.saveCollection(componentsCol);

  console.log("[components_require_product_drop_type] Down: product=optional, type field restored.");
});
