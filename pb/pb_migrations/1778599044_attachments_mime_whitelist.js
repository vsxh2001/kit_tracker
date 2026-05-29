/// <reference path="../pb_data/types.d.ts" />
// H2: Restrict kits.attachments to an explicit MIME whitelist.
// protected=false here; set to true in follow-up migration 1780200000_kits_attachments_protected.js.

migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    const existing = c.schema.getFieldByName("attachments");
    if (!existing) return; // field not present, nothing to do

    c.schema.removeField(existing.id);
    c.schema.addField(new SchemaField({
      system: false,
      id: existing.id,
      name: "attachments",
      type: "file",
      required: false,
      presentable: false,
      unique: false,
      options: {
        maxSelect: 10,
        maxSize: 5242880,
        mimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "application/pdf",
          "application/zip",
          "application/x-zip-compressed",
          "text/plain",
          "text/csv"
        ],
        thumbs: [],
        protected: false // upgraded to true in migration 1780200000
      }
    }));
    return dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId("kits");
    const existing = c.schema.getFieldByName("attachments");
    if (!existing) return;

    c.schema.removeField(existing.id);
    c.schema.addField(new SchemaField({
      system: false,
      id: existing.id,
      name: "attachments",
      type: "file",
      required: false,
      presentable: false,
      unique: false,
      options: {
        maxSelect: 10,
        maxSize: 5242880,
        mimeTypes: [],
        thumbs: [],
        protected: false
      }
    }));
    return dao.saveCollection(c);
  }
);
