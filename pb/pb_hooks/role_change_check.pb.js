/// <reference path="../pb_data/types.d.ts" />
// Block non-admin users from changing any user's role field (prevents self-promotion).
// Fires before any user record update.

onRecordBeforeUpdateRequest((e) => {
  if (!e.collection || e.collection.name !== "users") {
    return;
  }

  const oldRecord = $app.dao().findRecordById("users", e.record.id);
  const oldRole = oldRecord.getString("role");
  const newRole = e.record.getString("role");

  // No role change — nothing to enforce.
  if (oldRole === newRole) {
    return;
  }

  // Determine the requester's role via RequestInfo.
  const info = $apis.requestInfo(e.httpContext);

  // Superadmins (PB admin panel users) are always allowed.
  if (info.admin) {
    return;
  }

  const requesterRole = info.authRecord ? info.authRecord.getString("role") : "";

  if (requesterRole !== "admin") {
    throw new BadRequestError("Only admins can change user roles");
  }
}, "users");
