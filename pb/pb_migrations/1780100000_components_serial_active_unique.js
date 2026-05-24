/// <reference path="../pb_data/types.d.ts" />
// Change components.serial uniqueness from global to active-scoped, matching
// kits/entities behavior.
//
// Old: UNIQUE WHERE serial != '' AND serial IS NOT NULL
//   → soft-deleted component's serial permanently burned until hard-delete
//
// New: UNIQUE WHERE serial != '' AND serial IS NOT NULL AND is_active = 1
//   → serial can be reused after a component is soft-deleted (is_active=false)
//
// The hook components_active_serial_unique.pb.js already only constrains
// is_active=true rows; the DB index now matches that semantics.
// Tracked in issue #98.

migrate(
  (db) => {
    db.newQuery(
      "DROP INDEX IF EXISTS idx_components_serial"
    ).execute();
    db.newQuery(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_components_serial" +
      " ON components (serial)" +
      " WHERE serial != '' AND serial IS NOT NULL AND is_active = 1"
    ).execute();

    // Update stored collection metadata so the PocketBase admin UI reflects
    // the new index definition.
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("components");
    c.indexes = (c.indexes || []).map((idx) =>
      idx.includes("idx_components_serial")
        ? "CREATE UNIQUE INDEX IF NOT EXISTS idx_components_serial ON components (serial) WHERE serial != '' AND serial IS NOT NULL AND is_active = 1"
        : idx
    );
    dao.saveCollection(c);
  },
  (db) => {
    db.newQuery(
      "DROP INDEX IF EXISTS idx_components_serial"
    ).execute();
    db.newQuery(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_components_serial" +
      " ON components (serial)" +
      " WHERE serial != '' AND serial IS NOT NULL"
    ).execute();

    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("components");
    c.indexes = (c.indexes || []).map((idx) =>
      idx.includes("idx_components_serial")
        ? "CREATE UNIQUE INDEX IF NOT EXISTS idx_components_serial ON components (serial) WHERE serial != '' AND serial IS NOT NULL"
        : idx
    );
    dao.saveCollection(c);
  }
);
