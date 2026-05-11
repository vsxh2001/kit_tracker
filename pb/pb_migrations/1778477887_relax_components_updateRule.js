/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("components");
  c.updateRule = '@request.auth.role = "admin" || @request.auth.role = "technician"';
  dao.saveCollection(c);
  return null;
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("components");
  c.updateRule = '@request.auth.role = "admin"';
  dao.saveCollection(c);
  return null;
});
