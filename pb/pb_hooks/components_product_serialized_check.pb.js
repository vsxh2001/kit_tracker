/// <reference path="../pb_data/types.d.ts" />
// Enforce serial/qty rules based on the linked product's is_serialized flag.
//
// If product.is_serialized = true:  serial non-empty, is_bulk forced false, quantity forced 1
// If product.is_serialized = false: is_bulk forced true, serial forced "", quantity >= 1
//
// Logic INLINED per callback (NOT extracted to module-level helper) — Goja
// isolates each onModel* registration's scope; module-level functions are not
// visible inside callbacks → ReferenceError → silent 400 on every component
// create. See project_pb_module_state_isolation memory + PR #11 incident.

onModelBeforeCreate((e) => {
  const productId = e.model.getString("product");
  if (!productId || productId.trim() === "") return;
  let product;
  try { product = $app.dao().findRecordById("products", productId); }
  catch (err) { throw new BadRequestError("Cannot find linked product: " + productId); }
  const isSerialized = product.getBool("is_serialized");
  if (isSerialized) {
    const serial = e.model.getString("serial");
    if (!serial || serial.trim() === "") {
      throw new BadRequestError("This product is serialized — component must have a non-empty serial.");
    }
    e.model.set("is_bulk", false);
    e.model.set("quantity", 1);
  } else {
    const serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError("This product is bulk (not serialized) — component must not have a serial.");
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
  if (!productId || productId.trim() === "") return;
  let product;
  try { product = $app.dao().findRecordById("products", productId); }
  catch (err) { throw new BadRequestError("Cannot find linked product: " + productId); }
  const isSerialized = product.getBool("is_serialized");
  if (isSerialized) {
    const serial = e.model.getString("serial");
    if (!serial || serial.trim() === "") {
      throw new BadRequestError("This product is serialized — component must have a non-empty serial.");
    }
    e.model.set("is_bulk", false);
    e.model.set("quantity", 1);
  } else {
    const serial = e.model.getString("serial");
    if (serial && serial.trim() !== "") {
      throw new BadRequestError("This product is bulk (not serialized) — component must not have a serial.");
    }
    e.model.set("is_bulk", true);
    e.model.set("serial", "");
    const quantity = e.model.getInt("quantity");
    if (quantity < 1) {
      throw new BadRequestError("Bulk component quantity must be >= 1.");
    }
  }
}, "components");
