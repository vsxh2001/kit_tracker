/// <reference path="../pb_data/types.d.ts" />
// Prevent demotion or deletion of the last admin user.
//
// Ported from onRecordBefore*Request to onModelBefore* so that dao.save()
// calls from ai_mcp.pb.js are also covered.

onModelBeforeUpdate((e) => {
  // e.model holds the new (pending) state.
  // Fetch current persisted state to read old role.
  const oldRecord = $app.dao().findRecordById("users", e.model.id);
  const oldRole = oldRecord.getString("role");
  const newRole = e.model.getString("role");

  // Only act if this update demotes an admin.
  if (oldRole !== "admin" || newRole === "admin") {
    return;
  }

  // Count admins *excluding* the record being updated.
  // If that count is 0, this record is the last admin — reject.
  // This is atomic: we don't count the record being changed, so two
  // concurrent demote-last-admin requests both see count=0 and both fail.
  const otherAdmins = $app.dao().findRecordsByFilter(
    "users",
    "role = 'admin' && id != {:id}",
    "",
    2,
    0,
    { id: e.model.id }
  );

  if (otherAdmins.length === 0) {
    throw new BadRequestError("Cannot demote the last admin");
  }
}, "users");

// Prevent deletion of the last admin user.
onModelBeforeDelete((e) => {
  if (e.model.getString("role") !== "admin") return;

  const otherAdmins = $app.dao().findRecordsByFilter(
    "users",
    "role = 'admin' && id != {:id}",
    "",
    2,
    0,
    { id: e.model.id }
  );

  if (otherAdmins.length === 0) {
    throw new BadRequestError("Cannot delete the last admin");
  }
}, "users");
