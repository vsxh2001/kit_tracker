import Papa from "papaparse";
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
