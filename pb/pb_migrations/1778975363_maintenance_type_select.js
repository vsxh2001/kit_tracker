/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);

    // Backfill existing rows to one of the 6 enum values before changing the schema.
    // Free-text → enum prefix matching. Unmatched → "other".
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'calibration' WHERE LOWER(type) LIKE '%calib%' OR LOWER(type) LIKE '%gauge%'").execute();
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'inspection' WHERE LOWER(type) LIKE '%inspect%' OR LOWER(type) LIKE '%check%' OR LOWER(type) LIKE '%audit%'").execute();
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'service' WHERE LOWER(type) LIKE '%service%' OR LOWER(type) LIKE '%maintenance%'").execute();
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'replacement' WHERE LOWER(type) LIKE '%replac%' OR LOWER(type) LIKE '%battery%'").execute();
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'certification' WHERE LOWER(type) LIKE '%cert%' OR LOWER(type) LIKE '%license%'").execute();
    db.newQuery("UPDATE kit_maintenance_schedules SET type = 'other' WHERE type NOT IN ('calibration','inspection','service','replacement','certification','other')").execute();

    // Now change the field to select
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    const field = c.schema.getFieldByName("type");
    field.type = "select";
    field.options = {
      maxSelect: 1,
      values: ["calibration", "inspection", "service", "replacement", "certification", "other"]
    };
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    const field = c.schema.getFieldByName("type");
    field.type = "text";
    field.options = { min: null, max: null, pattern: "" };
    dao.saveCollection(c);
  }
);
