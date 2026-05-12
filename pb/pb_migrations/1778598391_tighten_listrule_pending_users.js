/// <reference path="../pb_data/types.d.ts" />
// Tighten listRule and viewRule on all data collections to deny pending users
// (role=""). Previously any authenticated user could list/view all records
// regardless of role. After this migration, role="" users (awaiting admin
// approval) get 0 results on data collections.
//
// users collection is intentionally NOT touched — pending users need to read
// their own row so the frontend can detect role="" and show the awaiting-
// approval banner.

const TIGHTENED_RULE = '@request.auth.id != "" && @request.auth.role != ""';
const PREVIOUS_RULE  = '@request.auth.id != ""';

const COLLECTIONS = [
  "kits",
  "entities",
  "transactions",
  "requests",
  "components",
  "component_transactions",
];

migrate((db) => {
  const dao = new Dao(db);

  for (const name of COLLECTIONS) {
    let c;
    try {
      c = dao.findCollectionByNameOrId(name);
    } catch (_) {
      // Collection may not exist in all environments; skip gracefully.
      continue;
    }
    c.listRule = TIGHTENED_RULE;
    c.viewRule = TIGHTENED_RULE;
    dao.saveCollection(c);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);

  for (const name of COLLECTIONS) {
    let c;
    try {
      c = dao.findCollectionByNameOrId(name);
    } catch (_) {
      continue;
    }
    c.listRule = PREVIOUS_RULE;
    c.viewRule = PREVIOUS_RULE;
    dao.saveCollection(c);
  }

  return null;
});
