import { useEffect, useState, startTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { AddShiftDialog } from "./AddShiftDialog";
import { listShifts } from "../services/oncall";
import type { OnCallShift } from "../types";

// 8-color palette hashed by user id
const USER_COLORS = [
  "bg-indigo-500 text-white",
  "bg-teal-500 text-white",
  "bg-amber-500 text-white",
  "bg-rose-500 text-white",
  "bg-violet-500 text-white",
  "bg-sky-500 text-white",
  "bg-emerald-500 text-white",
  "bg-orange-500 text-white",
];

function hashUserId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % USER_COLORS.length;
}

function userColor(userId: string): string {
  return USER_COLORS[hashUserId(userId)];
}

function userLabel(shift: OnCallShift): string {
  const u = shift.expand?.user;
  if (u?.name) return u.name.split(" ")[0];
  if (u?.email) return u.email.split("@")[0];
  return shift.user.slice(0, 6);
}

// Build array of Date objects for a given month
function monthDays(year: number, month: number): (Date | null)[] {
  // month is 0-based
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDow = firstDay.getDay(); // 0=Sun
  // pad start (Sunday-first grid)
  const cells: (Date | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push(new Date(year, month, d));
  }
  // pad end to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftsForDay(shifts: OnCallShift[], day: Date): OnCallShift[] {
  const dayStr = isoDate(day);
  return shifts.filter((s) => {
    // compare date parts only
    const start = s.start_at.slice(0, 10);
    const end = s.end_at.slice(0, 10);
    return start <= dayStr && dayStr <= end;
  });
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  canDecideRequests: boolean;
}

export function OnCallCalendar({ canDecideRequests }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [shifts, setShifts] = useState<OnCallShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShift, setEditShift] = useState<OnCallShift | null>(null);

  async function load() {
    setLoading(true);
    try {
      setShifts(await listShifts({ includeInactive: false, limit: 500, sort: "start_at" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

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

  const cells = monthDays(year, month);
  const todayStr = isoDate(now);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const nowShifts = isCurrentMonth ? shiftsForDay(shifts, now) : [];
  const nowLabel = nowShifts.length > 0
    ? nowShifts.map(userLabel).join(", ")
    : null;

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* On-call now caption */}
      <p className="text-sm text-muted-foreground">
        {nowLabel
          ? <span>On call now: <span className="font-medium text-foreground">{nowLabel}</span></span>
          : "No one on call"}
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b">
            {DOW_LABELS.map((d) => (
              <div
                key={d}
                className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Week rows */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="min-h-[80px] border-r border-b last:border-r-0 bg-slate-50/60"
                  />
                );
              }
              const dayStr = isoDate(day);
              const isToday = dayStr === todayStr;
              const dayShifts = shiftsForDay(shifts, day);
              return (
                <div
                  key={dayStr}
                  className={[
                    "min-h-[80px] border-r border-b last:border-r-0 p-1 flex flex-col gap-0.5",
                    isToday ? "bg-indigo-50" : "bg-white hover:bg-slate-50/60",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-xs font-medium self-end px-1",
                      isToday
                        ? "bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] ring-2 ring-indigo-500 ring-offset-1"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {day.getDate()}
                  </span>
                  {dayShifts.map((s) => (
                    <button
                      key={s.id}
                      title={`${userLabel(s)} — ${s.start_at.slice(0, 10)} to ${s.end_at.slice(0, 10)}${s.notes ? "\n" + s.notes : ""}`}
                      onClick={() => canDecideRequests && setEditShift(s)}
                      className={[
                        "w-full text-left text-[10px] font-medium px-1.5 py-0.5 rounded truncate",
                        userColor(s.user),
                        canDecideRequests ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default",
                        isToday ? "shadow-md ring-1 ring-white" : "",
                      ].join(" ")}
                    >
                      {userLabel(s)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AddShiftDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => startTransition(() => load())}
      />

      <AddShiftDialog
        open={!!editShift}
        shift={editShift}
        onClose={() => setEditShift(null)}
        onSaved={() => startTransition(() => load())}
      />
    </div>
  );
}
