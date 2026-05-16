/// <reference path="../pb_data/types.d.ts" />
// Enforce serial/qty rules based on the linked product's is_serialized flag.
//
// If product.is_serialized = true:
//   - serial must be non-empty
//   - is_bulk is forced to false
//   - quantity is forced to 1
//
// If product.is_serialized = false:
//   - is_bulk is forced to true
//   - serial is forced to ""
//   - quantity must be >= 1
//
// This hook fires on model events so that dao.save() calls from
// ai_chat.pb.js / ai_mcp.pb.js are also covered.
//
// NOTE: Logic is inlined in each callback — Goja (PB's JS runtime) does not
// share module-level function scope inside onModel* callbacks. A helper
// function declared at module level is NOT visible inside the callback body.
// See audit_log.pb.js for the same pattern.

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
    // Force is_bulk=false and quantity=1 for serialized products
    e.model.set("is_bulk", false);
    e.model.set("quantity", 1);
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
    // Force is_bulk=false and quantity=1 for serialized products
    e.model.set("is_bulk", false);
    e.model.set("quantity", 1);
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
