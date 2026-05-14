/// <reference path="../pb_data/types.d.ts" />
// Adds `products` collection and optional `product` relation field on `components`.
//
// products: catalog entries for component types/SKUs (Samsung 990 Pro 2TB, etc.)
//   - name required, category/manufacturer/model optional free-form text
//   - specs: JSON text string (schemaless v1, default "{}")
//   - is_active: soft-delete flag
//   - deleteRule = null (superadmin-only; user-facing path is is_active=false)
//
// components.product: optional FK to products (nullable, no cascade-delete)
//   - backwards-compatible: existing components keep type text, product is null

migrate((db) => {
  const dao = new Dao(db);

  // -------- products --------
  {
    const c = new Collection({
      "name": "products",
      "type": "base",
      "system": false,
      "schema": [
        {
          "system": false,
          "id": "prod_name",
          "name": "name",
          "type": "text",
          "required": true,
          "presentable": true,
          "unique": false,
          "options": { "min": null, "max": 200, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_category",
          "name": "category",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": 80, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_manufacturer",
          "name": "manufacturer",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": 120, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_model",
          "name": "model",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": 120, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_description",
          "name": "description",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_specs",
          "name": "specs",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "prod_is_active",
          "name": "is_active",
          "type": "bool",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {}
        }
      ],
      "indexes": [
        "CREATE INDEX IF NOT EXISTS idx_products_name ON products (name)",
        "CREATE INDEX IF NOT EXISTS idx_products_manufacturer_model ON products (manufacturer, model)",
        "CREATE INDEX IF NOT EXISTS idx_products_active ON products (is_active)"
      ],
      "listRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\"",
      "createRule": "@request.auth.role = \"admin\" || @request.auth.role = \"technician\"",
      "updateRule": "@request.auth.role = \"admin\" || @request.auth.role = \"technician\"",
      "deleteRule": null,
      "options": {}
    });

    dao.saveCollection(c);
  }

  // -------- components.product (optional FK) --------
  {
    const productsCol = dao.findCollectionByNameOrId("products");
    const componentsCol = dao.findCollectionByNameOrId("components");

    componentsCol.schema.addField(new SchemaField({
      "system": false,
      "id": "comp_product",
      "name": "product",
      "type": "relation",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "collectionId": productsCol.id,
        "cascadeDelete": false,
        "minSelect": null,
        "maxSelect": 1,
        "displayFields": null
      }
    }));

    dao.saveCollection(componentsCol);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // Remove components.product field first
  try {
    const componentsCol = dao.findCollectionByNameOrId("components");
    const field = componentsCol.schema.getFieldByName("product");
    if (field) {
      componentsCol.schema.removeField(field.id);
      dao.saveCollection(componentsCol);
    }
  } catch (_) {}

  // Drop products collection
  try {
    const productsCol = dao.findCollectionByNameOrId("products");
    dao.deleteCollection(productsCol);
  } catch (_) {}

  return null;
});
