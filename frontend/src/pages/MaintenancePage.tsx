import { useEffect, useState, startTransition } from "react";
import { Navigate } from "react-router-dom";
import { Plus, Wrench } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { RecordMaintenanceDialog } from "../components/RecordMaintenanceDialog";
import { AddScheduleDialog } from "../components/AddScheduleDialog";
import { EmptyState } from "../components/EmptyState";
import { listAllActiveSchedules } from "../services/maintenance";
import { useAuth } from "../context/AuthContext";
import { formatDateOnly, maintenanceStatus } from "../lib/utils";
import type { MaintStatus } from "../lib/utils";
import type { KitMaintenanceSchedule } from "../types";

type StatusFilter = "all" | "overdue" | "due-soon" | "ok";

export function MaintenancePage() {
  const { canDecideRequests, loading: authLoading } = useAuth();
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [recordingSchedule, setRecordingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [showAddSchedule, setShowAddSchedule] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setSchedules(await listAllActiveSchedules());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  if (authLoading) return null;
  if (!canDecideRequests) return <Navigate to="/dashboard" replace />;

  const allTypes = Array.from(new Set(schedules.map((s) => s.type))).sort();

  const filtered = schedules.filter((s) => {
    const status = maintenanceStatus(s.next_due_at);
    const matchStatus = statusFilter === "all" || status === statusFilter;
    const matchType = typeFilter === "all" || s.type === typeFilter;
    return matchStatus && matchType;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Operations</p>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Active maintenance schedules across all kits</p>
        </div>
        <Button size="sm" onClick={() => setShowAddSchedule(true)}>
          <Plus className="h-4 w-4" />
          New schedule
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "overdue", "due-soon", "ok"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {s === "all" ? "All" : s === "overdue" ? "Overdue" : s === "due-soon" ? "Due soon" : "OK"}
            </button>
          ))}
        </div>
        {allTypes.length > 0 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All types</option>
            {allTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Wrench}
          heading="No maintenance schedules"
          body={statusFilter !== "all" || typeFilter !== "all" ? "No schedules match the current filters." : "No active maintenance schedules found."}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((sched) => {
              const status = maintenanceStatus(sched.next_due_at);
              return (
                <div key={sched.id} className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold">{sched.type}</span>
                      {sched.expand?.kit?.serial && (
                        <span className="font-mono text-[11px] text-indigo-700 ml-2">{sched.expand.kit.serial}</span>
                      )}
                    </div>
                    <MaintStatusPill status={status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Last: {sched.last_done_at ? formatDateOnly(sched.last_done_at) : "—"}</span>
                    <span>Next: {sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                  </div>
                  <button
                    onClick={() => setRecordingSchedule(sched)}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors"
                  >
                    Record done
                  </button>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card className="overflow-hidden hidden md:block">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Kit serial</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Last done</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Next due</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sched) => {
                    const status = maintenanceStatus(sched.next_due_at);
                    return (
                      <tr key={sched.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-xs tracking-wide text-indigo-700">
                          {sched.expand?.kit?.serial ?? sched.kit}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{sched.type}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {sched.last_done_at ? formatDateOnly(sched.last_done_at) : <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                            <MaintStatusPill status={status} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setRecordingSchedule(sched)}
                            className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap"
                          >
                            Record done
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {recordingSchedule && (
        <RecordMaintenanceDialog
          schedule={recordingSchedule}
          open={!!recordingSchedule}
          onClose={() => setRecordingSchedule(null)}
          onRecorded={() => { setRecordingSchedule(null); load(); }}
        />
      )}

      <AddScheduleDialog
        open={showAddSchedule}
        onClose={() => setShowAddSchedule(false)}
        onSaved={() => { setShowAddSchedule(false); load(); }}
      />
    </div>
  );
}

function MaintStatusPill({ status }: { status: MaintStatus }) {
  if (status === "overdue") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">Overdue</span>;
  if (status === "due-soon") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">Due soon</span>;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">OK</span>;
}
