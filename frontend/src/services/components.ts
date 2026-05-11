import { pb } from "../lib/pocketbase";
import type { Component } from "../types";

export async function listComponents(opts?: { type?: string; activeOnly?: boolean }): Promise<Component[]> {
  const filters: string[] = [];
  if (opts?.activeOnly) filters.push("is_active = true");
  if (opts?.type) filters.push(pb.filter("type = {:type}", { type: opts.type }));
  return pb.collection("components").getFullList<Component>({
    sort: "type,serial",
    filter: filters.join(" && ") || undefined,
    requestKey: "list-components",
  });
}

export async function getComponent(id: string): Promise<Component> {
  return pb.collection("components").getOne<Component>(id, {
    requestKey: `get-component-${id}`,
  });
}

export async function createComponent(data: Partial<Component>): Promise<Component> {
  return pb.collection("components").create<Component>(data);
}

export async function updateComponent(id: string, data: Partial<Component>): Promise<Component> {
  return pb.collection("components").update<Component>(id, data);
}
