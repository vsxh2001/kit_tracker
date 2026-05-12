/// <reference path="../pb_data/types.d.ts" />
// Adds `kit_maintenance_schedules` and `maintenance_records` collections.
//
// kit_maintenance_schedules: tracks recurring maintenance tasks per kit
//   (calibration, service, inspection, etc.).  next_due_at is materialized
//   and kept current by the maintenance_update_next_due hook.
//
// maintenance_records: append-only log of completed maintenance events.
//   Creating a record triggers the hook that updates last_done_at / next_due_at
//   on the parent schedule.

migrate((db) => {
  const dao = new Dao(db);

  const kitsCol  = dao.findCollectionByNameOrId("kits");
  const usersCol = dao.findCollectionByNameOrId("users");

  // -------- kit_maintenance_schedules --------
  {
    const c = new Collection({
      "name": "kit_maintenance_schedules",
      "type": "base",
      "system": false,
      "schema": [
        {
          "system": false,
          "id": "kms_kit",
          "name": "kit",
          "type": "relation",
          "required": true,
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
          "id": "kms_type",
          "name": "type",
          "type": "text",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "kms_description",
          "name": "description",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "kms_interval_days",
          "name": "interval_days",
          "type": "number",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": 1, "max": null, "noDecimal": true }
        },
        {
          "system": false,
          "id": "kms_last_done_at",
          "name": "last_done_at",
          "type": "date",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": "", "max": "" }
        },
        {
          "system": false,
          "id": "kms_next_due_at",
          "name": "next_due_at",
          "type": "date",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": "", "max": "" }
        },
        {
          "system": false,
          "id": "kms_is_active",
          "name": "is_active",
          "type": "bool",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {}
        },
        {
          "system": false,
          "id": "kms_notes",
          "name": "notes",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        }
      ],
      "indexes": [
        "CREATE INDEX IF NOT EXISTS idx_kms_kit_active ON kit_maintenance_schedules (kit, is_active)"
      ],
      "listRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
      "viewRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
      "createRule": "@request.auth.role = \"admin\"",
      "updateRule": "@request.auth.role = \"admin\"",
      "deleteRule": null,
      "options": {}
    });

    dao.saveCollection(c);
  }

  // -------- maintenance_records --------
  {
    const schedCol = dao.findCollectionByNameOrId("kit_maintenance_schedules");

    const c = new Collection({
      "name": "maintenance_records",
      "type": "base",
      "system": false,
      "schema": [
        {
          "system": false,
          "id": "mr_schedule",
          "name": "schedule",
          "type": "relation",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": {
            "collectionId": schedCol.id,
            "cascadeDelete": false,
            "minSelect": null,
            "maxSelect": 1,
            "displayFields": null
          }
        },
        {
          "system": false,
          "id": "mr_performed_at",
          "name": "performed_at",
          "type": "date",
          "required": true,
          "presentable": false,
          "unique": false,
          "options": { "min": "", "max": "" }
        },
        {
          "system": false,
          "id": "mr_performed_by",
          "name": "performed_by",
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
          "id": "mr_notes",
          "name": "notes",
          "type": "text",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": null, "max": null, "pattern": "" }
        },
        {
          "system": false,
          "id": "mr_certificate",
          "name": "certificate",
          "type": "file",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": {
            "maxSelect": 1,
            "maxSize": 5242880,
            "mimeTypes": ["application/pdf", "image/jpeg", "image/png", "image/webp"],
            "thumbs": [],
            "protected": false
          }
        },
        {
          "system": false,
          "id": "mr_next_due_snapshot",
          "name": "next_due_snapshot",
          "type": "date",
          "required": false,
          "presentable": false,
          "unique": false,
          "options": { "min": "", "max": "" }
        }
      ],
      "indexes": [
        "CREATE INDEX IF NOT EXISTS idx_mr_schedule_performed ON maintenance_records (schedule, performed_at DESC)"
      ],
      "listRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
      "viewRule": "@request.auth.id != \"\" && @request.auth.role != \"\"",
      "createRule": "(@request.auth.role = \"admin\" || @request.auth.role = \"technician\") && @request.data.performed_by = @request.auth.id",
      "updateRule": null,
      "deleteRule": null,
      "options": {}
    });

    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // Delete maintenance_records first (depends on kit_maintenance_schedules).
  try {
    const mr = dao.findCollectionByNameOrId("maintenance_records");
    dao.deleteCollection(mr);
  } catch (_) {}

  try {
    const kms = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    dao.deleteCollection(kms);
  } catch (_) {}

  return null;
});
