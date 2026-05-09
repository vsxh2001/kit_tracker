/// <reference path="../pb_data/types.d.ts" />
// Tightens collection rules, adds kits.serial uniqueness, and creates
// indexes for hot-path queries (current-holder derivation, request listing).
//
// NOTE: if duplicate kits.serial values exist in current data, the unique
// index creation will fail at runtime. Manually deduplicate first via:
//   SELECT serial, COUNT(*) FROM kits GROUP BY serial HAVING COUNT(*) > 1;
// then re-run the migration.

migrate((db) => {
  const dao = new Dao(db);

  // -------- kits --------
  {
    const c = dao.findCollectionByNameOrId("kits");
    c.createRule = "@request.auth.role = \"admin\"";
    c.updateRule = "@request.auth.role = \"admin\"";
    c.deleteRule = null;

    const serial = c.schema.getFieldByName("serial");
    if (serial) {
      serial.unique = true;
    }

    c.indexes = [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_serial ON kits (serial)"
    ];
    dao.saveCollection(c);
  }

  // -------- entities --------
  {
    const c = dao.findCollectionByNameOrId("entities");
    c.createRule = "@request.auth.role = \"admin\"";
    c.updateRule = "@request.auth.role = \"admin\"";
    c.deleteRule = null;
    dao.saveCollection(c);
  }

  // -------- transactions --------
  {
    const c = dao.findCollectionByNameOrId("transactions");
    c.createRule = "@request.auth.id != \"\" && @request.data.created_by = @request.auth.id";
    c.updateRule = null;
    c.deleteRule = null;

    c.indexes = [
      "CREATE INDEX IF NOT EXISTS idx_transactions_kit_ts ON transactions (kit, timestamp DESC, created DESC)",
      "CREATE INDEX IF NOT EXISTS idx_transactions_request ON transactions (request)",
      "CREATE INDEX IF NOT EXISTS idx_transactions_created_by ON transactions (created_by)"
    ];
    dao.saveCollection(c);
  }

  // -------- requests --------
  {
    const c = dao.findCollectionByNameOrId("requests");
    c.createRule = "@request.auth.role = \"admin\" || @request.auth.role = \"user\"";
    c.updateRule = "@request.auth.role = \"admin\" || (@request.auth.id = requester && status = \"open\")";
    c.deleteRule = "@request.auth.role = \"admin\" || (@request.auth.id = requester && status = \"open\")";

    c.indexes = [
      "CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status)",
      "CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests (requester)"
    ];
    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  {
    const c = dao.findCollectionByNameOrId("kits");
    c.createRule = "@request.auth.id != \"\"";
    c.updateRule = "@request.auth.id != \"\"";
    c.deleteRule = null;
    const serial = c.schema.getFieldByName("serial");
    if (serial) serial.unique = false;
    c.indexes = [];
    dao.saveCollection(c);
  }

  {
    const c = dao.findCollectionByNameOrId("entities");
    c.createRule = "@request.auth.id != \"\"";
    c.updateRule = "@request.auth.id != \"\"";
    c.deleteRule = null;
    dao.saveCollection(c);
  }

  {
    const c = dao.findCollectionByNameOrId("transactions");
    c.createRule = "@request.auth.id != \"\"";
    c.updateRule = null;
    c.deleteRule = null;
    c.indexes = [];
    dao.saveCollection(c);
  }

  {
    const c = dao.findCollectionByNameOrId("requests");
    c.createRule = "@request.auth.id != \"\"";
    c.updateRule = "@request.auth.id != \"\"";
    c.deleteRule = null;
    c.indexes = [];
    dao.saveCollection(c);
  }

  return null;
});
