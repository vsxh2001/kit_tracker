import Papa from "papaparse";
import { pb } from "../lib/pocketbase";
import type { Entity, EntityCategory, Transaction } from "../types";

export async function listEntities(includeInactive = false) {
  const filter = includeInactive ? "" : "is_active = true";
  return pb.collection("entities").getFullList<Entity>({ sort: "name", filter });
}

export async function getEntity(id: string) {
  return pb.collection("entities").getOne<Entity>(id);
}

export async function createEntity(data: {
  name: string;
  description?: string;
  category: EntityCategory;
}) {
  return pb.collection("entities").create<Entity>({
    ...data,
    is_active: true,
  });
}

export async function updateEntity(
  id: string,
  data: Partial<{ name: string; description: string; category: EntityCategory; is_active: boolean }>
) {
  return pb.collection("entities").update<Entity>(id, data);
}

export async function getEntityTransactions(entityId: string) {
  return pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("from_entity = {:id} || to_entity = {:id}", { id: entityId }),
    sort: "-timestamp,-created",
    expand: "kit,from_entity,to_entity,created_by",
  });
}

export async function exportEntitiesCsv(): Promise<string> {
  const entities = await pb.collection("entities").getFullList<Entity>({
    sort: "name",
    requestKey: "export-entities-all",
  });

  const rows = entities.map((entity) => ({
    name: entity.name,
    description: entity.description ?? "",
    category: entity.category ?? "field",
    is_active: entity.is_active,
    created: entity.created,
  }));

  return Papa.unparse(rows, { header: true });
}

export interface ImportEntitiesResult {
  imported: number;
  skipped: { row: number; name: string; reason: "duplicate" }[];
  errors: { row: number; reason: string }[];
}

function parseBool(s: string | undefined | null): boolean {
  if (!s || s.trim() === "") return true;
  const v = s.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

export async function importEntitiesCsv(file: File): Promise<ImportEntitiesResult> {
  const result: ImportEntitiesResult = { imported: 0, skipped: [], errors: [] };

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
    const name = row.name?.trim() ?? "";

    if (!name) {
      result.errors.push({ row: rowNum, reason: "name is required" });
      continue;
    }

    const existing: Entity | null = await pb
      .collection("entities")
      .getFirstListItem<Entity>(
        pb.filter("name = {:n}", { n: name }),
        { requestKey: `import-entity-check-${i}-${name}` }
      )
      .catch(() => null);

    if (existing) {
      result.skipped.push({ row: rowNum, name, reason: "duplicate" });
      continue;
    }

    try {
      const rawCat = (row.category ?? row.type ?? "").trim().toLowerCase();
      const category: EntityCategory = rawCat === "storage" ? "storage" : "field";
      await pb.collection("entities").create<Entity>(
        {
          name,
          description: row.description ?? "",
          category,
          is_active: parseBool(row.is_active),
        },
        { requestKey: `import-entity-create-${i}-${name}` }
      );
      result.imported++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      result.errors.push({ row: rowNum, reason: msg });
    }
  }

  return result;
}
