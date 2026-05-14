/// <reference path="../pb_data/types.d.ts" />
// Default-fill hook for the products collection.
//
// Why: PocketBase v0.22 has no schema-level defaults for bool/text fields.
// All sibling collections rely on the call site to pass defaults explicitly.
// To keep is_active=true and specs="{}" guaranteed at the DB layer (and not
// just by convention), enforce them here on every create where the field
// was not explicitly set.

onRecordBeforeCreateRequest((e) => {
  // is_active: default true if not explicitly set
  if (!e.record.get("is_active")) {
    e.record.set("is_active", true);
  }
  // specs: default "{}" if empty so downstream JSON.parse won't throw
  const specs = e.record.getString("specs");
  if (!specs) {
    e.record.set("specs", "{}");
  }
}, "products");
