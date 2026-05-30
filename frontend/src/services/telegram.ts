import { pb } from "../lib/pocketbase";

export interface TelegramLinkCodeResponse {
  code: string;
  expires_at: string;
  instructions: string;
  deep_link?: string;
}

export async function mintTelegramLinkCode(): Promise<TelegramLinkCodeResponse> {
  const res = await pb.send("/api/tg/link/code", {
    method: "POST",
    requestKey: "tg-link-mint",
  });
  return res as TelegramLinkCodeResponse;
}

export interface TelegramBot {
  id: number;
  username: string;
  first_name: string;
  ok: boolean;
}

export interface TelegramWebhook {
  url: string;
  pending_update_count: number;
  last_error_date: number | null;
  last_error_message: string | null;
  has_custom_certificate: boolean;
}

export interface TelegramStatusConfigured {
  configured: true;
  bot: TelegramBot | null;
  webhook: TelegramWebhook | null;
  linked_users_count: number;
  group_chat_id_set: boolean;
}

export interface TelegramStatusNotConfigured {
  configured: false;
}

export type TelegramStatus = TelegramStatusConfigured | TelegramStatusNotConfigured;

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const res = await pb.send("/api/tg/admin/status", {
    method: "GET",
    requestKey: "tg-status",
  });
  return res as TelegramStatus;
}

