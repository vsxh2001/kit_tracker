/// <reference path="../pb_data/types.d.ts" />
// Allow admins to list ALL users so the admin Users management page
// (UsersPage.tsx → services/users.ts → listUsers) can render the full
// user table. Non-admins continue to see only their own row, which is
// fine — they have no UI that lists other users.

migrate((db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.listRule = "@request.auth.role = \"admin\" || id = @request.auth.id";
  dao.saveCollection(c);

  return null;
}, (db) => {
  const dao = new Dao(db);

  const c = dao.findCollectionByNameOrId("_pb_users_auth_");
  c.listRule = null;
  dao.saveCollection(c);

  return null;
});
