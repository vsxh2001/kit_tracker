/// <reference path="../pb_data/types.d.ts" />
// Adds "technician" role:
//   1. Extends users.role select enum to include "technician"
//      NOTE: the values array is set in full — this silently re-adds "" (pending/empty)
//      which was already present; it is intentional and required for the enum to remain valid.
//   2. Tightens transactions.createRule — only admin/technician can create
//   3. Extends requests.updateRule — technician can approve/reject/fulfill

migrate((db) => {
  const dao = new Dao(db);

  // -------- 1. users.role: add "technician" to enum --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    const roleField = c.schema.getFieldByName("role");
    roleField.options.values = ["", "admin", "technician", "user", "viewer"];
    c.schema.addField(roleField);
    dao.saveCollection(c);
  }

  // -------- 2. transactions.createRule: restrict to admin + technician --------
  {
    const c = dao.findCollectionByNameOrId("transactions");
    c.createRule = "(@request.auth.role = \"admin\" || @request.auth.role = \"technician\") && @request.data.created_by = @request.auth.id";
    dao.saveCollection(c);
  }

  // -------- 3. requests.updateRule: allow technician to manage requests --------
  {
    const c = dao.findCollectionByNameOrId("requests");
    c.updateRule = "@request.auth.role = \"admin\" || @request.auth.role = \"technician\" || (@request.auth.id = requester && status = \"open\")";
    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // -------- 1. users.role: remove "technician" from enum --------
  {
    const c = dao.findCollectionByNameOrId("_pb_users_auth_");
    const roleField = c.schema.getFieldByName("role");
    roleField.options.values = ["", "admin", "user", "viewer"];
    c.schema.addField(roleField);
    dao.saveCollection(c);
  }

  // -------- 2. transactions.createRule: restore prior rule (any auth + own created_by) --------
  {
    const c = dao.findCollectionByNameOrId("transactions");
    c.createRule = "@request.auth.id != \"\" && @request.data.created_by = @request.auth.id";
    dao.saveCollection(c);
  }

  // -------- 3. requests.updateRule: restore prior rule --------
  {
    const c = dao.findCollectionByNameOrId("requests");
    c.updateRule = "@request.auth.role = \"admin\" || (@request.auth.id = requester && status = \"open\")";
    dao.saveCollection(c);
  }

  return null;
});
