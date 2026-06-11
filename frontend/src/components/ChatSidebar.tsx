import { useState, useRef, useEffect, useCallback } from "react";
import { X, Terminal } from "lucide-react";
import { cn } from "../lib/utils";
import type { Message } from "../types/ai";
import { COMMANDS, isSlashCommand, parseCommand, execute, getArgResourceType } from "./chat/slash-commands";
import { fetchKitSerials, fetchEntityNames, fetchProductNames } from "./chat/slash-commands/handlers";
import { MessageList } from "./chat/MessageList";
import { ChatInput } from "./chat/ChatInput";

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
  const loadingRef = useRef(false);
  const [acIndex, setAcIndex] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const [argSuggestions, setArgSuggestions] = useState<string[]>([]);
  const [argAcIndex, setArgAcIndex] = useState(0);
  const [argAcDismissed, setArgAcDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplete: show when input starts with "/" but isn't a fully-typed known command+args
  const acItems = (() => {
    if (acDismissed) return [];
    const v = input.trimStart();
    if (!v.startsWith("/")) return [];
    const typed = v.slice(1).toLowerCase();
    if (typed.includes(" ")) return [];
    return COMMANDS.filter((c) => c.name.startsWith(typed)).slice(0, 5);
  })();

  // Field-aware arg autocomplete
  useEffect(() => {
    let cancelled = false;

    async function compute() {
      if (argAcDismissed) { setArgSuggestions([]); return; }
      const v = input.trimStart();
      if (!v.startsWith("/")) { setArgSuggestions([]); return; }
      const spaceIdx = v.indexOf(" ");
      if (spaceIdx === -1) { setArgSuggestions([]); return; }
      const cmdName = v.slice(1, spaceIdx).toLowerCase();
      const typed = v.slice(spaceIdx + 1);
      if (!typed) { setArgSuggestions([]); return; }
      const resourceType = getArgResourceType(cmdName);
      if (!resourceType) { setArgSuggestions([]); return; }

      const fetchFn =
        resourceType === "kit-serial" ? fetchKitSerials :
        resourceType === "entity-name" ? fetchEntityNames :
        fetchProductNames;

      try {
        const items = await fetchFn();
        if (cancelled) return;
        const lower = typed.toLowerCase();
        const matches = items.filter((s) => s.toLowerCase().startsWith(lower)).slice(0, 5);
        setArgSuggestions(matches);
        setArgAcIndex(0);
      } catch {
        if (!cancelled) setArgSuggestions([]);
      }
    }

    compute();
    return () => { cancelled = true; };
  }, [input, argAcDismissed]);

  const sendMessage = useCallback(async (msg: string) => {
    if (!msg) return;
    // Synchronous guard against double-send: setLoading is async so the `loading` check above
    // and `disabled={loading}` on the send button don't propagate before a second send in the
    // same tick. A rapid Enter-Enter would otherwise post two user messages and fire two
    // command executions (duplicate MCP / slash-command side effects).
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const userMsg: Message = {
        id: genId(),
        role: "user",
        content: msg,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      let replyContent: string;

      if (isSlashCommand(msg)) {
        const parsed = parseCommand(msg);
        if (parsed) {
          try {
            const result = await execute(parsed);
            replyContent = result.ok ? result.text : result.error;
          } catch (err: unknown) {
            replyContent = err instanceof Error ? err.message : "Command failed.";
          }
        } else {
          replyContent = "Unknown command — type /help for the command list.";
        }
      } else {
        replyContent = "Unknown command — type /help for the command list.";
      }

      const assistantMsg: Message = {
        id: genId(),
        role: "assistant",
        content: replyContent,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const handleSend = useCallback(async () => {
    await sendMessage(input.trim());
  }, [input, sendMessage]);

  function insertArgSuggestion(suggestion: string) {
    const v = input.trimStart();
    const spaceIdx = v.indexOf(" ");
    if (spaceIdx === -1) return;
    const prefix = v.slice(0, spaceIdx + 1);
    setInput(prefix + suggestion + " ");
    setArgSuggestions([]);
    setArgAcIndex(0);
    setArgAcDismissed(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (argSuggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setArgAcIndex((i) => Math.min(i + 1, argSuggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setArgAcIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab") { e.preventDefault(); insertArgSuggestion(argSuggestions[argAcIndex] ?? argSuggestions[0]); return; }
      if (e.key === "Escape") { e.preventDefault(); setArgAcDismissed(true); setArgSuggestions([]); return; }
    }
    if (acItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAcIndex((i) => Math.min(i + 1, acItems.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAcIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const chosen = acItems[acIndex];
        if (chosen) setInput(`/${chosen.name} `);
        setAcIndex(0);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setAcDismissed(true); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Chat"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[400px] bg-slate-900 border-l border-slate-800 shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-indigo-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Slash commands</p>
              <p className="text-xs text-slate-400">Type /help to see available commands</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="text-slate-400 hover:text-slate-100 h-9 w-9 flex items-center justify-center rounded-md transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <MessageList
          messages={messages}
          loading={loading}
        />

        <ChatInput
          input={input}
          loading={loading}
          acItems={acItems}
          acIndex={acIndex}
          argSuggestions={argSuggestions}
          argAcIndex={argAcIndex}
          open={open}
          onInputChange={(v) => { setInput(v); setAcDismissed(false); setAcIndex(0); setArgAcDismissed(false); }}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          onArgSuggestionClick={insertArgSuggestion}
          onCommandClick={(name) => { setInput(`/${name} `); setAcIndex(0); }}
          onAcDismissReset={() => setAcDismissed(false)}
          textareaRef={textareaRef}
        />
      </aside>
    </>
  );
}
