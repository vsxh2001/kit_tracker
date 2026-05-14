import { pb } from "../lib/pocketbase";
import type { Component, ComponentTransaction } from "../types";
import { updateComponent, createComponent } from "./components";

export async function listTransactionsForComponent(componentId: string): Promise<ComponentTransaction[]> {
  return pb.collection("component_transactions").getFullList<ComponentTransaction>({
    filter: pb.filter("component = {:id}", { id: componentId }),
    sort: "-timestamp,-created",
    expand: "from_kit,from_entity,to_kit,to_entity,created_by",
    requestKey: `comp-tx-for-${componentId}`,
  });
}

export async function getLatestForComponent(componentId: string): Promise<ComponentTransaction | null> {
  const result = await pb.collection("component_transactions").getList<ComponentTransaction>(1, 1, {
    filter: pb.filter("component = {:id}", { id: componentId }),
    sort: "-timestamp,-created",
    expand: "from_kit,from_entity,to_kit,to_entity",
    requestKey: `comp-latest-tx-${componentId}`,
  });
  return result.items[0] ?? null;
}

// Efficient batch: get latest tx per component via single getFullList sorted by -timestamp,-created,
// then dedupe client-side by component id.
async function getLatestTxPerComponent(): Promise<Map<string, ComponentTransaction>> {
  const all = await pb.collection("component_transactions").getFullList<ComponentTransaction>({
    sort: "-timestamp,-created",
    expand: "to_kit,to_entity",
    requestKey: "comp-tx-all-latest",
  });
  const map = new Map<string, ComponentTransaction>();
  for (const tx of all) {
    if (!map.has(tx.component)) map.set(tx.component, tx);
  }
  return map;
}

export async function listComponentsInKit(kitId: string): Promise<Component[]> {
  const [allComponents, latestByComponent] = await Promise.all([
    pb.collection("components").getFullList<Component>({
      filter: "is_active = true",
      expand: "product",
      requestKey: "components-for-kit-list",
    }),
    getLatestTxPerComponent(),
  ]);
  return allComponents.filter((c) => {
    const tx = latestByComponent.get(c.id);
    return tx && tx.to_kit === kitId;
  });
}

export async function listComponentsAtEntity(entityId: string): Promise<Component[]> {
  const [allComponents, latestByComponent] = await Promise.all([
    pb.collection("components").getFullList<Component>({
      filter: "is_active = true",
      requestKey: "components-for-entity-list",
    }),
    getLatestTxPerComponent(),
  ]);
  return allComponents.filter((c) => {
    const tx = latestByComponent.get(c.id);
    return tx && tx.to_entity === entityId && !tx.to_kit;
  });
}

export async function createComponentTransaction(
  data: Partial<ComponentTransaction>
): Promise<ComponentTransaction> {
  const componentId = data.component;
  if (!componentId) throw new Error("component required");

  // Auto-derive from_kit/from_entity from component's latest transaction (if caller didn't supply)
  const derivedData = { ...data };
  if (!derivedData.from_kit && !derivedData.from_entity) {
    const latest = await getLatestForComponent(componentId);
    if (latest) {
      derivedData.from_kit = latest.to_kit || "";
      derivedData.from_entity = latest.to_entity || "";
    }
    // No latest tx → initial placement; leave from_* empty (hook allows first tx)
  }

  return pb.collection("component_transactions").create<ComponentTransaction>({
    ...derivedData,
    timestamp: derivedData.timestamp ?? new Date().toISOString(),
    created_by: pb.authStore.model?.id,
  }, { requestKey: `create-tx-${componentId}-${Date.now()}` });
}

export interface SplitResult {
  source: Component;
  moved: Component;
  transaction: ComponentTransaction;
}

export async function splitAndMoveBulk(
  componentId: string,
  qty: number,
  target: { kit?: string; entity?: string },
  notes?: string
): Promise<SplitResult> {
  // 1. Fetch source
  const source = await pb.collection("components").getOne<Component>(componentId, {
    requestKey: `split-source-${componentId}`,
  });
  if (qty >= source.quantity) {
    throw new Error(`Split quantity (${qty}) must be less than source quantity (${source.quantity}).`);
  }

  // 2. Create new component record with split qty
  const moved = await createComponent({
    type: source.type,
    notes: source.notes,
    is_active: true,
    is_bulk: true,
    quantity: qty,
    serial: "",
  });

  // 3. Decrement source quantity
  const updatedSource = await updateComponent(source.id, {
    quantity: source.quantity - qty,
  });

  // 4. Create transaction for the new split component
  const transaction = await createComponentTransaction({
    component: moved.id,
    to_kit: target.kit ?? "",
    to_entity: target.entity ?? "",
    quantity: qty,
    notes: notes ?? "",
  });

  return { source: updatedSource, moved, transaction };
}
