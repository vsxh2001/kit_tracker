import { pb } from "../lib/pocketbase";
import type { Entity, Transaction } from "../types";

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
}) {
  return pb.collection("entities").create<Entity>({ ...data, type: "storage", is_active: true });
}

export async function updateEntity(
  id: string,
  data: Partial<{ name: string; description: string; is_active: boolean }>
) {
  return pb.collection("entities").update<Entity>(id, data);
}

export async function deleteEntity(id: string): Promise<void> {
  await pb.collection("entities").delete(id);
}

export async function getEntityTransactions(entityId: string) {
  return pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("from_entity = {:id} || to_entity = {:id}", { id: entityId }),
    sort: "-timestamp,-created",
    expand: "kit,from_entity,to_entity,created_by",
  });
}
