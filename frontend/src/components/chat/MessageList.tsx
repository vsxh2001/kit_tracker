import { useRef, useEffect } from "react";
import { Terminal } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Message } from "../../types/ai";
import { AssistantMessage } from "./AssistantMessage";

interface MessageListProps {
  messages: Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {messages.length === 0 && !loading && (
        <p className="text-xs text-slate-500 text-center mt-8">
          Type /help to see available commands.
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
              <Terminal className="h-3.5 w-3.5 text-indigo-300" />
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
          </div>
        </div>
      ))}
      {loading && (
        <div className="flex gap-2 justify-start">
          <div className="h-6 w-6 rounded-full bg-indigo-900/70 ring-1 ring-indigo-700/50 flex items-center justify-center shrink-0 mt-0.5">
            <Terminal className="h-3.5 w-3.5 text-indigo-300" />
          </div>
          <div className="rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-400">
            <span className="animate-pulse">...</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
