import { useEffect, useState, startTransition } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { pb } from "../lib/pocketbase";
import type { Transaction } from "../types";

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

// Group transactions by local date string "YYYY-MM-DD"
function bucketByDay(txs: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    // timestamp or created — use timestamp (local date part)
    const ts = tx.timestamp || tx.created;
    const dayStr = ts.slice(0, 10);
    if (!map.has(dayStr)) map.set(dayStr, []);
    map.get(dayStr)!.push(tx);
  }
  return map;
}

export function KitHistoryCalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [serialFilter, setSerialFilter] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  async function load(y: number, m: number) {
    setLoading(true);
    try {
      // Fetch full month + 1 day buffer on each side
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 1, 1);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();
      const txs = await pb.collection("transactions").getFullList<Transaction>({
        filter: `timestamp >= "${fromStr}" && timestamp < "${toStr}"`,
        sort: "timestamp,created",
        expand: "kit,from_entity,to_entity,created_by",
        requestKey: `kit-history-cal-${y}-${m}`,
      });
      setTransactions(txs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load(year, month)); }, [year, month]);

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

  const filtered = serialFilter.trim()
    ? transactions.filter((tx) =>
        tx.expand?.kit?.serial?.toLowerCase().includes(serialFilter.trim().toLowerCase())
      )
    : transactions;

  const bucket = bucketByDay(filtered);
  const cells = monthDays(year, month);
  const todayStr = isoDate(now);

  const selectedTxs = selectedDay ? (bucket.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Kits</p>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Calendar</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaction counts per day — click a cell to see details</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday}>
          Today
        </Button>
        <Button variant="outline" size="sm" onClick={nextMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium ml-1">
          {MONTH_NAMES[month]} {year}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            placeholder="Filter by serial…"
            value={serialFilter}
            onChange={(e) => setSerialFilter(e.target.value)}
            className="h-8 w-40 text-sm"
          />
          {serialFilter && (
            <button
              onClick={() => setSerialFilter("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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
          {/* Calendar grid */}
          <div className="flex-1 rounded-lg border bg-white overflow-x-auto">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b min-w-[420px]">
              {DOW_LABELS.map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 min-w-[420px]">
              {cells.map((day, idx) => {
                if (!day) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="min-h-[72px] border-r border-b last:border-r-0 bg-slate-50/60"
                    />
                  );
                }
                const dayStr = isoDate(day);
                const isToday = dayStr === todayStr;
                const isSelected = dayStr === selectedDay;
                const count = bucket.get(dayStr)?.length ?? 0;
                return (
                  <button
                    key={dayStr}
                    onClick={() => setSelectedDay(isSelected ? null : dayStr)}
                    className={[
                      "min-h-[72px] border-r border-b last:border-r-0 p-1.5 flex flex-col items-start gap-1 text-left transition-colors",
                      isSelected
                        ? "bg-indigo-100 ring-1 ring-inset ring-indigo-400"
                        : isToday
                        ? "bg-indigo-50 hover:bg-indigo-100/70"
                        : "bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "text-xs font-medium self-end",
                        isToday
                          ? "bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]"
                          : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {day.getDate()}
                    </span>
                    {count > 0 && (
                      <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold">
                        {count} {count === 1 ? "move" : "moves"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day detail panel */}
          {selectedDay && (
            <div className="w-full md:w-80 rounded-lg border bg-white flex flex-col shrink-0">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div>
                  <p className="text-sm font-semibold">{selectedDay}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTxs.length} transaction{selectedTxs.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y">
                {selectedTxs.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground text-center">No transactions on this day.</p>
                ) : (
                  selectedTxs.map((tx) => {
                    const kit = tx.expand?.kit?.serial ?? tx.kit.slice(0, 8);
                    const from = tx.expand?.from_entity?.name ?? "—";
                    const to = tx.expand?.to_entity?.name ?? tx.to_entity.slice(0, 8);
                    const actor = tx.expand?.created_by?.email ?? tx.created_by.slice(0, 8);
                    return (
                      <div key={tx.id} className="px-4 py-3 space-y-0.5">
                        <p className="text-sm font-medium">{kit}</p>
                        <p className="text-xs text-muted-foreground">
                          {from} → {to}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{actor}</p>
                        {tx.notes && (
                          <p className="text-[10px] text-muted-foreground italic truncate">{tx.notes}</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
