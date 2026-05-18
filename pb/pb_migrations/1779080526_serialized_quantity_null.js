/// <reference path="../pb_data/types.d.ts" />
// Data cleanup: set quantity = NULL for serialized-product components that were
// incorrectly stored as 0 due to a bug in ai_mcp.pb.js (line 1102 used quantity=0
// for serialized components instead of omitting the field, bypassing the
// components_product_serialized_check.pb.js AfterCreate hook that enforces NULL).
//
// UP:   UPDATE components SET quantity = NULL WHERE linked product is_serialized = 1
// DOWN: no-op — restoring 0 from NULL is arbitrary and destructive

migrate(
  (db) => {
    db.newQuery(
      `UPDATE components SET quantity = NULL
       WHERE id IN (
         SELECT c.id FROM components c
         JOIN products p ON c.product = p.id
         WHERE p.is_serialized = 1
       )`
    ).execute();

    console.log("[serialized_quantity_null] UP done — serialized component rows set to quantity=NULL");
    return null;
  },
  (db) => {
    // no-op: restoring quantity=0 from NULL is destructive and arbitrary
    console.log("[serialized_quantity_null] DOWN no-op");
    return null;
  }
);
