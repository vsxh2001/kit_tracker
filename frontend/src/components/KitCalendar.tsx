import { useEffect, useState, startTransition } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { pb } from "../lib/pocketbase";
import type { Transaction, KitRequest } from "../types";
import { formatDate, formatDateOnly } from "../lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDow = firstDay.getDay();
  const cells: (Date | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── Event types ──────────────────────────────────────────────────────────────

type TxEvent = {
  kind: "tx";
  id: string;
  date: string;
  tx: Transaction;
};

type DeliveryEvent = {
  kind: "delivery";
  id: string;
  date: string;
  req: KitRequest;
};

type ReturnEvent = {
  kind: "return";
  id: string;
  date: string;
  req: KitRequest;
  overdue: boolean;
};

type CalEvent = TxEvent | DeliveryEvent | ReturnEvent;

function bucketEvents(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    if (!map.has(ev.date)) map.set(ev.date, []);
    map.get(ev.date)!.push(ev);
  }
  return map;
}

// ── Pill component ───────────────────────────────────────────────────────────

function Pill({ ev, onClick }: { ev: CalEvent; onClick: (ev: CalEvent) => void }) {
  if (ev.kind === "tx") {
    const to = ev.tx.expand?.to_entity?.name ?? ev.tx.to_entity.slice(0, 8);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(ev); }}
        className="w-full text-left truncate rounded-full bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[9px] font-semibold hover:bg-blue-200 transition-colors leading-tight"
        title={`Move → ${to}`}
      >
        → {to}
      </button>
    );
  }
  if (ev.kind === "delivery") {
    const target = ev.req.expand?.target_entity?.name ?? "—";
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(ev); }}
        className="w-full text-left truncate rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-semibold hover:bg-amber-200 transition-colors leading-tight"
        title={`Delivery → ${target}`}
      >
        📦 → {target}
      </button>
    );
  }
  // return
  const target = ev.req.expand?.target_entity?.name ?? "—";
  const cls = ev.req.status === "fulfilled"
    ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
    : ev.overdue
    ? "bg-red-100 text-red-800 hover:bg-red-200"
    : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(ev); }}
      className={`w-full text-left truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold transition-colors leading-tight ${cls}`}
      title={`Return from ${target}`}
    >
      ↩ {target}
    </button>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function EventDetail({ ev, onClose }: { ev: CalEvent; onClose: () => void }) {
  if (ev.kind === "tx") {
    const tx = ev.tx;
    const from = tx.expand?.from_entity?.name ?? "—";
    const to = tx.expand?.to_entity?.name ?? tx.to_entity.slice(0, 8);
    const actor = tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? "—";
    return (
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Move transaction</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{formatDate(tx.timestamp)}</p>
        <p className="text-sm">{from} → {to}</p>
        {tx.notes && <p className="text-xs text-muted-foreground italic">{tx.notes}</p>}
        <p className="text-[10px] text-muted-foreground">By: {actor}</p>
      </div>
    );
  }
  if (ev.kind === "delivery") {
    const req = ev.req;
    const requester = req.expand?.requester?.name ?? req.expand?.requester?.email ?? "—";
    const target = req.expand?.target_entity?.name ?? "—";
    return (
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Delivery request</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Delivery: {formatDateOnly(req.delivery_date)}</p>
        <p className="text-sm">→ {target}</p>
        <p className="text-xs text-muted-foreground">Requester: {requester}</p>
        <p className="text-xs capitalize text-muted-foreground">Status: {req.status}</p>
        {req.notes && <p className="text-xs text-muted-foreground italic">{req.notes}</p>}
      </div>
    );
  }
  // return
  const req = ev.req;
  const requester = req.expand?.requester?.name ?? req.expand?.requester?.email ?? "—";
  const target = req.expand?.target_entity?.name ?? "—";
  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Expected return{ev.overdue ? " (overdue)" : ""}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Return: {formatDateOnly(req.expected_return!)}</p>
      <p className="text-sm">from {target}</p>
      <p className="text-xs text-muted-foreground">Requester: {requester}</p>
      <p className="text-xs capitalize text-muted-foreground">Status: {req.status}</p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface KitCalendarProps {
  kitId: string;
}

export function KitCalendar({ kitId }: KitCalendarProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  async function load(y: number, m: number) {
    setLoading(true);
    const mk = `${y}-${String(m + 1).padStart(2, "0")}`;
    try {
      const [txs, reqs] = await Promise.all([
        pb.collection("transactions").getFullList<Transaction>({
          filter: pb.filter("kit = {:kit}", { kit: kitId }),
          sort: "-timestamp,-created",
          expand: "from_entity,to_entity,created_by",
          requestKey: `kit-cal-tx-${kitId}-${mk}`,
        }),
        pb.collection("requests").getFullList<KitRequest>({
          filter: pb.filter("designated_kit = {:kit}", { kit: kitId }),
          sort: "-delivery_date",
          expand: "requester,target_entity",
          requestKey: `kit-cal-req-${kitId}-${mk}`,
        }),
      ]);
      setTransactions(txs);
      setRequests(reqs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load(year, month)); }, [kitId, year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  // Build event list for current month view
  const todayStr = isoDate(now);
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = isoDate(new Date(year, month + 1, 0));

  const events: CalEvent[] = [];

  for (const tx of transactions) {
    const dateStr = (tx.timestamp || tx.created).slice(0, 10);
    if (dateStr >= monthStart && dateStr <= monthEnd) {
      events.push({ kind: "tx", id: `tx-${tx.id}`, date: dateStr, tx });
    }
  }

  for (const req of requests) {
    // Delivery events (open or approved)
    if (req.delivery_date && (req.status === "open" || req.status === "approved")) {
      const dateStr = req.delivery_date.slice(0, 10);
      if (dateStr >= monthStart && dateStr <= monthEnd) {
        events.push({ kind: "delivery", id: `del-${req.id}`, date: dateStr, req });
      }
    }
    // Return events (not rejected/cancelled, has expected_return)
    if (req.expected_return && req.status !== "rejected" && req.status !== "cancelled") {
      const dateStr = req.expected_return.slice(0, 10);
      if (dateStr >= monthStart && dateStr <= monthEnd) {
        const overdue = dateStr < todayStr && req.status !== "fulfilled";
        events.push({ kind: "return", id: `ret-${req.id}`, date: dateStr, req, overdue });
      }
    }
  }

  const bucket = bucketEvents(events);
  const cells = monthDays(year, month);

  const MAX_PILLS = 3;

  return (
    <div className="space-y-3">
      {/* Month nav */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
        <Button variant="outline" size="sm" onClick={nextMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium ml-1">{MONTH_NAMES[month]} {year}</span>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-200" />Move</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-200" />Delivery</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-200" />Return</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {/* Calendar grid — hidden on very small screens, shown as list fallback */}
          <div className="flex-1 rounded-lg border bg-white overflow-x-auto">
            {/* DOW header */}
            <div className="grid grid-cols-7 border-b min-w-[420px]">
              {DOW_LABELS.map((d) => (
                <div key={d} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0">
                  {d}
                </div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 min-w-[420px]">
              {cells.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="min-h-[80px] border-r border-b last:border-r-0 bg-slate-50/60" />;
                }
                const dayStr = isoDate(day);
                const isToday = dayStr === todayStr;
                const isSelected = dayStr === selectedDay;
                const dayEvents = bucket.get(dayStr) ?? [];
                const visible = dayEvents.slice(0, MAX_PILLS);
                const overflow = dayEvents.length - MAX_PILLS;
                return (
                  <div
                    key={dayStr}
                    onClick={() => {
                      setSelectedDay(isSelected ? null : dayStr);
                      setSelectedEvent(null);
                    }}
                    className={[
                      "min-h-[80px] border-r border-b last:border-r-0 p-1 flex flex-col gap-0.5 cursor-pointer transition-colors",
                      isSelected
                        ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300"
                        : isToday
                        ? "bg-indigo-50/70 hover:bg-indigo-100/50"
                        : "bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className={[
                      "text-[10px] font-medium self-end mb-0.5",
                      isToday
                        ? "bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]"
                        : "text-muted-foreground",
                    ].join(" ")}>
                      {day.getDate()}
                    </span>
                    {visible.map((ev) => (
                      <Pill key={ev.id} ev={ev} onClick={(e) => {
                        setSelectedDay(dayStr);
                        setSelectedEvent(e);
                      }} />
                    ))}
                    {overflow > 0 && (
                      <span className="text-[9px] text-muted-foreground pl-1">+{overflow} more</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side panel — event detail or day list */}
          {(selectedEvent || selectedDay) && (
            <div className="w-full md:w-72 rounded-lg border bg-white flex flex-col shrink-0">
              {selectedEvent ? (
                <EventDetail ev={selectedEvent} onClose={() => setSelectedEvent(null)} />
              ) : selectedDay ? (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                      <p className="text-sm font-semibold">{selectedDay}</p>
                      <p className="text-xs text-muted-foreground">
                        {(bucket.get(selectedDay) ?? []).length} event{(bucket.get(selectedDay) ?? []).length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button onClick={() => { setSelectedDay(null); setSelectedEvent(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y">
                    {(bucket.get(selectedDay) ?? []).length === 0 ? (
                      <p className="px-4 py-6 text-sm text-muted-foreground text-center">No events on this day.</p>
                    ) : (
                      (bucket.get(selectedDay) ?? []).map((ev) => (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
                        >
                          {ev.kind === "tx" && (
                            <p className="text-xs font-medium text-blue-700">Move → {ev.tx.expand?.to_entity?.name ?? "—"}</p>
                          )}
                          {ev.kind === "delivery" && (
                            <p className="text-xs font-medium text-amber-700">📦 Delivery → {ev.req.expand?.target_entity?.name ?? "—"}</p>
                          )}
                          {ev.kind === "return" && (
                            <p className={`text-xs font-medium ${ev.overdue ? "text-red-700" : ev.req.status === "fulfilled" ? "text-slate-500" : "text-emerald-700"}`}>
                              ↩ Return from {ev.req.expand?.target_entity?.name ?? "—"}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                            {ev.kind === "tx" ? formatDate((ev.tx.timestamp || ev.tx.created)) : `Status: ${ev.req.status}`}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Mobile vertical list fallback — shown only on xs when grid would overflow */}
      {!loading && events.length > 0 && (
        <div className="md:hidden mt-2">
          <p className="text-xs text-muted-foreground mb-2">Tip: scroll the grid above horizontally, or view the event list below.</p>
          <div className="space-y-2">
            {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((ev) => (
              <div key={ev.id} className="rounded-lg border bg-white px-3 py-2 text-xs">
                <span className="text-muted-foreground font-mono">{ev.date}</span>
                {ev.kind === "tx" && <p className="font-medium text-blue-700 mt-0.5">Move → {ev.tx.expand?.to_entity?.name ?? "—"}</p>}
                {ev.kind === "delivery" && <p className="font-medium text-amber-700 mt-0.5">📦 Delivery → {ev.req.expand?.target_entity?.name ?? "—"}</p>}
                {ev.kind === "return" && <p className={`font-medium mt-0.5 ${ev.overdue ? "text-red-700" : ev.req.status === "fulfilled" ? "text-slate-500" : "text-emerald-700"}`}>↩ Return from {ev.req.expand?.target_entity?.name ?? "—"}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && events.length === 0 && (
        <div key={monthKey} className="rounded-lg border bg-white flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">No events in {MONTH_NAMES[month]} {year}.</p>
        </div>
      )}
    </div>
  );
}
