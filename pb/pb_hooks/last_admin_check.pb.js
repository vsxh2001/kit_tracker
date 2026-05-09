/// <reference path="../pb_data/types.d.ts" />
// Prevent demotion of the last admin user.
// Fires before any user record update; if the update would remove the last admin, reject with 400.

onRecordBeforeUpdateRequest((e) => {
  // Only care about the users collection
  if (!e.collection || e.collection.name !== "users") {
    return;
  }

  // e.record holds the new (pending) state.
  // Fetch current persisted state to read old role.
  const oldRecord = $app.dao().findRecordById("users", e.record.id);
  const oldRole = oldRecord.getString("role");
  const newRole = e.record.getString("role");

  // Only act if this update demotes an admin.
  if (oldRole !== "admin" || newRole === "admin") {
    return;
  }

  // Count current admins.
  const admins = $app.dao().findRecordsByFilter(
    "users",
    "role = 'admin'",
    "",
    0,
    0
  );

  if (admins.length <= 1) {
    throw new BadRequestError("Cannot demote the last admin");
  }
}, "users");
