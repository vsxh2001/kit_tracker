import { pb } from "../lib/pocketbase";
import type { ChatResponse, RateLimitError, CostCapError } from "../types/ai";

export class AiRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "AiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AiCostCapError extends Error {
  spentCents: number;
  capCents: number;
  constructor(spentCents: number, capCents: number) {
    super("Daily AI cost cap reached");
    this.name = "AiCostCapError";
    this.spentCents = spentCents;
    this.capCents = capCents;
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

  if (res.status === 503) {
    const data: CostCapError = await res.json().catch(() => ({ error: "daily_cost_cap", spent_cents: 0, cap_cents: 100 }));
    throw new AiCostCapError(data.spent_cents ?? 0, data.cap_cents ?? 100);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<ChatResponse>;
}

export async function undoAction(token: string): Promise<void> {
  const authToken = pb.authStore.token;
  const url = `${pb.baseUrl.replace(/\/$/, "")}/api/ai/undo`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: authToken } : {}),
    },
    body: JSON.stringify({ undo_token: token }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Undo failed: ${res.status}`);
  }
}
