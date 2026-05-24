import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Exercises maintenance_update_next_due.pb.js, which fires on
// maintenance_records create:
//   before: next_due_snapshot = performed_at(date) + interval_days
//   after:  parent schedule's last_done_at / next_due_at updated to match
//
// suToken bypasses the maintenance_records createRule so only the hook's
// computation is under test.

describe("maintenance_update_next_due hook", () => {
  let pb, baseUrl, suToken;
  let adminUserId, kitId;

  // Stale placeholder so we can prove the after-hook overwrites it.
  const STALE_NEXT_DUE = "2026-01-01 00:00:00.000Z";

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminUserId = (await adminRes.json()).items[0].id;

    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "MAINT-KIT-1", is_active: true }),
    });
    kitId = (await kitRes.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  async function createSchedule(intervalDays) {
    const res = await fetch(`${baseUrl}/api/collections/kit_maintenance_schedules/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        type: "calibration",
        interval_days: intervalDays,
        next_due_at: STALE_NEXT_DUE,
        is_active: true,
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }

  async function createRecord(scheduleId, performedAt) {
    return fetch(`${baseUrl}/api/collections/maintenance_records/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule: scheduleId,
        performed_at: performedAt,
        performed_by: adminUserId,
      }),
    });
  }

  it("before-create: sets next_due_snapshot = performed_at + interval_days", async () => {
    const scheduleId = await createSchedule(30);
    const res = await createRecord(scheduleId, "2026-06-01 10:00:00.000Z");
    expect(res.status).toBe(200);
    const record = await res.json();
    // 2026-06-01 + 30 days = 2026-07-01 (date-only arithmetic).
    expect(record.next_due_snapshot).toMatch(/^2026-07-01/);
  });

  it("after-create: updates parent schedule last_done_at + next_due_at", async () => {
    const scheduleId = await createSchedule(7);
    const res = await createRecord(scheduleId, "2026-06-10 08:00:00.000Z");
    expect(res.status).toBe(200);

    const schedRes = await fetch(
      `${baseUrl}/api/collections/kit_maintenance_schedules/records/${scheduleId}`,
      { headers: { Authorization: suToken } }
    );
    const schedule = await schedRes.json();
    expect(schedule.last_done_at).toMatch(/^2026-06-10/);
    // 2026-06-10 + 7 days = 2026-06-17; stale placeholder overwritten.
    expect(schedule.next_due_at).toMatch(/^2026-06-17/);
    expect(schedule.next_due_at).not.toMatch(/^2026-01-01/);
  });
});
