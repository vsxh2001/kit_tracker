import Papa from "papaparse";
import { pb } from "../lib/pocketbase";
import type { Kit, KitRequest, Transaction } from "../types";
import { getTransactionVia } from "./transactions";

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(
    raw.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
  ));
}

export function serializeTags(tags: string[]): string {
  return Array.from(new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))).join(",");
}

export interface UpcomingDelivery {
  kitId: string;
  deliveryDate: string;
  targetEntityName: string;
  requestId: string;
}

export async function listUpcomingDeliveries(): Promise<Map<string, UpcomingDelivery>> {
  const requests = await pb.collection("requests").getFullList<KitRequest>({
    filter: pb.filter('status = "approved" && delivery_date >= {:now}', { now: new Date().toISOString().split("T")[0] }),
    sort: "delivery_date",
    expand: "target_entity",
    requestKey: "upcoming-deliveries",
  });
  const map = new Map<string, UpcomingDelivery>();
  for (const req of requests) {
    if (!req.designated_kit) continue;
    if (!map.has(req.designated_kit)) {
      map.set(req.designated_kit, {
        kitId: req.designated_kit,
        deliveryDate: req.delivery_date,
        targetEntityName: req.expand?.target_entity?.name ?? "",
        requestId: req.id,
      });
    }
  }
  return map;
}

export async function listKits(includeInactive = false) {
  const filter = includeInactive ? "" : "is_active = true";
  return pb.collection("kits").getFullList<Kit>({ sort: "serial", filter });
}

export async function getKitBySerial(serial: string): Promise<Kit> {
  return pb.collection("kits").getFirstListItem<Kit>(
    pb.filter("serial = {:serial}", { serial }),
    { requestKey: `get-kit-by-serial-${serial}` }
  );
}

export async function listActiveKitSerials(): Promise<string[]> {
  const kits = await pb.collection("kits").getFullList<Kit>({
    filter: "is_active = true",
    sort: "serial",
    requestKey: "ac-kit-serials",
  });
  return kits.map((k) => k.serial);
}

export async function getKit(id: string) {
  return pb.collection("kits").getOne<Kit>(id);
}

export async function createKit(data: { serial: string; notes?: string; tags?: string }) {
  return pb.collection("kits").create<Kit>({ ...data, is_active: true });
}

export async function updateKit(
  id: string,
  data: Partial<{ serial: string; notes: string; tags: string; is_active: boolean }>
) {
  return pb.collection("kits").update<Kit>(id, data);
}

export async function getLatestTransaction(kitId: string) {
  const result = await pb.collection("transactions").getList<Transaction>(1, 1, {
    filter: pb.filter("kit = {:kit}", { kit: kitId }),
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by",
    requestKey: `latest-tx-${kitId}`,
  });
  return result.items[0] ?? null;
}

export async function getKitHistory(kitId: string) {
  return pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("kit = {:kit}", { kit: kitId }),
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by",
    requestKey: `kit-history-${kitId}`,
  });
}

function csvEscape(value: string): string {
  const s = value ?? "";
  // RFC4180: quote if contains comma, double-quote, or newline; double internal quotes
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvRow(cells: string[]): string {
  return cells.map(csvEscape).join(",");
}

export async function exportKitTimelineCsv(kitId: string, kitSerial: string): Promise<void> {
  // Bulk-fetch all transactions with expanded relations
  const transactions = await pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("kit = {:kit}", { kit: kitId }),
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by,request",
    requestKey: `export-kit-timeline-${kitId}`,
  });

  // Bulk-fetch via tags from audit_log in one query
  const txIds = transactions.map((tx) => tx.id);
  const viaMap = await getTransactionVia(txIds);

  const header = buildCsvRow(["Timestamp", "From", "To", "By", "Via", "Notes", "Request"]);
  const rows = transactions.map((tx) => {
    const from = tx.expand?.from_entity?.name ?? "";
    const to = tx.expand?.to_entity?.name ?? "";
    const by =
      tx.expand?.created_by?.name ??
      tx.expand?.created_by?.email ??
      "";
    const via = viaMap[tx.id] ?? "";
    const notes = tx.notes ?? "";
    const request = tx.expand?.request?.id ?? tx.request ?? "";
    return buildCsvRow([tx.timestamp, from, to, by, via, notes, request]);
  });

  const csv = [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kitSerial}-timeline.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportKitsCsv(): Promise<string> {
  const kits = await pb.collection("kits").getFullList<Kit>({
    sort: "serial",
    requestKey: "export-kits-all",
  });

  const rows = await Promise.all(
    kits.map(async (kit) => {
      const result = await pb
        .collection("transactions")
        .getList<Transaction>(1, 1, {
          filter: pb.filter("kit = {:kit}", { kit: kit.id }),
          sort: "-timestamp,-created",
          expand: "to_entity",
          requestKey: `export-kits-tx-${kit.id}`,
        });
      const latest = result.items[0] ?? null;
      return {
        serial: kit.serial,
        notes: kit.notes ?? "",
        is_active: kit.is_active,
        created: kit.created,
        current_holder: latest?.expand?.to_entity?.name ?? "",
      };
    })
  );

  return Papa.unparse(rows, { header: true });
}

export interface ImportResult {
  imported: number;
  skipped: { row: number; serial: string; reason: "duplicate" }[];
  errors: { row: number; reason: string }[];
}

function parseBool(s: string | undefined | null): boolean {
  if (!s || s.trim() === "") return true;
  const v = s.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

export async function uploadKitAttachment(kitId: string, file: File): Promise<Kit> {
  const formData = new FormData();
  formData.append("attachments", file);
  return pb.collection("kits").update<Kit>(kitId, formData, {
    requestKey: `upload-${kitId}-${file.name}-${Date.now()}`,
  });
}

export async function softDeleteKit(id: string): Promise<Kit> {
  return pb.collection("kits").update<Kit>(id, { is_active: false }, { requestKey: `soft-delete-kit-${id}` });
}

export async function deleteKitAttachment(kitId: string, filename: string): Promise<Kit> {
  return pb.collection("kits").update<Kit>(kitId, {
    "attachments-": [filename],
  }, { requestKey: `delete-attach-${kitId}-${filename}` });
}

export async function getAttachmentToken(): Promise<string> {
  return pb.files.getToken();
}

export function attachmentUrl(kit: Kit, filename: string, token?: string): string {
  return pb.files.getUrl(kit, filename, token ? { token } : {});
}

export async function importKitsCsv(file: File): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: [], errors: [] };

  const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>(
    (resolve) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
      });
    }
  );

  for (let i = 0; i < parsed.data.length; i++) {
    const rowNum = i + 2; // 1-based + header row
    const row = parsed.data[i];
    const serial = row.serial?.trim() ?? "";

    if (!serial) {
      result.errors.push({ row: rowNum, reason: "serial is required" });
      continue;
    }

    const existing: Kit | null = await pb
      .collection("kits")
      .getFirstListItem<Kit>(
        pb.filter("serial = {:serial}", { serial }),
        { requestKey: `import-check-${i}-${serial}` }
      )
      .catch(() => null);

    if (existing) {
      result.skipped.push({ row: rowNum, serial, reason: "duplicate" });
      continue;
    }

    try {
      await pb.collection("kits").create<Kit>(
        {
          serial,
          notes: row.notes ?? "",
          is_active: parseBool(row.is_active),
        },
        { requestKey: `import-create-${i}-${serial}` }
      );
      result.imported++;
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "unknown error";
      result.errors.push({ row: rowNum, reason: msg });
    }
  }

  return result;
}
