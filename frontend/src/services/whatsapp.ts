import { pb } from "../lib/pocketbase";

export interface WhatsAppSendInput {
  to: string;
  text?: string;
  template?: { name: string; language: string };
}

export async function sendWhatsAppMessage(
  input: WhatsAppSendInput
): Promise<{ messages?: Array<{ id: string }> }> {
  const res = await pb.send("/api/wa/send", {
    method: "POST",
    body: input,
    requestKey: "wa-send",
  });
  return res as { messages?: Array<{ id: string }> };
}

export interface WhatsAppPhoneNumber {
  display: string;
  verified_name: string;
  quality_rating: string;
  id: string;
}

export interface WhatsAppToken {
  type: string;
  expires_at: number;
  days_remaining: number;
  is_valid: boolean;
  scopes: string[];
}

export interface WhatsAppWebhook {
  url: string;
  verify_token_set: boolean;
  last_inbound_at: string | null;
}

export interface WhatsAppSubscribedApp {
  id: string;
  name: string;
}

export interface WhatsAppWaba {
  id: string;
  subscribed_apps: WhatsAppSubscribedApp[];
}

export interface WhatsAppStatus {
  phoneNumber: WhatsAppPhoneNumber | null;
  token: WhatsAppToken | null;
  webhook: WhatsAppWebhook;
  waba: WhatsAppWaba | null;
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const res = await pb.send("/api/wa/admin/status", {
    method: "GET",
    requestKey: "wa-status",
  });
  return res as WhatsAppStatus;
}

export interface BroadcastRecipientFilter {
  type: "role" | "phones";
  value: string | string[];
}

export interface BroadcastMessage {
  type: "text" | "template";
  text?: string;
  template?: { name: string; language: string };
}

export interface BroadcastResult {
  totalRecipients: number;
  successCount: number;
  failed: Array<{ phone: string; error: string }>;
  message?: string;
}

export async function broadcastWhatsApp(input: {
  recipientFilter: BroadcastRecipientFilter;
  message: BroadcastMessage;
}): Promise<BroadcastResult> {
  const res = await pb.send("/api/wa/broadcast", {
    method: "POST",
    body: input,
    requestKey: "wa-broadcast",
  });
  return res as BroadcastResult;
}

export interface RolePhoneCount {
  role: string;
  count: number;
}

export async function getRolePhoneCount(role: string): Promise<RolePhoneCount> {
  const records = await pb.collection("users").getFullList({
    filter: pb.filter("role = {:role} && phone != ''", { role }),
    fields: "id",
    requestKey: `wa-role-count-${role}`,
  });
  return { role, count: records.length };
}

export interface WhatsAppMessage {
  id: string;
  created: string;
  actor: string;
  to: string;
  direction: "inbound" | "outbound";
  event?: string;
  templateName?: string;
  mode?: string;
  success: boolean;
  // inbound-only fields
  from?: string;
  body?: string;
  contactName?: string;
  expand?: { actor?: import("../types").PBUser };
}

export async function listWhatsAppMessages(opts: {
  phone?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: WhatsAppMessage[]; totalItems: number }> {
  const limit = opts.limit ?? 50;
  const page = opts.offset !== undefined ? Math.floor(opts.offset / limit) + 1 : 1;

  const actionFilter = pb.filter(
    "(action = {:out} || action = {:inn})",
    { out: "send_whatsapp", inn: "receive_whatsapp" }
  );
  const parts: string[] = [actionFilter];
  if (opts.phone) {
    parts.push(pb.filter("changes ~ {:phone}", { phone: opts.phone }));
  }
  const filter = parts.join(" && ");

  const result = await pb.collection("audit_log").getList(page, limit, {
    sort: "-created",
    expand: "actor",
    filter,
    requestKey: `wa-messages-${opts.phone ?? "all"}-p${page}`,
  });

  const items: WhatsAppMessage[] = result.items.map((r) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(r.changes as string);
    } catch {
      // ignore
    }
    const isInbound = (r.action as string) === "receive_whatsapp";
    return {
      id: r.id,
      created: r.created,
      actor: r.actor as string,
      direction: isInbound ? "inbound" : "outbound",
      to: isInbound ? "" : ((parsed.to as string) ?? ""),
      event: parsed.event as string | undefined,
      templateName: parsed.templateName as string | undefined,
      mode: parsed.mode as string | undefined,
      success: isInbound ? true : Boolean(parsed.success),
      from: isInbound ? (parsed.from as string | undefined) : undefined,
      body: isInbound ? (parsed.body as string | undefined) : undefined,
      contactName: isInbound ? (parsed.name as string | undefined) : undefined,
      expand: r.expand as WhatsAppMessage["expand"],
    };
  });

  return { items, totalItems: result.totalItems };
}
