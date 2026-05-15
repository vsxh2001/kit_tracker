export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  ts: string;
}

export interface ChatSession {
  sessionId: string;
  messages: Message[];
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  done: boolean;
}

export interface RateLimitError {
  error: "rate_limit";
  retry_after_seconds: number;
}

export interface CostCapError {
  error: "daily_cost_cap";
  spent_cents: number;
  cap_cents: number;
}
