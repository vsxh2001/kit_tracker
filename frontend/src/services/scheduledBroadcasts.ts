import { pb } from "../lib/pocketbase";
import type { ScheduledBroadcast } from "../types";

export async function listScheduledBroadcasts(): Promise<ScheduledBroadcast[]> {
  return pb.collection("scheduled_broadcasts").getFullList<ScheduledBroadcast>({
    sort: "-created",
    requestKey: "scheduled-broadcasts-list",
  });
}

export async function getScheduledBroadcast(id: string): Promise<ScheduledBroadcast> {
  return pb.collection("scheduled_broadcasts").getOne<ScheduledBroadcast>(id, {
    requestKey: `scheduled-broadcast-${id}`,
  });
}

export async function createScheduledBroadcast(data: {
  name: string;
  cron_expression: string;
  enabled: boolean;
  recipient_filter: string;
  message: string;
  created_by?: string;
}): Promise<ScheduledBroadcast> {
  return pb.collection("scheduled_broadcasts").create<ScheduledBroadcast>(data, {
    requestKey: `scheduled-broadcast-create-${Date.now()}`,
  });
}

export async function updateScheduledBroadcast(
  id: string,
  data: Partial<{
    name: string;
    cron_expression: string;
    enabled: boolean;
    recipient_filter: string;
    message: string;
  }>
): Promise<ScheduledBroadcast> {
  return pb.collection("scheduled_broadcasts").update<ScheduledBroadcast>(id, data, {
    requestKey: `scheduled-broadcast-update-${id}`,
  });
}

export async function deleteScheduledBroadcast(id: string): Promise<boolean> {
  await pb.collection("scheduled_broadcasts").delete(id, {
    requestKey: `scheduled-broadcast-delete-${id}`,
  });
  return true;
}
