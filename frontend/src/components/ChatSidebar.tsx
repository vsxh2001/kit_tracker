import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Bot } from "lucide-react";
import { cn } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import { sendChatMessage, AiRateLimitError } from "../services/ai";
import type { Message } from "../types/ai";

let _msgCounter = 0;
function genId() {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

interface ChatSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function ChatSidebar({ open, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = useCallback(async () => {
    const msg = input.trim();
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

    try {
      const res = await sendChatMessage(msg, sessionId);
      if (res.sessionId) setSessionId(res.sessionId);
      const assistantMsg: Message = {
        id: genId(),
        role: "assistant",
        content: res.reply,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      if (err instanceof AiRateLimitError) {
        toast({
          title: "Rate limit reached",
          description: `Too many messages. Try again in ${err.retryAfterSeconds} seconds.`,
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
  }, [input, loading, sessionId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
              <p className="text-xs text-amber-400">Plumbing only — AI replies pending</p>
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
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words",
                  m.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-100"
                )}
              >
                {m.content}
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
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
