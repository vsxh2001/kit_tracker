/// <reference path="../pb_data/types.d.ts" />
// Drop UNIQUE constraint on kits.serial.
//
// Original migration 1778299274_fix_rules_and_indexes.js made serial unique
// via field.unique=true + CREATE UNIQUE INDEX idx_kits_serial. Together that
// blocks re-creating a kit with a serial already taken by a retired (soft-
// deleted, is_active=false) kit. Drop both so admins can re-issue a serial
// after retiring its old holder.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    const serial = c.schema.getFieldByName("serial");
    if (serial) {
      serial.unique = false;
    }
    c.indexes = (c.indexes || []).filter(
      (idx) => !/idx_kits_serial\b/i.test(String(idx))
    );
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    const serial = c.schema.getFieldByName("serial");
    if (serial) {
      serial.unique = true;
    }
    const existing = c.indexes || [];
    const hasUnique = existing.some((idx) => /idx_kits_serial\b/i.test(String(idx)));
    if (!hasUnique) {
      existing.push("CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_serial ON kits (serial)");
    }
    c.indexes = existing;
    dao.saveCollection(c);
  }
);
