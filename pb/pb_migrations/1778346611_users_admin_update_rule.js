/// <reference path="../pb_data/types.d.ts" />
// Allow admins to update any user record (needed for user-management dashboard),
// while still allowing users to update their own record.

migrate((db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.updateRule = "@request.auth.role = \"admin\" || id = @request.auth.id";
  dao.saveCollection(c);

  return null;
}, (db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.updateRule = null;
  dao.saveCollection(c);

  return null;
});
