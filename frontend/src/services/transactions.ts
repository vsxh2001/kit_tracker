import { pb } from "../lib/pocketbase";
import type { Transaction } from "../types";

export async function createTransaction(data: {
  kitId: string;
  fromEntityId?: string;
  toEntityId: string;
  notes?: string;
  requestId?: string;
  timestamp?: string;
}) {
  return pb.collection("transactions").create<Transaction>({
    kit: data.kitId,
    from_entity: data.fromEntityId ?? null,
    to_entity: data.toEntityId,
    timestamp: data.timestamp ?? new Date().toISOString(),
    notes: data.notes,
    request: data.requestId ?? null,
    created_by: pb.authStore.model?.id,
  });
}

export async function listRecentTransactions(limit = 10) {
  return pb.collection("transactions").getList<Transaction>(1, limit, {
    sort: "-timestamp,-created",
    expand: "kit,from_entity,to_entity,created_by",
  });
}
