/// <reference path="../pb_data/types.d.ts" />
// Make components.quantity nullable at the SQLite level for serialized components.
//
// PocketBase stores number fields as NUMERIC NOT NULL DEFAULT 0, so changing
// field.required alone does not allow NULL at the DB level. This migration
// uses raw SQL to recreate the column as nullable, then updates the PB schema
// metadata so that field.options.min is cleared.
//
// UP:
//   1. Rename existing `quantity` column to `quantity_old`.
//   2. Add new `quantity NUMERIC DEFAULT NULL` (nullable).
//   3. Copy values from `quantity_old` to `quantity`.
//   4. Drop `quantity_old`.
//   5. Update PB collection schema: min=null.
//   6. Backfill: set quantity=NULL for serialized-product components.
//
// DOWN:
//   1. Backfill NULL → 1.
//   2. Rename `quantity` → `quantity_old`.
//   3. Add `quantity NUMERIC DEFAULT 0 NOT NULL`.
//   4. Copy values (NULLs become 0, others copy as-is).
//   5. Drop `quantity_old`.
//   6. Restore PB schema: min=1.

migrate(
  (db) => {
    const dao = new Dao(db);

    // Step 1: Recreate column as nullable
    // SQLite 3.25+ supports RENAME COLUMN; 3.35+ supports DROP COLUMN.
    db.newQuery("ALTER TABLE components RENAME COLUMN quantity TO quantity_old").execute();
    db.newQuery("ALTER TABLE components ADD COLUMN quantity NUMERIC DEFAULT NULL").execute();
    db.newQuery("UPDATE components SET quantity = quantity_old").execute();
    db.newQuery("ALTER TABLE components DROP COLUMN quantity_old").execute();

    // Step 2: Update PB schema metadata (options.min = null)
    const c = dao.findCollectionByNameOrId("components");
    const qty = c.schema.getFieldByName("quantity");
    if (qty) {
      qty.required = false;
      qty.options = { min: null, max: null, noDecimal: true };
    }
    dao.saveCollection(c);

    // Step 3: Backfill — set quantity=NULL for all serialized-product components
    db.newQuery(
      `UPDATE components
       SET quantity = NULL
       WHERE product IN (
         SELECT id FROM products WHERE is_serialized = 1
       )`
    ).execute();

    console.log("[components_quantity_nullable] UP done — quantity column is now nullable; serialized rows set to NULL");
    return null;
  },
  (db) => {
    const dao = new Dao(db);

    // Step 1: Backfill NULL → 1 before restoring NOT NULL constraint
    db.newQuery("UPDATE components SET quantity = 1 WHERE quantity IS NULL").execute();

    // Step 2: Recreate column as NOT NULL
    db.newQuery("ALTER TABLE components RENAME COLUMN quantity TO quantity_old").execute();
    db.newQuery("ALTER TABLE components ADD COLUMN quantity NUMERIC DEFAULT 0 NOT NULL").execute();
    db.newQuery("UPDATE components SET quantity = COALESCE(quantity_old, 1)").execute();
    db.newQuery("ALTER TABLE components DROP COLUMN quantity_old").execute();

    // Step 3: Restore PB schema metadata (min=1)
    const c = dao.findCollectionByNameOrId("components");
    const qty = c.schema.getFieldByName("quantity");
    if (qty) {
      qty.required = false;
      qty.options = { min: 1, max: null, noDecimal: true };
    }
    dao.saveCollection(c);

    console.log("[components_quantity_nullable] DOWN done — quantity column restored to NOT NULL; NULL rows set to 1");
    return null;
  }
);
