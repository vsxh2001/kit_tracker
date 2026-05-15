/// <reference path="../pb_data/types.d.ts" />
// Migration C: add products.url optional text field (max 500).
// For vendor datasheets, manufacturer pages, etc.

migrate((db) => {
  const dao = new Dao(db);

  const productsCol = dao.findCollectionByNameOrId("products");

  productsCol.schema.addField(new SchemaField({
    "system": false,
    "id": "prod_url",
    "name": "url",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": 500, "pattern": "" }
  }));

  dao.saveCollection(productsCol);

  console.log("[add_product_url] Done: products.url field added.");

  return null;
}, (db) => {
  const dao = new Dao(db);

  const productsCol = dao.findCollectionByNameOrId("products");
  const urlField = productsCol.schema.getFieldByName("url");
  if (urlField) {
    productsCol.schema.removeField(urlField.id);
    dao.saveCollection(productsCol);
  }

  console.log("[add_product_url] Down: products.url field removed.");
});
