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

function checkProductSerializedRule(record) {
  const productId = record.getString("product");
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
    const serial = record.getString("serial");
    if (!serial || serial.trim() === "") {
      throw new BadRequestError(
        "This product is serialized — component must have a non-empty serial."
      );
    }
    // Force is_bulk=false and quantity=1 for serialized products
    record.set("is_bulk", false);
    record.set("quantity", 1);
  } else {
    // Bulk product: force is_bulk=true, clear serial, require quantity >= 1
    const serial = record.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError(
        "This product is bulk (not serialized) — component must not have a serial."
      );
    }
    record.set("is_bulk", true);
    record.set("serial", "");
    const quantity = record.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}

onModelBeforeCreate((e) => {
  checkProductSerializedRule(e.model);
}, "components");

onModelBeforeUpdate((e) => {
  checkProductSerializedRule(e.model);
}, "components");
