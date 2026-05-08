import { pb } from "../lib/pocketbase";
import type { Kit, Transaction } from "../types";

export async function listKits(includeInactive = false) {
  const filter = includeInactive ? "" : "is_active = true";
  return pb.collection("kits").getFullList<Kit>({ sort: "serial", filter });
}

export async function getKit(id: string) {
  return pb.collection("kits").getOne<Kit>(id);
}

export async function createKit(data: { serial: string; notes?: string }) {
  return pb.collection("kits").create<Kit>({ ...data, is_active: true });
}

export async function updateKit(
  id: string,
  data: Partial<{ serial: string; notes: string; is_active: boolean }>
) {
  return pb.collection("kits").update<Kit>(id, data);
}

export async function getLatestTransaction(kitId: string) {
  const result = await pb.collection("transactions").getList<Transaction>(1, 1, {
    filter: `kit = "${kitId}"`,
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by",
    requestKey: `latest-tx-${kitId}`,
  });
  return result.items[0] ?? null;
}

export async function getKitHistory(kitId: string) {
  return pb.collection("transactions").getFullList<Transaction>({
    filter: `kit = "${kitId}"`,
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by",
    requestKey: `kit-history-${kitId}`,
  });
}
