import { pb } from "../lib/pocketbase";
import type { KitMaintenanceSchedule, MaintenanceRecord } from "../types";

export async function listSchedulesForKit(kitId: string): Promise<KitMaintenanceSchedule[]> {
  return pb.collection("kit_maintenance_schedules").getFullList<KitMaintenanceSchedule>({
    filter: pb.filter("kit = {:kit} && is_active = true", { kit: kitId }),
    sort: "next_due_at",
    requestKey: `schedules-kit-${kitId}`,
  });
}

export async function getSchedule(id: string): Promise<KitMaintenanceSchedule> {
  return pb.collection("kit_maintenance_schedules").getOne<KitMaintenanceSchedule>(id, {
    requestKey: `schedule-${id}`,
  });
}

export async function createSchedule(
  data: Partial<KitMaintenanceSchedule>
): Promise<KitMaintenanceSchedule> {
  return pb.collection("kit_maintenance_schedules").create<KitMaintenanceSchedule>(data, {
    requestKey: `create-schedule-${Date.now()}`,
  });
}

export async function updateSchedule(
  id: string,
  data: Partial<KitMaintenanceSchedule>
): Promise<KitMaintenanceSchedule> {
  return pb.collection("kit_maintenance_schedules").update<KitMaintenanceSchedule>(id, data, {
    requestKey: `update-schedule-${id}-${Date.now()}`,
  });
}

export async function listRecordsForSchedule(scheduleId: string): Promise<MaintenanceRecord[]> {
  return pb.collection("maintenance_records").getFullList<MaintenanceRecord>({
    filter: pb.filter("schedule = {:schedule}", { schedule: scheduleId }),
    sort: "-performed_at",
    expand: "performed_by",
    requestKey: `records-schedule-${scheduleId}`,
  });
}

export async function createMaintenanceRecord(formData: FormData): Promise<MaintenanceRecord> {
  return pb.collection("maintenance_records").create<MaintenanceRecord>(formData, {
    requestKey: `create-maint-record-${Date.now()}`,
  });
}

export async function listAllActiveSchedules(opts?: { filter?: string }): Promise<KitMaintenanceSchedule[]> {
  const base = "is_active = true";
  const filter = opts?.filter ? `${base} && ${opts.filter}` : base;
  return pb.collection("kit_maintenance_schedules").getFullList<KitMaintenanceSchedule>({
    filter,
    sort: "next_due_at",
    expand: "kit",
    requestKey: `all-active-schedules-${opts?.filter ?? "all"}`,
  });
}

export async function bulkCreateSchedules(
  kitIds: string[],
  fields: Omit<KitMaintenanceSchedule, "id" | "kit" | "created" | "updated" | "expand">
): Promise<{ ok: string[]; failed: Array<{ kitId: string; error: string }> }> {
  const results = await Promise.allSettled(
    kitIds.map((kitId) =>
      pb.collection("kit_maintenance_schedules").create<KitMaintenanceSchedule>(
        { ...fields, kit: kitId },
        { requestKey: `bulk-schedule-create-${kitId}` }
      )
    )
  );
  const ok: string[] = [];
  const failed: Array<{ kitId: string; error: string }> = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      ok.push(kitIds[i]);
    } else {
      failed.push({ kitId: kitIds[i], error: result.reason?.message ?? "Unknown error" });
    }
  });
  return { ok, failed };
}
