import { pb } from "../lib/pocketbase";
import type { Component } from "../types";

export async function listComponents(opts?: { activeOnly?: boolean; requestKey?: string }): Promise<Component[]> {
  const filters: string[] = [];
  if (opts?.activeOnly) filters.push("is_active = true");
  const params: Record<string, unknown> = {
    sort: "serial",
    expand: "product",
    requestKey: opts?.requestKey ?? "list-components",
  };
  if (filters.length) params.filter = filters.join(" && ");
  return pb.collection("components").getFullList<Component>(params);
}

export async function getComponent(id: string): Promise<Component> {
  return pb.collection("components").getOne<Component>(id, {
    expand: "product",
    requestKey: `get-component-${id}`,
  });
}

export async function getComponentBySerial(serial: string): Promise<Component> {
  return pb.collection("components").getFirstListItem<Component>(
    pb.filter("serial = {:serial}", { serial }),
    { expand: "product", requestKey: `get-component-by-serial-${serial}` }
  );
}

export async function createComponent(data: Partial<Component>): Promise<Component> {
  return pb.collection("components").create<Component>(data);
}

export async function updateComponent(id: string, data: Partial<Component>): Promise<Component> {
  return pb.collection("components").update<Component>(id, data);
}
