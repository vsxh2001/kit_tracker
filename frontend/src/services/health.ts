import { pb } from "../lib/pocketbase";

export async function getSmtpStatus(): Promise<{ enabled: boolean }> {
  const res = await pb.send("/api/health/smtp", { method: "GET", requestKey: "smtp-status" });
  return res as { enabled: boolean };
}

export interface WhatsAppTokenHealth {
  is_valid: boolean;
  expires_at?: number;
  days_remaining?: number;
  warning_level: "ok" | "warn14" | "warn7" | "warn1" | "expired" | "never" | "missing";
}

export async function getWhatsAppTokenHealth(): Promise<WhatsAppTokenHealth> {
  return (await pb.send("/api/health/whatsapp-token", { method: "GET", requestKey: "wa-token-health" })) as WhatsAppTokenHealth;
}
