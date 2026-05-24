import { useEffect, useState, startTransition, useRef } from "react";
import { MessageCircle, Search, ChevronLeft, Send, AlertTriangle, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { Textarea } from "../components/ui/textarea";
import { listWhatsAppMessages, sendWhatsAppMessage } from "../services/whatsapp";
import { formatDate } from "../lib/utils";
import { cn } from "../lib/utils";
import { useToast } from "../components/ui/use-toast";
import type { WhatsAppMessage } from "../services/whatsapp";

// Relative time — e.g. "2 h ago", "just now"
function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

function eventLabel(msg: WhatsAppMessage): string {
  if (msg.direction === "inbound") return msg.body ? msg.body.slice(0, 60) : "Inbound message";
  if (msg.event === "request_fulfilled") return "Request fulfilled";
  if (msg.event === "kit_moved") return "Kit moved";
  if (msg.event) return msg.event;
  if (msg.templateName) return `Template: ${msg.templateName}`;
  if (msg.mode === "text") return "Manual text";
  return "Message sent";
}

// Return the phone for a message regardless of direction
function msgPhone(msg: WhatsAppMessage): string {
  return msg.direction === "inbound" ? (msg.from ?? "") : (msg.to ?? "");
}

interface PhoneThread {
  phone: string;
  lastMessage: WhatsAppMessage;
  count: number;
}

// Group flat message list by phone, sorted by most-recent
function groupByPhone(messages: WhatsAppMessage[]): PhoneThread[] {
  const map = new Map<string, { lastMessage: WhatsAppMessage; count: number }>();
  for (const msg of messages) {
    const phone = msgPhone(msg);
    if (!phone) continue;
    const existing = map.get(phone);
    if (!existing || new Date(msg.created) > new Date(existing.lastMessage.created)) {
      map.set(phone, { lastMessage: msg, count: (existing?.count ?? 0) + 1 });
    } else {
      map.set(phone, { ...existing, count: existing.count + 1 });
    }
  }
  return Array.from(map.entries())
    .map(([phone, { lastMessage, count }]) => ({ phone, lastMessage, count }))
    .sort((a, b) => new Date(b.lastMessage.created).getTime() - new Date(a.lastMessage.created).getTime());
}

// Check whether the last INBOUND message from this phone is within 24h
function isWithin24hWindow(thread: WhatsAppMessage[]): boolean {
  const lastInbound = thread.find((m) => m.direction === "inbound");
  if (!lastInbound) return false;
  const age = Date.now() - new Date(lastInbound.created).getTime();
  return age < 24 * 60 * 60 * 1000;
}

// Check whether there is ANY inbound message from this phone
function hasEverInbound(thread: WhatsAppMessage[]): boolean {
  return thread.some((m) => m.direction === "inbound");
}

const PAGE_LIMIT = 50;

export function WhatsAppConversationsPage() {
  const { toast } = useToast();

  // Phone list state
  const [phoneThreads, setPhoneThreads] = useState<PhoneThread[]>([]);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selected phone thread state
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [thread, setThread] = useState<WhatsAppMessage[]>([]);
  const [threadTotal, setThreadTotal] = useState(0);
  const [threadPage, setThreadPage] = useState(1);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);

  // Composer state
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);

  // Scroll-to-bottom ref for thread
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  // Date range filter
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Load phone list — fetches all send_whatsapp + receive_whatsapp entries matching search/dates,
  // then groups client-side. Limit 500 for grouping purposes.
  async function loadPhones() {
    setPhoneLoading(true);
    try {
      const { items } = await listWhatsAppMessages({
        phone: committedSearch || undefined,
        limit: 500,
        offset: 0,
      });
      // Client-side date filter
      const filtered = items.filter((m) => {
        if (dateFrom && new Date(m.created) < new Date(dateFrom)) return false;
        if (dateTo && new Date(m.created) > new Date(dateTo + "T23:59:59")) return false;
        return true;
      });
      setPhoneThreads(groupByPhone(filtered));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setPhoneLoading(false);
    }
  }

  useEffect(() => {
    startTransition(() => loadPhones());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSearch, dateFrom, dateTo]);

  function handleSearchChange(value: string) {
    setPhoneSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setCommittedSearch(value);
    }, 400);
  }

  // Load thread for selected phone
  async function loadThread(phone: string, page: number) {
    if (page === 1) {
      setThreadLoading(true);
    } else {
      setThreadLoadingMore(true);
    }
    try {
      const { items, totalItems } = await listWhatsAppMessages({
        phone,
        limit: PAGE_LIMIT,
        offset: (page - 1) * PAGE_LIMIT,
      });
      setThreadTotal(totalItems);
      if (page === 1) {
        setThread(items);
      } else {
        setThread((prev) => [...prev, ...items]);
      }
      setThreadPage(page);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setThreadLoading(false);
      setThreadLoadingMore(false);
    }
  }

  function selectPhone(phone: string) {
    setSelectedPhone(phone);
    setThread([]);
    setThreadPage(1);
    setThreadTotal(0);
    setComposeText("");
    startTransition(() => loadThread(phone, 1));
  }

  function clearSelection() {
    setSelectedPhone(null);
    setThread([]);
  }

  // Scroll to bottom after thread loads
  useEffect(() => {
    if (!threadLoading && thread.length > 0) {
      threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadLoading, thread.length]);

  async function handleSend() {
    if (!selectedPhone || !composeText.trim() || sending) return;
    setSending(true);
    try {
      await sendWhatsAppMessage({ to: selectedPhone, text: composeText.trim() });
      setComposeText("");
      toast({ title: "Sent", description: "Message delivered to WhatsApp.", variant: "success" });
      // Refresh thread
      startTransition(() => loadThread(selectedPhone, 1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Send failed",
          description: err?.message ?? "Could not send message.",
          variant: "destructive",
        });
      }
    } finally {
      setSending(false);
    }
  }

  function handleComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const within24h = selectedPhone ? isWithin24hWindow(thread) : false;
  const everInbound = selectedPhone ? hasEverInbound(thread) : false;
  const show24hWarning = selectedPhone && !threadLoading && !within24h;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <MessageCircle className="h-6 w-6 text-emerald-500 shrink-0" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
            WhatsApp
          </p>
          <h1 className="text-xl font-semibold tracking-tight">Conversation Log</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search phone number…"
            value={phoneSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear dates
          </button>
        )}
      </div>

      {/* Two-column layout on desktop, stacked on mobile */}
      <div className="flex gap-4 min-h-[500px]">
        {/* LEFT: phone list */}
        <div className={cn(
          "flex flex-col gap-0 border border-border rounded-lg overflow-hidden bg-card",
          selectedPhone ? "hidden md:flex md:w-80 shrink-0" : "w-full md:w-80 shrink-0"
        )}>
          {phoneLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1 px-2 py-2 rounded-md">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              ))}
            </div>
          ) : phoneThreads.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                icon={MessageCircle}
                heading="No conversations"
                body="No WhatsApp messages recorded yet."
              />
            </div>
          ) : (
            <div className="overflow-y-auto divide-y divide-border">
              {phoneThreads.map((pt) => (
                <button
                  key={pt.phone}
                  onClick={() => selectPhone(pt.phone)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors",
                    selectedPhone === pt.phone && "bg-indigo-50 border-l-2 border-indigo-500"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium truncate">{pt.phone}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {eventLabel(pt.lastMessage)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground whitespace-nowrap">
                        {relativeTime(pt.lastMessage.created)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {pt.count} msg{pt.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: thread panel */}
        <div className={cn(
          "flex-1 flex flex-col gap-3",
          !selectedPhone && "hidden md:flex"
        )}>
          {!selectedPhone ? (
            <div className="flex-1 flex items-center justify-center border border-border rounded-lg bg-card">
              <p className="text-sm text-muted-foreground">Select a phone number to view its messages.</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-2">
                <button
                  onClick={clearSelection}
                  className="md:hidden p-1.5 rounded hover:bg-slate-100 text-muted-foreground"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Thread</p>
                  <p className="text-sm font-mono font-semibold">{selectedPhone}</p>
                </div>
                {!threadLoading && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {thread.length} of {threadTotal}
                  </span>
                )}
              </div>

              {/* 24h window warning */}
              {show24hWarning && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    {everInbound
                      ? "Last inbound message is older than 24 h. Meta only allows free-form replies within a 24 h customer-service window — this message may be blocked."
                      : "No inbound messages from this number. Meta only allows free-form messages within a 24 h reply window after the user messages first."}
                  </span>
                </div>
              )}

              {/* Thread messages */}
              {threadLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : thread.length === 0 ? (
                <div className="flex-1 flex items-center justify-center border border-border rounded-lg bg-card">
                  <p className="text-sm text-muted-foreground">No messages found.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 px-1">
                  {thread.length < threadTotal && (
                    <div className="flex justify-center pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startTransition(() => loadThread(selectedPhone, threadPage + 1))}
                        disabled={threadLoadingMore}
                      >
                        {threadLoadingMore && (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        )}
                        Load older
                      </Button>
                    </div>
                  )}

                  {/* Reverse so newest is at bottom */}
                  {[...thread].reverse().map((msg) => {
                    const isInbound = msg.direction === "inbound";
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex",
                          isInbound ? "justify-start" : "justify-end"
                        )}
                      >
                        <div className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                          isInbound
                            ? "bg-card border border-border rounded-tl-sm"
                            : "bg-indigo-600 text-white rounded-tr-sm"
                        )}>
                          {/* Direction indicator */}
                          <div className={cn(
                            "flex items-center gap-1 text-xs mb-1",
                            isInbound ? "text-muted-foreground" : "text-indigo-200"
                          )}>
                            {isInbound ? (
                              <ArrowDownLeft className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            <span>{isInbound ? (msg.contactName || "Customer") : "You"}</span>
                            <span className="ml-auto pl-3 whitespace-nowrap">
                              {formatDate(msg.created)}
                            </span>
                          </div>

                          {/* Message body */}
                          {isInbound && msg.body ? (
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                          ) : !isInbound ? (
                            <p className="whitespace-pre-wrap break-words">
                              {msg.templateName
                                ? `[Template: ${msg.templateName}]`
                                : eventLabel(msg)}
                            </p>
                          ) : (
                            <p className="italic text-muted-foreground">{eventLabel(msg)}</p>
                          )}

                          {/* Outbound status */}
                          {!isInbound && (
                            <div className={cn(
                              "text-xs mt-1",
                              msg.success ? "text-indigo-200" : "text-red-300"
                            )}>
                              {msg.success ? "delivered" : "failed"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={threadBottomRef} />
                </div>
              )}

              {/* Composer */}
              <div className="border border-border rounded-lg bg-card p-3 flex flex-col gap-2 shrink-0">
                <Textarea
                  placeholder={`Send a message to ${selectedPhone}… (Ctrl+Enter to send)`}
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={handleComposeKeyDown}
                  rows={3}
                  className="resize-none text-sm"
                  disabled={sending}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={!composeText.trim() || sending}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1.5" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
