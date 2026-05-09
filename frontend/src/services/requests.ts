import { pb } from "../lib/pocketbase";
import type { KitRequest, RequestStatus } from "../types";
import { createTransaction } from "./transactions";
import { getLatestTransaction } from "./kits";

export async function listRequests(statusFilter?: RequestStatus) {
  const filter = statusFilter
    ? pb.filter("status = {:status}", { status: statusFilter })
    : "";
  return pb.collection("requests").getFullList<KitRequest>({
    sort: "-created",
    filter,
    expand: "requester,designated_kit,target_entity",
  });
}

export async function getRequest(id: string) {
  return pb.collection("requests").getOne<KitRequest>(id, {
    expand: "requester,designated_kit,target_entity",
  });
}

export async function createRequest(data: {
  notes?: string;
  designated_kit?: string;
  target_entity?: string;
  expected_return?: string;
  delivery_date: string;
}) {
  return pb.collection("requests").create<KitRequest>({
    requester: pb.authStore.model?.id,
    date: new Date().toISOString().split("T")[0],
    status: "open",
    ...data,
  });
}

export async function updateRequestStatus(
  id: string,
  status: RequestStatus,
  opts?: { decision_notes?: string; designated_kit?: string; target_entity?: string }
) {
  const current = await pb.collection("requests").getOne<KitRequest>(id);
  return pb.collection("requests").update<KitRequest>(id, {
    ...opts,
    status,
    delivery_date: current.delivery_date,
  });
}

export async function updateRequest(
  id: string,
  data: { notes?: string; target_entity?: string; designated_kit?: string; delivery_date?: string }
): Promise<KitRequest> {
  return pb.collection("requests").update<KitRequest>(id, data);
}


export async function deleteRequest(id: string): Promise<void> {
  await pb.collection("requests").delete(id);
}

export async function fulfillRequest(request: KitRequest) {
  if (!request.designated_kit || !request.target_entity) {
    throw new Error("Request must have designated kit and target entity to fulfill.");
  }

  const latest = await getLatestTransaction(request.designated_kit);
  const fromEntityId = latest?.to_entity || undefined;

  const tx = await createTransaction({
    kitId: request.designated_kit,
    fromEntityId,
    toEntityId: request.target_entity,
    requestId: request.id,
    notes: `Fulfilled request ${request.id}`,
  });

  try {
    return await pb.collection("requests").update<KitRequest>(request.id, {
      status: "fulfilled",
      delivery_date: request.delivery_date,
    });
  } catch (err) {
    try {
      await pb.collection("transactions").delete(tx.id);
    } catch {
      // best-effort compensation; surface original error regardless
    }
    throw err;
  }
}
