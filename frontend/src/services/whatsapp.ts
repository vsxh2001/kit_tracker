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
