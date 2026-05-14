/// <reference path="../pb_data/types.d.ts" />
// Backfill `name` for existing users where it's empty.
//
// Pairs with hook users_name_default.pb.js, which fills name=email-local-part
// on every new create. This migration fixes records already in the database
// (e.g. OAuth signups before the hook landed) whose name field was never set.
//
// No down: we cannot reconstruct which users originally had empty names.

migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findRecordsByFilter("users", "id != ''", "", 0, 0);
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const name = u.getString("name");
      if (name) continue;
      const email = u.getString("email");
      if (!email) continue;
      const at = email.indexOf("@");
      if (at <= 0) continue;
      u.set("name", email.substring(0, at));
      dao.saveRecord(u);
    }
  },
  (db) => {
    // intentional no-op
  }
);
