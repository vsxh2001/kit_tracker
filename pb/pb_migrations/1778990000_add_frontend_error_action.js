/// <reference path="../pb_data/types.d.ts" />
// Add frontend_error to audit_log.action enum and open createRule to any auth user.
//
// frontend_error — written by React ErrorBoundary on uncaught render errors.
// createRule change: null → "@request.auth.id != ''" so the frontend SDK can POST
// rows directly. listRule stays admin-only; enum constrains the action field.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    // Extend action enum
    const field = c.schema.getFieldByName("action");
    field.options.values = [
      "create",
      "update",
      "delete",
      "cascade_delete",
      "cascade_partial",
      "create_failed",
      "update_failed",
      "frontend_error",
    ];
    // Open createRule to any authenticated user
    c.createRule = "@request.auth.id != ''";
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    // Restore action enum (without frontend_error)
    const field = c.schema.getFieldByName("action");
    field.options.values = [
      "create",
      "update",
      "delete",
      "cascade_delete",
      "cascade_partial",
      "create_failed",
      "update_failed",
    ];
    // Restore createRule to null (DAO-only)
    c.createRule = null;
    dao.saveCollection(c);
  }
);
