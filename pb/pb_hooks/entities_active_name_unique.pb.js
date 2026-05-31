/// <reference path="../pb_data/types.d.ts" />
// Enforce: at most one ACTIVE entity per name. Mirrors the kits pattern.
// Soft-deleted (is_active=false) entities may share a name with each other
// and with one active entity.
//
// Ported from onRecordBefore*Request to onModelBefore* so that dao.save()
// calls from ai_mcp.pb.js are also covered.

onModelBeforeCreate((e) => {
  if (!e.model.getBool("is_active")) return;
  const name = e.model.getString("name");
  if (!name) return;
  const matches = $app.dao().findRecordsByFilter(
    "entities",
    "name = {:name} && is_active = true",
    "",
    1,
    0,
    { name: name }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active entity already uses this name. Deactivate it first or pick a different name."
    );
  }
}, "entities");

onModelBeforeUpdate((e) => {
  if (!e.model.getBool("is_active")) return;
  const name = e.model.getString("name");
  if (!name) return;
  const matches = $app.dao().findRecordsByFilter(
    "entities",
    "name = {:name} && is_active = true && id != {:id}",
    "",
    1,
    0,
    { name: name, id: e.model.id }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active entity already uses this name. Deactivate it first or pick a different name."
    );
  }
}, "entities");
