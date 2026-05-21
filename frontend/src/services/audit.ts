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
  term?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AuditLog[]; totalItems: number }> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;

  const parts: string[] = [];
  if (opts?.collection) {
    parts.push(pb.filter("collection_name = {:c}", { c: opts.collection }));
  }
  if (opts?.term) {
    parts.push(
      pb.filter("(actor.email ~ {:term} || record_id ~ {:term})", {
        term: opts.term,
      })
    );
  }
  const filter = parts.join(" && ");

  const result = await pb
    .collection("audit_log")
    .getList(page, limit, {
      sort: "-created",
      expand: "actor",
      ...(filter ? { filter } : {}),
      requestKey: `audit-list-${opts?.collection ?? "all"}-${opts?.term ?? ""}-p${page}`,
    });

  return { items: result.items as unknown as AuditLog[], totalItems: result.totalItems };
}
