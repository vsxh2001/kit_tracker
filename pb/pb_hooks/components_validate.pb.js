/// <reference path="../pb_data/types.d.ts" />
// Validates components and component_transactions before create/update.
//
// components rules:
//   - Serialized (is_bulk=false): serial must be non-empty.
//   - Bulk (is_bulk=true): quantity must be >= 1.
//
// component_transactions rules:
//   - Exactly one of from_kit / from_entity must be set (XOR).
//   - Exactly one of to_kit / to_entity must be set (XOR).
//     Exception: both from_kit + to_kit set (and from_entity + to_entity null) is valid
//     for a direct kit-to-kit transfer (auto-transfer in one txn).
//   - quantity must not exceed the component's current quantity.
//   - Source kit (if any) must be active.

// ---- components: before create ----
onRecordBeforeCreateRequest((e) => {
  const isBulk = e.record.getBool("is_bulk");
  const serial = e.record.getString("serial");
  const quantity = e.record.getInt("quantity");

  if (!isBulk && (!serial || serial.trim() === "")) {
    throw new BadRequestError("Serialized component must have a serial");
  }

  if (isBulk && quantity < 1) {
    throw new BadRequestError("Bulk component quantity must be >= 1");
  }
}, "components");

// ---- components: before update ----
onRecordBeforeUpdateRequest((e) => {
  const isBulk = e.record.getBool("is_bulk");
  const serial = e.record.getString("serial");
  const quantity = e.record.getInt("quantity");

  if (!isBulk && (!serial || serial.trim() === "")) {
    throw new BadRequestError("Serialized component must have a serial");
  }

  if (isBulk && quantity < 1) {
    throw new BadRequestError("Bulk component quantity must be >= 1");
  }
}, "components");

// ---- component_transactions: before create ----
onRecordBeforeCreateRequest((e) => {
  const fromKit    = e.record.getString("from_kit");
  const fromEntity = e.record.getString("from_entity");
  const toKit      = e.record.getString("to_kit");
  const toEntity   = e.record.getString("to_entity");

  const hasFromKit    = fromKit    !== "";
  const hasFromEntity = fromEntity !== "";
  const hasToKit      = toKit      !== "";
  const hasToEntity   = toEntity   !== "";

  // from side: exactly one set.
  // kit-to-kit transfer: from_kit set, from_entity null — valid (both from and to are kits).
  // But we still require exactly one from_ field total.
  if (hasFromKit === hasFromEntity) {
    throw new BadRequestError(
      "component_transactions: exactly one of from_kit or from_entity must be set"
    );
  }

  // to side: exactly one set.
  if (hasToKit === hasToEntity) {
    throw new BadRequestError(
      "component_transactions: exactly one of to_kit or to_entity must be set"
    );
  }

  // quantity vs component available
  const componentId = e.record.getString("component");
  const txnQty = e.record.getInt("quantity");
  if (txnQty < 1) {
    throw new BadRequestError("Transaction quantity must be >= 1");
  }

  const component = $app.dao().findRecordById("components", componentId);
  const availableQty = component.getInt("quantity");
  if (txnQty > availableQty) {
    throw new BadRequestError(
      "Cannot move more than available (requested " + txnQty + ", available " + availableQty + ")"
    );
  }

  // Source kit active check
  if (hasFromKit) {
    const kit = $app.dao().findRecordById("kits", fromKit);
    if (!kit.getBool("is_active")) {
      throw new BadRequestError("Cannot move from retired kit");
    }
  }
}, "component_transactions");
