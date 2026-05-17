import { pb } from "../lib/pocketbase";
import type { AuditVia, Transaction } from "../types";

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

export async function listTransactionsForKit(kitId: string): Promise<Transaction[]> {
  return pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("kit = {:kit}", { kit: kitId }),
    sort: "timestamp,created",
    expand: "from_entity,to_entity,created_by",
    requestKey: `tx-for-kit-${kitId}`,
  });
}

export async function getTransactionVia(
  transactionIds: string[]
): Promise<Record<string, AuditVia>> {
  if (transactionIds.length === 0) return {};

  const idFilter = transactionIds.map((id) => `record_id="${id}"`).join(" || ");
  const filter = `collection_name="transactions" && (${idFilter})`;

  const rows = await pb.collection("audit_log").getFullList({
    filter,
    sort: "-created",
    requestKey: `audit-via-${transactionIds.length}-${transactionIds[0]?.slice(0, 4)}`,
  });

  const result: Record<string, AuditVia> = {};
  for (const row of rows) {
    const recordId = row.record_id as string;
    if (result[recordId]) continue;
    try {
      const changes = JSON.parse(row.changes as string);
      if (changes?.via) {
        result[recordId] = changes.via as AuditVia;
      }
    } catch {
      // malformed JSON — skip
    }
  }
  return result;
}
