import { pb } from "../lib/pocketbase";

function baseUrl(): string {
  return pb.baseUrl.replace(/\/+$/, "");
}

export type CascadeCollection = "kits" | "entities" | "components" | "transactions" | "products";

export interface CascadeBlocker {
  collection: string;
  count: number;
  sample_ids?: string[];
}

export interface CascadePreview {
  collection: CascadeCollection;
  record_id: string;
  identifier_field: string;
  identifier_value: string;
  blocked: boolean;
  blockers: CascadeBlocker[];
  counts: Record<string, number>;
}

export async function getCascadePreview(
  collection: CascadeCollection,
  recordId: string,
): Promise<CascadePreview> {
  const res = await fetch(`${baseUrl()}/api/admin/cascade-delete/preview`, {
    method: "POST",
    headers: { Authorization: pb.authStore.token, "Content-Type": "application/json" },
    body: JSON.stringify({ collection, record_id: recordId }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `Preview failed: ${res.status}`);
  }
  return res.json();
}

export async function cascadeDelete(
  collection: CascadeCollection,
  recordId: string,
  confirmText: string,
): Promise<{ deleted: Record<string, number> }> {
  const res = await fetch(`${baseUrl()}/api/admin/cascade-delete`, {
    method: "POST",
    headers: { Authorization: pb.authStore.token, "Content-Type": "application/json" },
    body: JSON.stringify({ collection, record_id: recordId, confirm_text: confirmText }),
  });
  const body = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: Error & Record<string, any> = new Error(body.error ?? `Delete failed: ${res.status}`);
    Object.assign(err, body);
    throw err;
  }
  return body;
}
