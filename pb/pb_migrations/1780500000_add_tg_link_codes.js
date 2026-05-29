/// <reference path="../pb_data/types.d.ts" />
// Creates the `tg_link_codes` collection for self-service Telegram account-linking.
//
// The web app mints a row when a logged-in user requests Telegram linking;
// the Telegram webhook redeems it via /start <code>.
//
// Fields:
//   code        — text, required, unique. Random hex one-time code minted by the app.
//   user        — relation to users, required, maxSelect 1, cascadeDelete true.
//   expires_at  — date, required. Mint time + 10 min (enforced in hook, not schema).
//   used        — bool, not required (defaults false). Set true on redeem.
//   used_at     — date, not required. Stamped on redeem for audit/debugging.
//
// Rules: all null — only server hooks using dao bypass can read/write.

migrate(
  (db) => {
    var dao = new Dao(db);

    var usersCol = dao.findCollectionByNameOrId("users");
    var usersId = usersCol.id;

    var c = new Collection({
      name: "tg_link_codes",
      type: "base",
      system: false,
      schema: [
        {
          system: false,
          id: "tglc_code",
          name: "code",
          type: "text",
          required: true,
          options: { min: 1, max: null, pattern: "" },
        },
        {
          system: false,
          id: "tglc_user",
          name: "user",
          type: "relation",
          required: true,
          options: {
            collectionId: usersId,
            cascadeDelete: true,
            minSelect: null,
            maxSelect: 1,
            displayFields: null,
          },
        },
        {
          system: false,
          id: "tglc_expires_at",
          name: "expires_at",
          type: "date",
          required: true,
          options: { min: "", max: "" },
        },
        {
          system: false,
          id: "tglc_used",
          name: "used",
          type: "bool",
          required: false,
          options: {},
        },
        {
          system: false,
          id: "tglc_used_at",
          name: "used_at",
          type: "date",
          required: false,
          options: { min: "", max: "" },
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_tg_link_codes_code` ON `tg_link_codes` (`code`)",
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    dao.saveCollection(c);
    console.log("[tg_link_codes] collection created.");
  },
  (db) => {
    var dao = new Dao(db);
    var c = dao.findCollectionByNameOrId("tg_link_codes");
    dao.deleteCollection(c);
    console.log("[tg_link_codes] collection dropped.");
  }
);
