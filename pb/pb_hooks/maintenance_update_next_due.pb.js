/// <reference path="../pb_data/types.d.ts" />
// On maintenance_records create:
//   Before: compute next_due_snapshot = performed_at + interval_days
//   After:  update parent schedule — last_done_at = performed_at, next_due_at = next_due_snapshot
//
// Wrapped in try/catch — failure logs but never blocks the record create.

onRecordBeforeCreateRequest(function(e) {
  const r = e.record;
  if (r.collection().name !== "maintenance_records") return;

  try {
    const scheduleId = r.getString("schedule");
    if (!scheduleId) throw new Error("schedule field is empty");

    const schedule = $app.dao().findRecordById("kit_maintenance_schedules", scheduleId);
    if (!schedule) throw new Error("schedule not found: " + scheduleId);

    const performedAtStr = r.getString("performed_at");
    if (!performedAtStr) throw new Error("performed_at is required");

    const intervalDays = schedule.getInt("interval_days");
    if (intervalDays <= 0) throw new Error("interval_days must be > 0, got: " + intervalDays);

    // Use date-only portion to avoid timezone drift in arithmetic.
    const dateOnly = performedAtStr.substring(0, 10); // "YYYY-MM-DD"
    const performedMs = new Date(dateOnly).getTime();
    const nextDueMs = performedMs + intervalDays * 86400000;
    const nextDueStr = new Date(nextDueMs).toISOString().slice(0, 10); // "YYYY-MM-DD"

    r.set("next_due_snapshot", nextDueStr);
    console.log("[maintenance_update_next_due] before: set next_due_snapshot=" + nextDueStr + " for schedule=" + scheduleId);
  } catch (err) {
    console.log("[maintenance_update_next_due] before: failed —", err);
  }
}, "maintenance_records");

onRecordAfterCreateRequest(function(e) {
  const r = e.record;
  if (r.collection().name !== "maintenance_records") return;

  try {
    const scheduleId = r.getString("schedule");
    if (!scheduleId) return;

    const schedule = $app.dao().findRecordById("kit_maintenance_schedules", scheduleId);
    if (!schedule) {
      console.log("[maintenance_update_next_due] after: schedule not found:", scheduleId);
      return;
    }

    const performedAt   = r.getString("performed_at");
    const nextDueSnapshot = r.getString("next_due_snapshot");

    if (!performedAt || !nextDueSnapshot) {
      console.log("[maintenance_update_next_due] after: missing performed_at or next_due_snapshot — skipping schedule update");
      return;
    }

    schedule.set("last_done_at", performedAt);
    schedule.set("next_due_at", nextDueSnapshot);
    $app.dao().saveRecord(schedule);
    console.log("[maintenance_update_next_due] after: updated schedule=" + scheduleId + " last_done_at=" + performedAt + " next_due_at=" + nextDueSnapshot);
  } catch (err) {
    console.log("[maintenance_update_next_due] after: failed —", err);
  }
}, "maintenance_records");
