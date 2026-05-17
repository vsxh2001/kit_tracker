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
// All logic inlined inside each callback — PB v0.22 Goja runs each hook
// invocation in an isolated runtime; module-level function declarations
// are NOT visible inside callbacks.

onModelBeforeCreate((e) => {
  const productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    // Missing product is caught by components_validate.pb.js
    return;
  }

  let product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    throw new BadRequestError("Cannot find linked product: " + productId);
  }

  const isSerialized = product.getBool("is_serialized");

  if (isSerialized) {
    const serial = e.model.getString("serial");
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
    const serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError(
        "This product is bulk (not serialized) — component must not have a serial."
      );
    }
    e.model.set("is_bulk", true);
    e.model.set("serial", "");
    const quantity = e.model.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}, "components");

onModelBeforeUpdate((e) => {
  const productId = e.model.getString("product");
  if (!productId || productId.trim() === "") {
    // Missing product is caught by components_validate.pb.js
    return;
  }

  let product;
  try {
    product = $app.dao().findRecordById("products", productId);
  } catch (err) {
    throw new BadRequestError("Cannot find linked product: " + productId);
  }

  const isSerialized = product.getBool("is_serialized");

  if (isSerialized) {
    const serial = e.model.getString("serial");
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
    const serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError(
        "This product is bulk (not serialized) — component must not have a serial."
      );
    }
    e.model.set("is_bulk", true);
    e.model.set("serial", "");
    const quantity = e.model.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}, "components");
