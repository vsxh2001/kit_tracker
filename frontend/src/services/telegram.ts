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
