/// <reference path="../pb_data/types.d.ts" />
// on_call_shifts validation hook.
//
// Fires before create + update to enforce:
//   1. end_at > start_at  (lexicographic compare; PB stores dates as "YYYY-MM-DD HH:MM:SS.sssZ")
//   2. assigned user has role = "admin" or "technician"
//
// NOTE: $app is a Goja global and is NOT accessible inside named helper functions
// in PB v0.22 — the runtime isolates globals to the top-level script scope.
// Both checks are therefore inlined directly in each event callback.
//
// ============================================================
// Phase 3 reference — findOnCallNow()
// Copy-paste this into any notification hook that needs on-call users.
// Goja runtime isolation means each *.pb.js gets its own runtime;
// there is no require() mechanism, so inlining is the only option.
// ============================================================
//
// function findOnCallNow() {
//   const nowISO = new Date().toISOString();
//   const shifts = $app.dao().findRecordsByFilter(
//     "on_call_shifts",
//     "start_at <= {:now} && end_at >= {:now}",
//     "",
//     100,
//     0,
//     { now: nowISO }
//   );
//   const users = [];
//   for (const shift of shifts) {
//     const user = $app.dao().findRecordById("users", shift.getString("user"));
//     const role = user.getString("role");
//     if (role === "admin" || role === "technician") {
//       users.push(user);
//     }
//   }
//   return users;
// }
// ============================================================

onRecordBeforeCreateRequest((e) => {
  const startStr = e.record.getString("start_at");
  const endStr = e.record.getString("end_at");
  if (endStr <= startStr) {
    throw new BadRequestError("end_at must be after start_at");
  }
  const userId = e.record.getString("user");
  const user = $app.dao().findRecordById("users", userId);
  const role = user.getString("role");
  if (role !== "admin" && role !== "technician") {
    throw new BadRequestError("on-call user must have admin or technician role (got: '" + role + "')");
  }
}, "on_call_shifts");

onRecordBeforeUpdateRequest((e) => {
  const startStr = e.record.getString("start_at");
  const endStr = e.record.getString("end_at");
  if (endStr <= startStr) {
    throw new BadRequestError("end_at must be after start_at");
  }
  const userId = e.record.getString("user");
  const user = $app.dao().findRecordById("users", userId);
  const role = user.getString("role");
  if (role !== "admin" && role !== "technician") {
    throw new BadRequestError("on-call user must have admin or technician role (got: '" + role + "')");
  }
}, "on_call_shifts");
