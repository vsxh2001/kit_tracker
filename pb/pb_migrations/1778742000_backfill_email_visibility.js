/// <reference path="../pb_data/types.d.ts" />
// Backfill emailVisibility=true for all existing users.
//
// Pairs with hook users_email_visibility.pb.js which sets it on every new
// create. This migration fixes records already in the database (e.g. OAuth
// signups before the hook landed) whose emailVisibility defaulted to false,
// causing the email field to be empty in admin /users responses.
//
// No down: we cannot reconstruct which users originally had emailVisibility
// false. If the policy ever reverses, write a new forward migration.

migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findRecordsByFilter("users", "id != ''", "", 0, 0);
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (!u.emailVisibility()) {
        u.setEmailVisibility(true);
        dao.saveRecord(u);
      }
    }
  },
  (db) => {
    // intentional no-op
  }
);
