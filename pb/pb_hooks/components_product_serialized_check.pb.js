/// <reference path="../pb_data/types.d.ts" />
// Enforce serial/qty rules based on the linked product's is_serialized flag.
//
// If product.is_serialized = true:
//   - serial must be non-empty
//   - is_bulk is forced to false
//   - quantity is forced to NULL (serialized components have no meaningful quantity)
//
// If product.is_serialized = false:
//   - is_bulk is forced to true
//   - serial is forced to ""
//   - quantity must be >= 1
//
// This hook fires on model events so that dao.save() calls from
// ai_mcp.pb.js are also covered.
//
// NOTE: Logic is inlined in each callback — Goja (PB's JS runtime) does not
// share module-level function scope inside onModel* callbacks. A helper
// function declared at module level is NOT visible inside the callback body.
// See audit_log.pb.js for the same pattern.
//
// NOTE on null: Goja converts null to 0 when passed to a NUMERIC field via
// record.set(). To truly store NULL we use a raw SQL UPDATE in After* hooks.
// The Before* hooks do validation; After* hooks set quantity=NULL for serialized.

onModelBeforeCreate((e) => {
  var productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    // Missing product is caught by components_validate.pb.js
    return;
  }

  var product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    throw new BadRequestError("Cannot find linked product: " + productId);
  }

  var isSerialized = product.getBool("is_serialized");

  if (isSerialized) {
    var serial = e.model.getString("serial");
    if (!serial || serial.trim() === "") {
      throw new BadRequestError(
        "This product is serialized — component must have a non-empty serial."
      );
    }
    // Force in-memory quantity to null so POST response doesn't echo client-sent value.
    // Goja serializes null to 0 in REST, but 0 is closer to "no quantity" than client's stale value.
    // After hook still corrects DB to true NULL.
    try { e.model.set("quantity", null); } catch (_) {}
    // Force is_bulk=false; quantity will be nulled in onModelAfterCreate
    e.model.set("is_bulk", false);
  } else {
    // Bulk product: force is_bulk=true, clear serial, require quantity >= 1
    var serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError(
        "This product is bulk (not serialized) — component must not have a serial."
      );
    }
    e.model.set("is_bulk", true);
    e.model.set("serial", "");
    var quantity = e.model.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}, "components");

onModelAfterCreate((e) => {
  var productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    return;
  }

  var product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    return; // validated in Before hook already
  }

  if (!product.getBool("is_serialized")) {
    return;
  }

  // Serialized component: set quantity=NULL via raw SQL
  // (record.set(null) converts to 0 in Goja for NUMERIC fields)
  var id = e.model.getString("id");
  $app.dao().db().newQuery("UPDATE `components` SET `quantity` = NULL WHERE `id` = {:id}").bind({ id: id }).execute();
}, "components");

onModelBeforeUpdate((e) => {
  var productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    // Missing product is caught by components_validate.pb.js
    return;
  }

  var product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    throw new BadRequestError("Cannot find linked product: " + productId);
  }

  var isSerialized = product.getBool("is_serialized");

  if (isSerialized) {
    var serial = e.model.getString("serial");
    if (!serial || serial.trim() === "") {
      throw new BadRequestError(
        "This product is serialized — component must have a non-empty serial."
      );
    }
    // Force in-memory quantity to null so response doesn't echo client-sent value.
    // Goja serializes null to 0 in REST, but 0 is closer to "no quantity" than client's stale value.
    // After hook still corrects DB to true NULL.
    try { e.model.set("quantity", null); } catch (_) {}
    // Force is_bulk=false; quantity will be nulled in onModelAfterUpdate
    e.model.set("is_bulk", false);
  } else {
    // Bulk product: force is_bulk=true, clear serial, require quantity >= 1
    var serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError(
        "This product is bulk (not serialized) — component must not have a serial."
      );
    }
    e.model.set("is_bulk", true);
    e.model.set("serial", "");
    var quantity = e.model.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}, "components");

onModelAfterUpdate((e) => {
  var productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    return;
  }

  var product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    return;
  }

  if (!product.getBool("is_serialized")) {
    return;
  }

  // Serialized component: set quantity=NULL via raw SQL
  var id = e.model.getString("id");
  $app.dao().db().newQuery("UPDATE `components` SET `quantity` = NULL WHERE `id` = {:id}").bind({ id: id }).execute();
}, "components");
