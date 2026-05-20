/// <reference path="../pb_data/types.d.ts" />
// Change `kit_maintenance_schedules.type` from free-text to select with 6
// controlled values.  Existing rows are backfilled via prefix match:
//   calib*                          → calibration
//   inspect*                        → inspection
//   service* | repair*              → service
//   replac* | change* | battery*    → replacement
//   cert*                           → certification
//   anything else                   → other

migrate(
  (db) => {
    // Backfill existing rows before tightening the schema.
    db.newQuery(`
      UPDATE kit_maintenance_schedules
      SET type = CASE
        WHEN LOWER(type) GLOB 'calib*'                            THEN 'calibration'
        WHEN LOWER(type) GLOB 'inspect*'                          THEN 'inspection'
        WHEN LOWER(type) GLOB 'service*' OR LOWER(type) GLOB 'repair*' THEN 'service'
        WHEN LOWER(type) GLOB 'replac*'  OR LOWER(type) GLOB 'change*' OR LOWER(type) GLOB 'battery*' THEN 'replacement'
        WHEN LOWER(type) GLOB 'cert*'                             THEN 'certification'
        ELSE 'other'
      END
    `).execute();

    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    const field = c.schema.getFieldByName("type");

    field.type = "select";
    field.options = {
      maxSelect: 1,
      values: ["calibration", "inspection", "service", "replacement", "certification", "other"],
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
