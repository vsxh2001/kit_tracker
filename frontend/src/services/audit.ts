import { pb } from "../lib/pocketbase";
import type { AuditLog } from "../types";

export async function listAuditLog(opts?: {
  collection?: string;
  limit?: number;
}): Promise<AuditLog[]> {
  const filter = opts?.collection
    ? pb.filter("collection_name = {:c}", { c: opts.collection })
    : "";
  return pb
    .collection("audit_log")
    .getList(1, opts?.limit ?? 50, {
      sort: "-created",
      expand: "actor",
      filter,
      requestKey: `audit-${opts?.collection ?? "all"}-${opts?.limit ?? 50}`,
    })
    .then((r) => r.items as unknown as AuditLog[]);
}
