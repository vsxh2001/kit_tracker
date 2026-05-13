/// <reference path="../pb_data/types.d.ts" />
// Validates components and component_transactions before create/update.
//
// components rules:
//   - Serialized (is_bulk=false): serial must be non-empty.
//   - Bulk (is_bulk=true): quantity must be >= 1.
//   - Non-admin updates: only quantity field may change.
//
// component_transactions rules:
//   - Exactly one of to_kit / to_entity must be set (XOR).
//   - Exactly one of from_kit / from_entity must be set (XOR).
//     Exception: BOTH from_kit + from_entity may be empty ONLY when this is the
//     first transaction for the component (initial placement).
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

  // Non-admins (and non-technicians) may only change quantity
  const info = $apis.requestInfo(e.httpContext);
  const role = info.authRecord ? info.authRecord.getString("role") : "";
  if (role !== "admin" && role !== "technician") {
    const original = $app.dao().findRecordById("components", e.record.id);
    const protectedFields = ["serial", "type", "notes", "is_active", "is_bulk"];
    for (const f of protectedFields) {
      if (e.record.getString(f) !== original.getString(f)) {
        throw new BadRequestError("Non-admins cannot change field: " + f);
      }
    }
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

  // to side: exactly one set.
  if (hasToKit === hasToEntity) {
    throw new BadRequestError(
      "component_transactions: exactly one of to_kit or to_entity must be set"
    );
  }

  // from side: exactly one set — EXCEPT when both are empty for initial placement.
  if (hasFromKit === hasFromEntity) {
    if (!hasFromKit && !hasFromEntity) {
      // Both empty: only allowed if this is the FIRST transaction for this component
      const componentId = e.record.getString("component");
      const existing = $app.dao().findRecordsByFilter(
        "component_transactions",
        "component = {:cid}",
        "",
        1,
        0,
        { cid: componentId }
      );
      if (existing.length > 0) {
        throw new BadRequestError(
          "component_transactions: from_kit or from_entity required (component already has transactions)"
        );
      }
      // First transaction — initial placement is allowed with no from_*
    } else {
      // Both set: ambiguous
      throw new BadRequestError(
        "component_transactions: exactly one of from_kit or from_entity must be set"
      );
    }
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
