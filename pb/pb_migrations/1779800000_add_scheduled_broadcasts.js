/// <reference path="../pb_data/types.d.ts" />
// Creates the `scheduled_broadcasts` collection for admin-scheduled recurring
// WhatsApp broadcasts (e.g. "weekly status digest to admins Monday 9am").
//
// Fields:
//   name             — human label for the schedule
//   cron_expression  — standard 5-field cron (e.g. "0 9 * * 1" = Monday 9am UTC)
//   enabled          — whether the cron runner picks this up (default true)
//   recipient_filter — JSON string, same shape as POST /api/wa/broadcast recipientFilter
//   message          — JSON string, same shape as POST /api/wa/broadcast message
//   last_run_at      — updated by cron handler after each run (nullable)
//   last_result      — JSON string summary of last run (successCount, failed, etc.)
//   created_by       — relation to users

migrate(
  (db) => {
    var dao = new Dao(db);

    var usersCol = dao.findCollectionByNameOrId("users");
    var usersId = usersCol.id;

    var c = new Collection({
      name: "scheduled_broadcasts",
      type: "base",
      system: false,
      schema: [
        {
          name: "name",
          type: "text",
          required: true,
          options: { min: 1, max: null, pattern: "" },
        },
        {
          name: "cron_expression",
          type: "text",
          required: true,
          options: { min: 1, max: null, pattern: "" },
        },
        {
          name: "enabled",
          type: "bool",
          required: false,
          options: {},
        },
        {
          name: "recipient_filter",
          type: "text",
          required: true,
          options: { min: null, max: null, pattern: "" },
        },
        {
          name: "message",
          type: "text",
          required: true,
          options: { min: null, max: null, pattern: "" },
        },
        {
          name: "last_run_at",
          type: "date",
          required: false,
          options: { min: "", max: "" },
        },
        {
          name: "last_result",
          type: "text",
          required: false,
          options: { min: null, max: null, pattern: "" },
        },
        {
          name: "created_by",
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
      ],
      indexes: [],
      createRule: '@request.auth.role = "admin"',
      listRule:   '@request.auth.role = "admin"',
      viewRule:   '@request.auth.role = "admin"',
      updateRule: '@request.auth.role = "admin"',
      deleteRule: '@request.auth.role = "admin"',
    });

    dao.saveCollection(c);
    console.log("[scheduled_broadcasts] collection created.");
  },
  (db) => {
    var dao = new Dao(db);
    var c = dao.findCollectionByNameOrId("scheduled_broadcasts");
    dao.deleteCollection(c);
    console.log("[scheduled_broadcasts] collection dropped.");
  }
);
