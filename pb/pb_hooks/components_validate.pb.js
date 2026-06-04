/// <reference path="../pb_data/types.d.ts" />
// Validates components and component_transactions before create/update.
//
// components rules:
//   - Serialized (is_bulk=false): serial must be non-empty.
//   - Bulk (is_bulk=true): quantity must be >= 1.
//   - Non-admin field guard (only quantity may change for non-admins) is
//     enforced at REST layer via onRecordBeforeUpdateRequest (needs HTTP
//     context for caller role). The model-event hook covers structural
//     invariants reachable via dao.save() (ai_mcp path).
//
// component_transactions rules:
//   - Exactly one of to_kit / to_entity must be set (XOR).
//   - Exactly one of from_kit / from_entity must be set (XOR).
//     Exception: BOTH from_kit + from_entity may be empty ONLY when this is the
//     first transaction for the component (initial placement).
//   - quantity must not exceed the component's current quantity.
//   - Source kit (if any) must be active.
//
// Ported from onRecordBefore*Request to onModelBefore* so that dao.save()
// calls from ai_mcp.pb.js are also covered.

// ---- components: before create ----
onModelBeforeCreate((e) => {
  const isBulk = e.model.getBool("is_bulk");
  const serial = e.model.getString("serial");
  const quantity = e.model.getInt("quantity");
  const product = e.model.getString("product");

  if (!product || product.trim() === "") {
    throw new BadRequestError("Component must have a product");
  }

  if (!isBulk && (!serial || serial.trim() === "")) {
    throw new BadRequestError("Serialized component must have a serial");
  }

  if (isBulk && quantity < 1) {
    throw new BadRequestError("Bulk component quantity must be >= 1");
  }
}, "components");

// ---- components: before update ----
onModelBeforeUpdate((e) => {
  const isBulk = e.model.getBool("is_bulk");
  const serial = e.model.getString("serial");
  const quantity = e.model.getInt("quantity");
  const product = e.model.getString("product");

  if (!product || product.trim() === "") {
    throw new BadRequestError("Component must have a product");
  }

  if (!isBulk && (!serial || serial.trim() === "")) {
    throw new BadRequestError("Serialized component must have a serial");
  }

  if (isBulk && quantity < 1) {
    throw new BadRequestError("Bulk component quantity must be >= 1");
  }

  // NOTE: Non-admin field guard (protecting serial, notes, is_active, is_bulk)
  // is NOT enforced here — no HTTP context at model layer. That check remains
  // on the REST onRecordBeforeUpdateRequest path (see below). The ai_mcp
  // handler enforces caller role before calling dao.save().
}, "components");

// ---- components: non-admin field guard (REST-only, needs HTTP context) ----
onRecordBeforeUpdateRequest((e) => {
  // Only care about the components collection
  if (!e.collection || e.collection.name !== "components") return;

  const info = $apis.requestInfo(e.httpContext);
  const role = info.authRecord ? info.authRecord.getString("role") : "";
  if (role !== "admin" && role !== "technician") {
    const original = $app.dao().findRecordById("components", e.record.id);
    const protectedFields = ["serial", "notes", "is_active", "is_bulk", "bin_code"];
    for (const f of protectedFields) {
      if (e.record.getString(f) !== original.getString(f)) {
        throw new BadRequestError("Non-admins cannot change field: " + f);
      }
    }
  }
}, "components");

// ---- component_transactions: before create ----
onModelBeforeCreate((e) => {
  const fromKit    = e.model.getString("from_kit");
  const fromEntity = e.model.getString("from_entity");
  const toKit      = e.model.getString("to_kit");
  const toEntity   = e.model.getString("to_entity");

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
      const componentId = e.model.getString("component");
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

  // quantity vs component available — only meaningful for bulk components.
  // Serialized components (is_bulk=false) have quantity null/0 by design;
  // each serialized unit is one tx, no available-quantity gate.
  const componentId = e.model.getString("component");
  const txnQty = e.model.getInt("quantity");
  if (txnQty < 1) {
    throw new BadRequestError("Transaction quantity must be >= 1");
  }

  const component = $app.dao().findRecordById("components", componentId);
  // Serialized components store quantity=NULL (getInt returns 0). Skip overflow
  // check for them — each serialized unit is its own record, so qty=1 is always valid.
  const isBulk = component.getBool("is_bulk");
  if (isBulk) {
    const availableQty = component.getInt("quantity");
    if (txnQty > availableQty) {
      throw new BadRequestError(
        "Cannot move more than available (requested " + txnQty + ", available " + availableQty + ")"
      );
    }
  }

  // Source kit active check
  if (hasFromKit) {
    const kit = $app.dao().findRecordById("kits", fromKit);
    if (!kit.getBool("is_active")) {
      throw new BadRequestError("Cannot move from retired kit");
    }
  }
}, "component_transactions");
