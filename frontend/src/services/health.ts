import { pb } from "../lib/pocketbase";

export async function getSmtpStatus(): Promise<{ enabled: boolean }> {
  const res = await pb.send("/api/health/smtp", { method: "GET", requestKey: "smtp-status" });
  return res as { enabled: boolean };
}
