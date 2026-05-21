/// <reference path="../pb_data/types.d.ts" />
// Tighten audit_log.createRule to prevent impersonation.
//
// Previous rule "@request.auth.id != ''" allowed any authenticated user to write
// arbitrary audit_log rows — forging collection_name, record_id, actor, action.
//
// New rule:
//   - Admins can write any row (preserves admin tooling).
//   - Non-admins can only write action=frontend_error AND must set actor to their
//     own auth ID (no impersonation of other users).

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    c.createRule =
      '@request.auth.role = "admin" || (@request.data.action = "frontend_error" && @request.data.actor = @request.auth.id)';
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    // Restore previous (overly permissive) rule
    c.createRule = "@request.auth.id != ''";
    dao.saveCollection(c);
  }
);
