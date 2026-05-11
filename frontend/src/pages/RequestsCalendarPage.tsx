import { useEffect, useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { listRequests } from "../services/requests";
import { formatDateOnly } from "../lib/utils";
import { Skeleton } from "../components/ui/skeleton";
import type { KitRequest, RequestStatus } from "../types";

const RANGE_OPTIONS = [30, 90] as const;
type Range = (typeof RANGE_OPTIONS)[number];

const FILTER_STATUSES = ["all", "open", "approved", "fulfilled"] as const;
type FilterStatus = (typeof FILTER_STATUSES)[number];

const STATUS_BG: Record<RequestStatus, string> = {
  open: "bg-indigo-500",
  approved: "bg-emerald-500",
  fulfilled: "bg-slate-400",
  rejected: "bg-red-500",
  cancelled: "bg-gray-300",
};

const STATUS_TEXT: Record<RequestStatus, string> = {
  open: "text-white",
  approved: "text-white",
  fulfilled: "text-white",
  rejected: "text-white line-through",
  cancelled: "text-gray-600 line-through",
};

function parseLocalDate(iso: string): Date {
  // PB returns "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS.SSSZ" — take date part only, create at local midnight
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayOffset(iso: string, today: Date): number {
  const target = parseLocalDate(iso);
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - todayLocal.getTime()) / (24 * 60 * 60 * 1000));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function RequestsCalendarPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>(30);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  async function load() {
    setLoading(true);
    try {
      setRequests(await listRequests());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: range }, (_, i) => addDays(today, i));

  const visible = requests.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    const start = dayOffset(r.delivery_date, today);
    if (start >= range) return false;
    const end = r.expected_return ? dayOffset(r.expected_return, today) : start;
    if (end < 0) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Calendar</p>
        <h1 className="text-2xl font-semibold tracking-tight">Requests Timeline</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upcoming delivery and return schedule</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border bg-white p-0.5">
          {FILTER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={[
                "px-3 py-1 text-xs font-medium rounded capitalize transition-colors",
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-white p-0.5">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "px-3 py-1 text-xs font-medium rounded transition-colors",
                range === r
                  ? "bg-indigo-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              Next {r}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground text-sm">No upcoming requests in this range.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          {/* Date header */}
          <div
            className="grid border-b"
            style={{
              gridTemplateColumns: `180px repeat(${range}, minmax(28px, 1fr))`,
            }}
          >
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-r">
              Request
            </div>
            {days.map((d, i) => (
              <div
                key={i}
                className={[
                  "py-2 text-center text-[9px] tabular-nums font-medium border-r last:border-r-0",
                  i === 0 ? "text-indigo-600 font-bold" : "text-muted-foreground",
                  // highlight week starts
                  d.getDay() === 1 ? "bg-slate-50" : "",
                ].join(" ")}
              >
                <div>{["Su","Mo","Tu","We","Th","Fr","Sa"][d.getDay()]}</div>
                <div>{d.getDate()}</div>
              </div>
            ))}
          </div>

          {/* Request rows */}
          {visible.map((r) => {
            const rawStart = dayOffset(r.delivery_date, today);
            const rawEnd = r.expected_return
              ? dayOffset(r.expected_return, today)
              : rawStart;

            const clampedStart = Math.max(0, rawStart);
            const clampedEnd = Math.min(range - 1, rawEnd);
            const colStart = clampedStart + 1; // 1-indexed for grid-column (offset by label col)
            const span = Math.max(1, clampedEnd - clampedStart + 1);

            const requester =
              r.expand?.requester?.name ?? r.expand?.requester?.email ?? "—";
            const kit = r.expand?.designated_kit?.serial ?? "—";
            const target = r.expand?.target_entity?.name ?? "—";

            const tooltipLines = [
              `Requester: ${requester}`,
              `Kit: ${kit}`,
              `Target: ${target}`,
              `Delivery: ${formatDateOnly(r.delivery_date)}`,
              r.expected_return ? `Return: ${formatDateOnly(r.expected_return)}` : null,
              `Status: ${r.status}`,
            ]
              .filter(Boolean)
              .join("\n");

            return (
              <div
                key={r.id}
                className="grid border-b last:border-b-0 hover:bg-slate-50/60 transition-colors"
                style={{
                  gridTemplateColumns: `180px repeat(${range}, minmax(28px, 1fr))`,
                }}
              >
                {/* Label column */}
                <div className="px-3 py-2 border-r truncate">
                  <p className="text-xs font-medium truncate">{requester}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{formatDateOnly(r.delivery_date)}</p>
                </div>

                {/* Bar column spanning the grid */}
                <div
                  className="py-1.5 relative"
                  style={{ gridColumn: `${colStart + 1} / span ${span}` }}
                >
                  <button
                    title={tooltipLines}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    className={[
                      "w-full h-5 rounded text-[10px] font-medium px-1.5 truncate cursor-pointer",
                      "hover:opacity-80 transition-opacity text-left",
                      STATUS_BG[r.status],
                      STATUS_TEXT[r.status],
                    ].join(" ")}
                    data-testid="calendar-bar"
                    data-request-id={r.id}
                  >
                    {kit !== "—" ? kit : requester}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
