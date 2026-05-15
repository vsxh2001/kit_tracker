import { pb } from "../lib/pocketbase";
import type { ChatResponse, RateLimitError } from "../types/ai";

export class AiRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "AiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function sendChatMessage(
  message: string,
  sessionId?: string
): Promise<ChatResponse> {
  const token = pb.authStore.token;
  // Route through the PB origin (dev: localhost:8090; prod: same-origin
  // when PB serves frontend). pb.baseUrl is set in lib/pocketbase.ts.
  const url = `${pb.baseUrl.replace(/\/$/, "")}/api/ai/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify({ message, sessionId }),
  });

  if (res.status === 429) {
    const data: RateLimitError = await res.json();
    throw new AiRateLimitError(data.retry_after_seconds ?? 3600);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<ChatResponse>;
}
