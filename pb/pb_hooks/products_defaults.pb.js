/// <reference path="../pb_data/types.d.ts" />
// Default-fill hook for the products collection.
//
// Scope: only fields where a "missing vs explicit-zero" ambiguity does NOT
// exist — i.e. text fields whose empty string is meaningfully equivalent to
// "no value provided". For bool/numeric fields, the call site owns the
// default (see services/products.ts:createProduct) because PB hooks cannot
// distinguish "field absent in request" from "field=false in request".

onRecordBeforeCreateRequest((e) => {
  // specs: default "{}" if empty so downstream JSON.parse won't throw
  const specs = e.record.getString("specs");
  if (!specs) {
    e.record.set("specs", "{}");
  }
}, "products");
