/// <reference path="../pb_data/types.d.ts" />
// Enforce: at most one ACTIVE product per name.

onRecordBeforeCreateRequest((e) => {
  if (!e.collection || e.collection.name !== "products") return;
  if (!e.record.getBool("is_active")) return;
  const name = e.record.getString("name");
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

onRecordBeforeUpdateRequest((e) => {
  if (!e.collection || e.collection.name !== "products") return;
  if (!e.record.getBool("is_active")) return;
  const name = e.record.getString("name");
  if (!name) return;
  const matches = $app.dao().findRecordsByFilter(
    "products",
    "name = {:name} && is_active = true && id != {:id}",
    "",
    1,
    0,
    { name: name, id: e.record.id }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active product already uses this name. Deactivate it first or pick a different name."
    );
  }
}, "products");
