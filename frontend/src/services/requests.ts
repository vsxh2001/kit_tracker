import { pb } from "../lib/pocketbase";
import type { KitRequest, RequestStatus } from "../types";
import { createTransaction } from "./transactions";

export async function listRequests(statusFilter?: RequestStatus) {
  const filter = statusFilter ? `status = "${statusFilter}"` : "";
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
  return pb.collection("requests").update<KitRequest>(id, { status, ...opts });
}

export async function fulfillRequest(request: KitRequest, fromEntityId: string) {
  if (!request.designated_kit || !request.target_entity) {
    throw new Error("Request must have designated kit and target entity to fulfill.");
  }
  await createTransaction({
    kitId: request.designated_kit,
    fromEntityId,
    toEntityId: request.target_entity,
    requestId: request.id,
    notes: `Fulfilled request ${request.id}`,
  });
  return pb.collection("requests").update<KitRequest>(request.id, { status: "fulfilled" });
}
