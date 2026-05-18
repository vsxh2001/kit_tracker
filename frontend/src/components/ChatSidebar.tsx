import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Bot, Undo2, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import { sendChatMessage, undoAction, AiRateLimitError, AiCostCapError } from "../services/ai";
import type { Message, ToolResult, ClarificationRequest } from "../types/ai";
import { COMMANDS, isSlashCommand, parseCommand, execute } from "./chat/slash-commands";

let _msgCounter = 0;
function genId() {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

interface ChatSidebarProps {
  open: boolean;
  onClose: () => void;
}

interface TextSegment {
  type: "text" | "code" | "link";
  value: string;
  href?: string;
}

/**
 * Parse assistant message text into segments for rendering.
 * - Backtick spans → inline code; if the span looks like a PB record ID (15 alphanum)
 *   we also render it as a clickable link based on context (kits / entities).
 * - Newlines → preserved via whitespace-pre-wrap on the container.
 */
function parseAssistantContent(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Split on backtick spans
  const parts = text.split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const inner = part.slice(1, -1);
      // Check if it looks like a PB record ID (15 lowercase alphanum)
      if (/^[a-z0-9]{15}$/.test(inner)) {
        // We don't know the collection without context; default to kits.
        // For Phase 1 the model is instructed to cite IDs — most will be kit IDs.
        // A smarter approach would check prefix conventions (future).
        segments.push({ type: "link", value: inner, href: `/kits/${inner}` });
      } else {
        segments.push({ type: "code", value: inner });
      }
    } else if (part) {
      segments.push({ type: "text", value: part });
    }
  }
  return segments;
}

function AssistantMessage({ content }: { content: string }) {
  const segments = parseAssistantContent(content);
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "link") {
          return (
            <Link
              key={i}
              to={seg.href!}
              className="font-mono text-indigo-300 underline hover:text-indigo-200"
            >
              {seg.value}
            </Link>
          );
        }
        if (seg.type === "code") {
          return (
            <code
              key={i}
              className="font-mono text-xs bg-slate-700 px-1 py-0.5 rounded text-slate-200"
            >
              {seg.value}
            </code>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </span>
  );
}

const COLLECTION_PATHS: Record<string, string> = {
  entities: "/entities",
  kits: "/kits",
  transactions: "/kits",
};

function ToolResultCard({
  toolResult,
  undoToken,
  onUndo,
}: {
  toolResult: ToolResult;
  undoToken?: string;
  onUndo?: () => void;
}) {
  const [undone, setUndone] = useState(false);
  const [undoVisible, setUndoVisible] = useState(!!undoToken);
  const [undoing, setUndoing] = useState(false);
  const [countdown, setCountdown] = useState(() => (undoToken ? 60 : 0));

  useEffect(() => {
    if (!undoToken) return;
    const hideTimer = setTimeout(() => setUndoVisible(false), 60_000);
    const ticker = setInterval(() => {
      setCountdown((s) => (s > 1 ? s - 1 : s));
    }, 1000);
    return () => {
      clearTimeout(hideTimer);
      clearInterval(ticker);
    };
  }, [undoToken]);

  const basePath = COLLECTION_PATHS[toolResult.collection] ?? "/";
  const recordPath = `${basePath}/${toolResult.record_id}`;

  async function handleUndo() {
    if (!undoToken || undoing) return;
    setUndoing(true);
    try {
      await undoAction(undoToken);
      setUndone(true);
      setUndoVisible(false);
      onUndo?.();
      toast({ title: "Reverted", description: toolResult.description + " has been reverted.", variant: "success" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not undo action.";
      if (msg === "expired") {
        setUndoVisible(false);
        toast({ title: "Undo window closed", description: "The 60s undo window has elapsed.", variant: "destructive" });
      } else {
        toast({
          title: "Undo failed",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      data-testid="tool-result-card"
      className={cn(
        "rounded-lg border px-3 py-2 text-xs mt-1",
        undone
          ? "border-slate-600 bg-slate-800/40 text-slate-500"
          : "border-emerald-700/50 bg-emerald-950/40 text-emerald-200"
      )}
    >
      <div className="flex items-start gap-2">
        <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
        <div className="flex-1 min-w-0">
          <p className={cn("font-medium", undone && "line-through text-slate-500")}>
            {toolResult.description}
          </p>
          {!undone && (
            <Link
              to={recordPath}
              className="text-indigo-400 underline hover:text-indigo-300 truncate block"
            >
              View record
            </Link>
          )}
          {undone && <p className="text-slate-500 italic">Undone</p>}
        </div>
        {undoVisible && !undone && (
          <button
            data-testid="undo-button"
            onClick={handleUndo}
            disabled={undoing}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors shrink-0",
              "bg-slate-700 text-slate-200 hover:bg-slate-600",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Undo2 className="h-3 w-3" />
            Undo ({countdown}s)
          </button>
        )}
      </div>
    </div>
  );
}

function ClarificationCard({
  clarification,
  onChoose,
}: {
  clarification: ClarificationRequest;
  onChoose: (id: string, label: string, field: string) => void;
}) {
  return (
    <div
      data-testid="clarification-card"
      className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs mt-1"
    >
      <p className="text-amber-200 font-medium mb-2">
        Multiple matches for <code className="font-mono bg-slate-700 px-1 rounded">{clarification.field}</code>. Pick one:
      </p>
      <div className="flex flex-col gap-1">
        {clarification.candidates.map((c) => (
          <button
            key={c.id}
            data-testid={`clarification-choice-${c.id}`}
            onClick={() => onChoose(c.id, c.label, clarification.field)}
            className="text-left rounded px-2 py-1 bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            <span className="font-medium">{c.label}</span>
            {c.detail && <span className="text-slate-400 ml-1">— {c.detail}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatSidebar({ open, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [acIndex, setAcIndex] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete: show when input starts with "/" but isn't a fully-typed known command+args
  const acItems = (() => {
    if (acDismissed) return [];
    const v = input.trimStart();
    if (!v.startsWith("/")) return [];
    const typed = v.slice(1).toLowerCase();
    // Hide once a space appears (command fully entered)
    if (typed.includes(" ")) return [];
    return COMMANDS.filter((c) => c.name.startsWith(typed)).slice(0, 5);
  })();

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-grow textarea up to 4 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20;
    const maxHeight = lineHeight * 4 + 16;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [input]);

  const sendMessage = useCallback(async (msg: string) => {
    if (!msg || loading) return;

    const userMsg: Message = {
      id: genId(),
      role: "user",
      content: msg,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Slash command: resolve locally, skip LLM round-trip
    if (isSlashCommand(msg)) {
      const parsed = parseCommand(msg);
      if (parsed) {
        try {
          const result = await execute(parsed);
          const assistantMsg: Message = {
            id: genId(),
            role: "assistant",
            content: result.ok ? result.text : result.error,
            ts: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        } catch (err: unknown) {
          const assistantMsg: Message = {
            id: genId(),
            role: "assistant",
            content: err instanceof Error ? err.message : "Command failed.",
            ts: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        } finally {
          setLoading(false);
        }
        return;
      }
    }

    try {
      const res = await sendChatMessage(msg, sessionId);
      if (res.sessionId) setSessionId(res.sessionId);
      const assistantMsg: Message = {
        id: genId(),
        role: "assistant",
        content: res.reply,
        ts: new Date().toISOString(),
        tool_result: res.tool_result,
        undo_token: res.undo_token,
        clarification_needed: res.clarification_needed,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Show toast for successful write actions
      if (res.tool_result && res.undo_token) {
        toast({
          title: res.tool_result.description,
          description: "Action logged. Click Undo in the chat to reverse within 60s.",
          variant: "success",
        });
      }
    } catch (err: unknown) {
      if (err instanceof AiRateLimitError) {
        toast({
          title: "Rate limit reached",
          description: `Too many messages. Try again in ${err.retryAfterSeconds} seconds.`,
          variant: "destructive",
        });
      } else if (err instanceof AiCostCapError) {
        toast({
          title: "Daily AI budget reached",
          description: "The daily AI usage budget has been reached. Try again tomorrow.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Chat error",
          description: err instanceof Error ? err.message : "Failed to send message.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    await sendMessage(msg);
  }, [input, sendMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (acItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => Math.min(i + 1, acItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const chosen = acItems[acIndex];
        if (chosen) setInput(`/${chosen.name} `);
        setAcIndex(0);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAcDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClarificationChoose(id: string, label: string, field: string) {
    const msg = `use ${id} (${label}) for ${field}`;
    sendMessage(msg);
  }

  return (
    <>
      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        aria-label="AI chat"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[400px] bg-slate-900 border-l border-slate-800 shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Ask AI</p>
              <p className="text-xs text-slate-400">Powered by Claude — verify critical data</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close AI chat"
            className="text-slate-400 hover:text-slate-100 h-9 w-9 flex items-center justify-center rounded-md transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !loading && (
            <p className="text-xs text-slate-500 text-center mt-8">
              Ask anything about your kits, entities, or requests.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex gap-2 max-w-full",
                m.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {m.role === "assistant" && (
                <div className="h-6 w-6 rounded-full bg-indigo-900/70 ring-1 ring-indigo-700/50 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-indigo-300" />
                </div>
              )}
              <div className="flex flex-col max-w-[80%] min-w-0">
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm break-words",
                    m.role === "user"
                      ? "bg-indigo-600 text-white whitespace-pre-wrap"
                      : "bg-slate-800 text-slate-100 whitespace-pre-wrap"
                  )}
                >
                  {m.role === "assistant" ? (
                    <AssistantMessage content={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === "assistant" && m.tool_result && (
                  <ToolResultCard
                    toolResult={m.tool_result}
                    undoToken={m.undo_token}
                  />
                )}
                {m.role === "assistant" && m.clarification_needed && (
                  <ClarificationCard
                    clarification={m.clarification_needed}
                    onChoose={handleClarificationChoose}
                  />
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="h-6 w-6 rounded-full bg-indigo-900/70 ring-1 ring-indigo-700/50 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-indigo-300" />
              </div>
              <div className="rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-400">
                <span className="animate-pulse">...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-800 shrink-0">
          {/* Slash command autocomplete */}
          {acItems.length > 0 && (
            <div className="mb-2 rounded-md border border-slate-700 bg-slate-800 overflow-hidden">
              {acItems.map((cmd, i) => (
                <button
                  key={cmd.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setInput(`/${cmd.name} `);
                    setAcIndex(0);
                    setAcDismissed(false);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs flex gap-2",
                    i === acIndex ? "bg-accent text-accent-foreground" : "text-slate-300 hover:bg-slate-700"
                  )}
                >
                  <span className="font-mono text-indigo-400 shrink-0">{cmd.usage}</span>
                  <span className="text-slate-400">{cmd.help}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setAcDismissed(false); setAcIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={loading}
              aria-label="Chat message input"
              className={cn(
                "flex-1 resize-none rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "overflow-y-auto"
              )}
              style={{ minHeight: "36px", maxHeight: "96px" }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className={cn(
                "h-9 w-9 flex items-center justify-center rounded-md transition-colors shrink-0",
                "bg-indigo-600 text-white hover:bg-indigo-500",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
