/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("users");
    col.deleteRule = '@request.auth.role = "admin"';
    dao.saveCollection(col);
  },
  (db) => {
    // Revert: restore deleteRule to null (superuser only)
    const dao = new Dao(db);
    const col = dao.findCollectionByNameOrId("users");
    col.deleteRule = null;
    dao.saveCollection(col);
  }
);
