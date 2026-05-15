export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  ts: string;
  tool_result?: ToolResult;
  undo_token?: string;
  clarification_needed?: ClarificationRequest;
}

export interface ChatSession {
  sessionId: string;
  messages: Message[];
}

export interface ToolResult {
  tool: string;
  action: string;
  record_id: string;
  collection: string;
  description: string;
}

export interface UndoToken {
  token: string;
  expires_at: number;
}

export interface ClarificationCandidate {
  id: string;
  label: string;
  detail?: string;
}

export interface ClarificationRequest {
  field: string;
  candidates: ClarificationCandidate[];
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  done: boolean;
  tool_result?: ToolResult;
  undo_token?: string;
  clarification_needed?: ClarificationRequest;
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
