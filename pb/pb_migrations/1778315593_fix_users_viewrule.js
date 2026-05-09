/// <reference path="../pb_data/types.d.ts" />
// Allow any authenticated user to read user records so that
// expand: requester works on requests pages for non-admin users.

migrate((db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.viewRule = "@request.auth.id != \"\"";
  dao.saveCollection(c);

  return null;
}, (db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.viewRule = null;
  dao.saveCollection(c);

  return null;
});
