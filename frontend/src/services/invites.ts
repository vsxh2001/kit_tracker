import { pb } from "../lib/pocketbase";
import { baseUrl } from "./admin";

export interface Invite {
  id: string;
  token_hash: string;
  created_by: string;
  role: string;
  email: string;
  phone: string;
  expires_at: string;
  used_at: string;
  used_by: string;
  revoked_at: string;
  created: string;
  updated: string;
}

export interface InvitePreview {
  role: string;
  expires_at: string;
}

export interface AcceptResult {
  token: string;
  record: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export interface CreateInviteResult {
  url: string;
  invite_id: string;
  expires_at: string;
}

export async function createInvite(
  role: string,
  email: string,
  opts?: { phone?: string }
): Promise<CreateInviteResult> {
  const res = await fetch(`${baseUrl()}/api/invite/create`, {
    method: "POST",
    headers: {
      Authorization: pb.authStore.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role,
      email,
      ...(opts?.phone ? { phone: opts.phone } : {}),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Create failed: ${res.status}`);
  return body;
}

export async function listInvites(): Promise<Invite[]> {
  return pb.collection("invites").getFullList<Invite>({
    sort: "-created",
    requestKey: "list-invites",
  });
}

export async function revokeInvite(id: string): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
  await pb.collection("invites").update(id, { revoked_at: now }, { requestKey: `revoke-invite-${id}` });
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const res = await fetch(`${baseUrl()}/api/invite/preview/${encodeURIComponent(token)}`);
  const body = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: Error & Record<string, any> = new Error(body.error ?? `Preview failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function acceptInvite(payload: {
  token: string;
  email: string;
  name?: string;
  password: string;
}): Promise<AcceptResult> {
  const res = await fetch(`${baseUrl()}/api/invite/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: Error & Record<string, any> = new Error(body.error ?? `Accept failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}
