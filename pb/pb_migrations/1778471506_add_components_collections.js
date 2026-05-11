/// <reference path="../pb_data/types.d.ts" />
// Adds `components` and `component_transactions` collections.
//
// components: tracks individual (serialized) or bulk (is_bulk=true) components.
//   - serial is unique when set; nullable for bulk components (enforced by hook).
//   - Partial unique index attempted; if PB v0.22 rejects WHERE clause, falls
//     back to a plain non-null filtered unique index via hook-only enforcement.
//
// component_transactions: append-only movement log for components across kits/entities.
//   mirrors the existing `transactions` collection pattern.

migrate((db) => {
  const dao = new Dao(db);

  // -------- components --------
  {
    const c = new Collection({
      "name": "components",
      "type": "base",
      "system": false,
      "schema": [
        {
          "system": false,
          "id": "comp_serial",
          "name": "serial",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "comp_type",
          "name": "type",
          "type": "text",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "comp_notes",
          "name": "notes",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "comp_is_active",
          "name": "is_active",
          "type": "bool",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {}
        },
        {
          "system": false,
          "id": "comp_is_bulk",
          "name": "is_bulk",
          "type": "bool",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {}
        },
        {
          "system": false,
          "id": "comp_quantity",
          "name": "quantity",
          "type": "number",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": 1, "max": null, "noDecimal": true }
        }
      ],
      // Partial unique on serial where serial != '' — PB v0.22 supports
      // partial indexes via WHERE. If this fails on older SQLite, the hook
      // `components_validate.pb.js` provides the same guarantee.
      "indexes": [
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_components_serial ON components (serial) WHERE serial != '' AND serial IS NOT NULL"
      ],
      "listRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\"",
      "createRule": "@request.auth.role = \"admin\"",
      "updateRule": "@request.auth.role = \"admin\"",
      "deleteRule": null,
      "options": {}
    });

    dao.saveCollection(c);
  }

  // -------- component_transactions --------
  {
    // We need the components collection ID for the relation field.
    const compCol = dao.findCollectionByNameOrId("components");
    const kitsCol = dao.findCollectionByNameOrId("kits");
    const entitiesCol = dao.findCollectionByNameOrId("entities");
    const usersCol = dao.findCollectionByNameOrId("users");

    const c = new Collection({
      "name": "component_transactions",
      "type": "base",
      "system": false,
      "schema": [
        {
          "system": false,
          "id": "ctxn_component",
          "name": "component",
          "type": "relation",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": compCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "ctxn_from_kit",
          "name": "from_kit",
          "type": "relation",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": kitsCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "ctxn_from_entity",
          "name": "from_entity",
          "type": "relation",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": entitiesCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "ctxn_to_kit",
          "name": "to_kit",
          "type": "relation",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": kitsCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "ctxn_to_entity",
          "name": "to_entity",
          "type": "relation",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": entitiesCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "ctxn_quantity",
          "name": "quantity",
          "type": "number",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": 1, "max": null, "noDecimal": true }
        },
        {
          "system": false,
          "id": "ctxn_timestamp",
          "name": "timestamp",
          "type": "date",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": "", "max": "" }
        },
        {
          "system": false,
          "id": "ctxn_notes",
          "name": "notes",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "ctxn_created_by",
          "name": "created_by",
          "type": "relation",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": usersCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        }
      ],
      "indexes": [
        "CREATE INDEX IF NOT EXISTS idx_comp_txn_component_ts ON component_transactions (component, timestamp DESC)"
      ],
      "listRule": "@request.auth.id != \"\"",
      "viewRule": "@request.auth.id != \"\"",
      "createRule": "(@request.auth.role = \"admin\" || @request.auth.role = \"technician\") && @request.data.created_by = @request.auth.id",
      "updateRule": null,
      "deleteRule": null,
      "options": {}
    });

    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // Delete component_transactions first (depends on components)
  try {
    const ctxn = dao.findCollectionByNameOrId("component_transactions");
    dao.deleteCollection(ctxn);
  } catch (_) {}

  try {
    const comp = dao.findCollectionByNameOrId("components");
    dao.deleteCollection(comp);
  } catch (_) {}

  return null;
});
