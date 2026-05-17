import { pb } from "../lib/pocketbase";
import type { AuditLog } from "../types";

function csvCell(v: string | null | undefined): string {
  let s = String(v ?? "");
  // CSV injection guard — neutralize formula-leading characters per OWASP recommendation.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportAuditLogCsv(rows: AuditLog[]): void {
  const header = ["Created", "Collection", "Record", "Actor", "Action", "Source", "Changes"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    let via = "—";
    try {
      via = JSON.parse(r.changes)?.via ?? "—";
    } catch {
      // ignore
    }
    lines.push(
      [r.created, r.collection_name, r.record_id, r.actor, r.action, via, r.changes]
        .map(csvCell)
        .join(",")
    );
  }
  // RFC4180 line ending — Excel on Windows expects CRLF.
  const csv = lines.join("\r\n");
  // UTF-8 BOM so Excel recognizes encoding for non-ASCII.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  a.href = url;
  a.download = `audit-log-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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
