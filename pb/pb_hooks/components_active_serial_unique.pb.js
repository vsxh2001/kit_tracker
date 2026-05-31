/// <reference path="../pb_data/types.d.ts" />
// Enforce: at most one ACTIVE serialized component per serial.
// Bulk components (is_bulk=true) and components with empty serial are
// exempt — they can share. Only serialized components with a non-empty
// serial conflict.
//
// Ported from onRecordBefore*Request to onModelBefore* so that dao.save()
// calls from ai_mcp.pb.js are also covered.

onModelBeforeCreate((e) => {
  if (!e.model.getBool("is_active")) return;
  if (e.model.getBool("is_bulk")) return;
  const serial = e.model.getString("serial");
  if (!serial || serial.trim() === "") return;
  const matches = $app.dao().findRecordsByFilter(
    "components",
    "serial = {:serial} && is_active = true && is_bulk = false",
    "",
    1,
    0,
    { serial: serial }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active component already uses this serial. Deactivate it first or pick a different serial."
    );
  }
}, "components");

onModelBeforeUpdate((e) => {
  if (!e.model.getBool("is_active")) return;
  if (e.model.getBool("is_bulk")) return;
  const serial = e.model.getString("serial");
  if (!serial || serial.trim() === "") return;
  const matches = $app.dao().findRecordsByFilter(
    "components",
    "serial = {:serial} && is_active = true && is_bulk = false && id != {:id}",
    "",
    1,
    0,
    { serial: serial, id: e.model.id }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active component already uses this serial. Deactivate it first or pick a different serial."
    );
  }
}, "components");
