import { pb } from "../lib/pocketbase";
import type { Component } from "../types";

export async function listComponents(opts?: { activeOnly?: boolean; requestKey?: string }): Promise<Component[]> {
  const filters: string[] = [];
  if (opts?.activeOnly) filters.push("is_active = true");
  return pb.collection("components").getFullList<Component>({
    sort: "serial",
    filter: filters.join(" && ") || undefined,
    expand: "product",
    requestKey: opts?.requestKey ?? "list-components",
  });
}

export async function getComponent(id: string): Promise<Component> {
  return pb.collection("components").getOne<Component>(id, {
    expand: "product",
    requestKey: `get-component-${id}`,
  });
}

export async function createComponent(data: Partial<Component>): Promise<Component> {
  return pb.collection("components").create<Component>(data);
}

export async function updateComponent(id: string, data: Partial<Component>): Promise<Component> {
  return pb.collection("components").update<Component>(id, data);
}
