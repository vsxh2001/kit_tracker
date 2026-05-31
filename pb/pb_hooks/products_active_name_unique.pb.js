/// <reference path="../pb_data/types.d.ts" />
// Enforce: at most one ACTIVE product per name.
//
// Ported from onRecordBefore*Request to onModelBefore* so that dao.save()
// calls from ai_mcp.pb.js are also covered.

onModelBeforeCreate((e) => {
  if (!e.model.getBool("is_active")) return;
  const name = e.model.getString("name");
  if (!name) return;
  const matches = $app.dao().findRecordsByFilter(
    "products",
    "name = {:name} && is_active = true",
    "",
    1,
    0,
    { name: name }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active product already uses this name. Deactivate it first or pick a different name."
    );
  }
}, "products");

onModelBeforeUpdate((e) => {
  if (!e.model.getBool("is_active")) return;
  const name = e.model.getString("name");
  if (!name) return;
  const matches = $app.dao().findRecordsByFilter(
    "products",
    "name = {:name} && is_active = true && id != {:id}",
    "",
    1,
    0,
    { name: name, id: e.model.id }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active product already uses this name. Deactivate it first or pick a different name."
    );
  }
}, "products");
