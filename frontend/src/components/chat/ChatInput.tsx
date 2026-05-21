import { useEffect } from "react";
import { Send } from "lucide-react";
import { cn } from "../../lib/utils";

interface SlashCommandItem {
  name: string;
  usage: string;
  help: string;
}

interface ChatInputProps {
  input: string;
  loading: boolean;
  acItems: SlashCommandItem[];
  acIndex: number;
  argSuggestions: string[];
  argAcIndex: number;
  open: boolean;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onArgSuggestionClick: (s: string) => void;
  onCommandClick: (name: string) => void;
  onAcDismissReset: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  input,
  loading,
  acItems,
  acIndex,
  argSuggestions,
  argAcIndex,
  open,
  onInputChange,
  onKeyDown,
  onSend,
  onArgSuggestionClick,
  onCommandClick,
  onAcDismissReset,
  textareaRef,
}: ChatInputProps) {
  // Auto-grow textarea up to 4 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20;
    const maxHeight = lineHeight * 4 + 16;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [input, textareaRef]);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, textareaRef]);

  return (
    <div className="px-4 py-3 border-t border-slate-800 shrink-0">
      {/* Field-aware arg autocomplete (serials / entity names / product names) */}
      {argSuggestions.length > 0 && (
        <div className="mb-2 rounded-md border border-indigo-700/60 bg-slate-800 overflow-hidden">
          {argSuggestions.map((s, i) => {
            const typedLen = (() => {
              const spaceIdx = input.indexOf(" ");
              return spaceIdx === -1 ? 0 : input.slice(spaceIdx + 1).length;
            })();
            const prefix = s.slice(0, typedLen);
            const suffix = s.slice(typedLen);
            return (
              <button
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onArgSuggestionClick(s);
                  textareaRef.current?.focus();
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs font-mono",
                  i === argAcIndex ? "bg-indigo-900/60 text-white" : "text-slate-300 hover:bg-slate-700"
                )}
              >
                <span className="font-bold text-indigo-300">{prefix}</span>
                <span className="text-slate-400">{suffix}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* Slash command name autocomplete */}
      {acItems.length > 0 && (
        <div className="mb-2 rounded-md border border-slate-700 bg-slate-800 overflow-hidden">
          {acItems.map((cmd, i) => (
            <button
              key={cmd.name}
              onMouseDown={(e) => {
                e.preventDefault();
                onCommandClick(cmd.name);
                onAcDismissReset();
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
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
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
          onClick={onSend}
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
  );
}
