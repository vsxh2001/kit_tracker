/// <reference path="../pb_data/types.d.ts" />
// Add a DB-level partial unique index on kits.serial scoped to active rows.
//
// Migration 1778880000_kit_serial_not_unique dropped the global UNIQUE index
// on kits.serial so a retired (is_active=false) kit could free up its serial
// for reuse. The application-level guard lives in
// pb_hooks/kits_active_serial_unique.pb.js — but the DB had no constraint at
// all, so a hook misfire (Goja crash, future code path that skips the hook)
// would silently allow duplicate active serials.
//
// This mirrors the components pattern from
// 1780100000_components_serial_active_unique.js: partial UNIQUE INDEX with
// the same is_active=1 predicate. Retired kits may still share a serial
// with each other and with one active kit.

migrate(
  (db) => {
    db.newQuery(
      "DROP INDEX IF EXISTS idx_kits_serial"
    ).execute();
    db.newQuery(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_serial" +
      " ON kits (serial)" +
      " WHERE serial != '' AND serial IS NOT NULL AND is_active = 1"
    ).execute();

    // Keep collection metadata in sync so PB admin UI reflects the index.
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    const existing = (c.indexes || []).filter(
      (idx) => !/idx_kits_serial\b/i.test(String(idx))
    );
    existing.push(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_serial ON kits (serial) WHERE serial != '' AND serial IS NOT NULL AND is_active = 1"
    );
    c.indexes = existing;
    dao.saveCollection(c);
  },
  (db) => {
    db.newQuery(
      "DROP INDEX IF EXISTS idx_kits_serial"
    ).execute();

    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    c.indexes = (c.indexes || []).filter(
      (idx) => !/idx_kits_serial\b/i.test(String(idx))
    );
    dao.saveCollection(c);
  }
);
