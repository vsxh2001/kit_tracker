/// <reference path="../pb_data/types.d.ts" />
// Creates the `invites` collection for admin-generated, single-use, 7-day-expiry invite links.
// Token hash (HMAC-SHA256) stored — raw token only lives in the URL the admin copies.

migrate(
  (db) => {
    var dao = new Dao(db);

    // Look up the users collection id for relation fields
    var usersCol = dao.findCollectionByNameOrId("users");
    var usersId = usersCol.id;

    var c = new Collection({
      name: "invites",
      type: "base",
      system: false,
      schema: [
        {
          name: "token_hash",
          type: "text",
          required: true,
          unique: true,
          options: { min: 1, max: null, pattern: "" },
        },
        {
          name: "created_by",
          type: "relation",
          required: true,
          options: {
            collectionId: usersId,
            cascadeDelete: false,
            minSelect: null,
            maxSelect: 1,
            displayFields: null,
          },
        },
        {
          name: "role",
          type: "select",
          required: true,
          options: { values: ["admin", "technician", "user", "viewer"], maxSelect: 1 },
        },
        {
          name: "expires_at",
          type: "date",
          required: true,
          options: { min: "", max: "" },
        },
        {
          name: "used_at",
          type: "date",
          required: false,
          options: { min: "", max: "" },
        },
        {
          name: "used_by",
          type: "relation",
          required: false,
          options: {
            collectionId: usersId,
            cascadeDelete: false,
            minSelect: null,
            maxSelect: 1,
            displayFields: null,
          },
        },
        {
          name: "revoked_at",
          type: "date",
          required: false,
          options: { min: "", max: "" },
        },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`)',
      ],
      createRule: '@request.auth.role = "admin"',
      listRule: '@request.auth.role = "admin"',
      viewRule: null,
      updateRule: null,
      deleteRule: '@request.auth.role = "admin"',
    });

    dao.saveCollection(c);
    console.log("[invites] collection created.");
  },
  (db) => {
    var dao = new Dao(db);
    var c = dao.findCollectionByNameOrId("invites");
    dao.deleteCollection(c);
    console.log("[invites] collection dropped.");
  }
);
