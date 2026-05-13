/// <reference path="../pb_data/types.d.ts" />
// Grant technician role parity with admin across operational collections,
// EXCEPT user management (users/_pb_users_auth_ unchanged).
//
// Collections updated:
//   kits                    : createRule, updateRule
//   entities                : createRule, updateRule
//   components              : createRule (updateRule already relaxed in 1778477887)
//   kit_maintenance_schedules: createRule, updateRule
//   on_call_shifts          : createRule (retains created_by=self), updateRule, deleteRule
//   audit_log               : listRule, viewRule

const ADMIN_OR_TECH = '@request.auth.role = "admin" || @request.auth.role = "technician"';

migrate((db) => {
  const dao = new Dao(db);

  // ---- kits ----
  {
    const c = dao.findCollectionByNameOrId("kits");
    c.createRule = ADMIN_OR_TECH;
    c.updateRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  // ---- entities ----
  {
    const c = dao.findCollectionByNameOrId("entities");
    c.createRule = ADMIN_OR_TECH;
    c.updateRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  // ---- components (createRule only; updateRule already admin||tech) ----
  {
    const c = dao.findCollectionByNameOrId("components");
    c.createRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  // ---- kit_maintenance_schedules ----
  {
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    c.createRule = ADMIN_OR_TECH;
    c.updateRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  // ---- on_call_shifts: keep created_by = self clause ----
  {
    const c = dao.findCollectionByNameOrId("on_call_shifts");
    c.createRule = '(' + ADMIN_OR_TECH + ') && @request.data.created_by = @request.auth.id';
    c.updateRule = ADMIN_OR_TECH;
    c.deleteRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  // ---- audit_log ----
  {
    const c = dao.findCollectionByNameOrId("audit_log");
    c.listRule = ADMIN_OR_TECH;
    c.viewRule = ADMIN_OR_TECH;
    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  // ---- kits ----
  {
    const c = dao.findCollectionByNameOrId("kits");
    c.createRule = '@request.auth.role = "admin"';
    c.updateRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  // ---- entities ----
  {
    const c = dao.findCollectionByNameOrId("entities");
    c.createRule = '@request.auth.role = "admin"';
    c.updateRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  // ---- components ----
  {
    const c = dao.findCollectionByNameOrId("components");
    c.createRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  // ---- kit_maintenance_schedules ----
  {
    const c = dao.findCollectionByNameOrId("kit_maintenance_schedules");
    c.createRule = '@request.auth.role = "admin"';
    c.updateRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  // ---- on_call_shifts ----
  {
    const c = dao.findCollectionByNameOrId("on_call_shifts");
    c.createRule = '@request.auth.role = "admin" && @request.data.created_by = @request.auth.id';
    c.updateRule = '@request.auth.role = "admin"';
    c.deleteRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  // ---- audit_log ----
  {
    const c = dao.findCollectionByNameOrId("audit_log");
    c.listRule = '@request.auth.role = "admin"';
    c.viewRule = '@request.auth.role = "admin"';
    dao.saveCollection(c);
  }

  return null;
});
