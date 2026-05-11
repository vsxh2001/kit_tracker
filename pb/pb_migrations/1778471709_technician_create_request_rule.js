/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("requests");
  // Currently: admin OR user role. Add technician.
  c.createRule = '@request.auth.role = "admin" || @request.auth.role = "technician" || @request.auth.role = "user"';
  dao.saveCollection(c);
  return null;
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("requests");
  c.createRule = '@request.auth.role = "admin" || @request.auth.role = "user"';
  dao.saveCollection(c);
  return null;
});
