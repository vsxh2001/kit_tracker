/// <reference path="../pb_data/types.d.ts" />
// Adds `on_call_shifts` collection.
//
// Tracks which user is on-call for a given time window.
// Phase 3 notification hooks will query this collection via findOnCallNow() —
// see reference implementation in pb/pb_hooks/oncall_validate.pb.js header.
//
// Rules:
//   listRule/viewRule : any authenticated user with a role
//   createRule        : admin only, must set created_by = self
//   updateRule        : admin only
//   deleteRule        : admin only
//
// Indexes: (start_at, end_at) for fast "active now" queries.

migrate((db) => {
  const dao = new Dao(db);

  const usersCol = dao.findCollectionByNameOrId("users");

  const c = new Collection({
    "name": "on_call_shifts",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "ocs_user",
        "name": "user",
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
      },
      {
        "system": false,
        "id": "ocs_start_at",
        "name": "start_at",
        "type": "date",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "ocs_end_at",
        "name": "end_at",
        "type": "date",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "ocs_notes",
        "name": "notes",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "ocs_created_by",
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
      "CREATE INDEX IF NOT EXISTS idx_on_call_shifts_range ON on_call_shifts (start_at, end_at)"
    ],
    "listRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
    "createRule": "@request.auth.role = \"admin\" && @request.data.created_by = @request.auth.id",
    "updateRule": "@request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.role = \"admin\"",
    "options": {}
  });

  return dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);

  try {
    const c = dao.findCollectionByNameOrId("on_call_shifts");
    dao.deleteCollection(c);
  } catch (_) {}

  return null;
});
