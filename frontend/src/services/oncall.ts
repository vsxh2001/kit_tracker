import { pb } from "../lib/pocketbase";
import type { OnCallShift, PBUser } from "../types";

export async function listShifts({
  limit = 50,
  sort = "-start_at",
}: { limit?: number; sort?: string } = {}): Promise<OnCallShift[]> {
  return pb.collection("on_call_shifts").getFullList<OnCallShift>({
    sort,
    perPage: limit,
    expand: "user,created_by",
    requestKey: "oncall-list",
  });
}

export async function getCurrentOnCallUsers(): Promise<PBUser[]> {
  const now = new Date().toISOString();
  const shifts = await pb.collection("on_call_shifts").getFullList<OnCallShift>({
    filter: pb.filter("start_at <= {:now} && end_at >= {:now}", { now }),
    expand: "user",
    requestKey: "oncall-current",
  });
  const seen = new Set<string>();
  const users: PBUser[] = [];
  for (const s of shifts) {
    const u = s.expand?.user;
    if (u && !seen.has(u.id) && (u.role === "admin" || u.role === "technician")) {
      seen.add(u.id);
      users.push(u);
    }
  }
  return users;
}

export async function createShift(data: {
  userId: string;
  startAt: string;
  endAt: string;
  notes?: string;
}): Promise<OnCallShift> {
  return pb.collection("on_call_shifts").create<OnCallShift>({
    user: data.userId,
    start_at: data.startAt,
    end_at: data.endAt,
    notes: data.notes ?? "",
    created_by: pb.authStore.model?.id ?? "",
  }, { requestKey: `oncall-create-${Date.now()}` });
}

export async function updateShift(
  id: string,
  data: Partial<{ userId: string; startAt: string; endAt: string; notes: string }>
): Promise<OnCallShift> {
  const payload: Record<string, string> = {};
  if (data.userId !== undefined) payload.user = data.userId;
  if (data.startAt !== undefined) payload.start_at = data.startAt;
  if (data.endAt !== undefined) payload.end_at = data.endAt;
  if (data.notes !== undefined) payload.notes = data.notes;
  return pb.collection("on_call_shifts").update<OnCallShift>(id, payload, {
    requestKey: `oncall-update-${id}`,
  });
}

export async function deleteShift(id: string): Promise<void> {
  await pb.collection("on_call_shifts").delete(id, {
    requestKey: `oncall-delete-${id}`,
  });
}
