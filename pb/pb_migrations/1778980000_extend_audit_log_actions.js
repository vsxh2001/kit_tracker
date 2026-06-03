/// <reference path="../pb_data/types.d.ts" />
// Extend audit_log.action select enum to include cascade and failure values.
// Before: ["create", "update", "delete"]
// After:  ["create", "update", "delete", "cascade_delete", "cascade_partial", "create_failed", "update_failed"]
//
// cascade_delete / cascade_partial — written by cascade_delete.pb.js
// create_failed / update_failed    — written by ai_mcp.pb.js
// Without this migration those writes fail enum validation and are silently
// swallowed, leaving hard-deletes and MCP failures with no audit trail.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
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
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("audit_log");
    const field = c.schema.getFieldByName("action");
    field.options.values = ["create", "update", "delete"];
    dao.saveCollection(c);
  }
);
