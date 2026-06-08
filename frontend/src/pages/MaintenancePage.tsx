import { useEffect, useState, startTransition } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Wrench } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { RecordMaintenanceDialog } from "../components/RecordMaintenanceDialog";
import { NewMaintenanceScheduleDialog } from "../components/NewMaintenanceScheduleDialog";
import { EditScheduleDialog } from "../components/EditScheduleDialog";
import { SnoozeScheduleDialog } from "../components/SnoozeScheduleDialog";
import { EmptyState } from "../components/EmptyState";
import { listAllActiveSchedules } from "../services/maintenance";
import { getSmtpStatus } from "../services/health";
import { useAuth } from "../context/AuthContext";
import { formatDateOnly, maintenanceStatus } from "../lib/utils";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import { MaintenanceStatusBadge } from "../components/MaintenanceStatusBadge";
import { KitTagList } from "../components/KitTagList";
import type { KitMaintenanceSchedule } from "../types";

type StatusFilter = "all" | "overdue" | "due-soon" | "ok";

const STATUS_VALUES: StatusFilter[] = ["all", "overdue", "due-soon", "ok"];

export function MaintenancePage() {
  const { user, canDecideRequests, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const rawStatus = searchParams.get("status") ?? "all";
  const statusFilter: StatusFilter = (STATUS_VALUES as string[]).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : "all";
  const typeFilter = searchParams.get("type") ?? "all";
  const [recordingSchedule, setRecordingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [snoozeSchedule, setSnoozeSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [smtpEnabled, setSmtpEnabled] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (!isAdmin) return;
    startTransition(() => {
      (async () => {
        try {
          const status = await getSmtpStatus();
          setSmtpEnabled(status.enabled);
        } catch (err: unknown) {
          if (!(err as { isAbort?: boolean })?.isAbort) console.error(err);
        }
      })();
    });
  }, [isAdmin]);

  if (authLoading) return null;
  if (!canDecideRequests) return <Navigate to="/dashboard" replace />;

  function setStatusFilter(next: StatusFilter) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "all") params.delete("status");
      else params.set("status", next);
      return params;
    });
  }

  function setTypeFilter(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "all") params.delete("type");
      else params.set("type", next);
      return params;
    });
  }

  const allTypes = Array.from(new Set(schedules.map((s) => s.type))).sort();

  const filtered = schedules.filter((s) => {
    const status = maintenanceStatus(s.next_due_at);
    const matchStatus = statusFilter === "all" || status === statusFilter;
    const matchType = typeFilter === "all" || s.type === typeFilter;
    return matchStatus && matchType;
  });

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 bg-background md:static -mx-4 px-4 py-2 md:mx-0 md:px-0 md:py-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Operations</p>
            <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Active maintenance schedules across all kits</p>
          </div>
          {isAdmin && (
            <Button size="sm" className="min-h-[44px]" onClick={() => setShowAddSchedule(true)}>
              <Plus className="h-4 w-4" />
              New schedule
            </Button>
          )}
        </div>
      </div>

      {isAdmin && smtpEnabled === false && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          SMTP not configured — maintenance reminder emails are disabled. Set SMTP_HOST + credentials via Fly secrets (see CLAUDE.md → Email notifications setup).
        </div>
      )}

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
              <option key={t} value={t}>{maintenanceTypeLabel(t)}</option>
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
          cta={statusFilter === "all" && typeFilter === "all" ? { label: "New schedule", onClick: () => setShowAddSchedule(true) } : undefined}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((sched) => {
              const status = maintenanceStatus(sched.next_due_at);
              return (
                <div
                  key={sched.id}
                  onClick={() => navigate(`/maintenance/${sched.id}`)}
                  className="rounded-lg border bg-card px-4 py-3 space-y-1.5 cursor-pointer hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold">{maintenanceTypeLabel(sched.type)}</span>
                      {sched.expand?.kit?.serial && (
                        <>
                          <span className="font-mono text-xs text-indigo-700">{sched.expand.kit.serial}</span>
                          <KitTagList tags={sched.expand.kit.tags} />
                        </>
                      )}
                      {!sched.kit && sched.component && (
                        <span className="font-mono text-xs text-indigo-700">{sched.expand?.component?.serial ?? sched.component} <span className="font-sans font-normal text-muted-foreground">(component)</span></span>
                      )}
                    </div>
                    <MaintenanceStatusBadge status={status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Last: {sched.last_done_at ? formatDateOnly(sched.last_done_at) : "—"}</span>
                    <span>Next: {sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRecordingSchedule(sched); }}
                      className="text-xs px-3 min-h-[44px] rounded border border-border hover:bg-slate-50 transition-colors"
                    >
                      Record done
                    </button>
                    {user?.role === "admin" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingSchedule(sched); }}
                        className="text-xs px-3 min-h-[44px] rounded border border-border hover:bg-slate-50 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSnoozeSchedule(sched); }}
                        className="text-xs px-3 min-h-[44px] rounded border border-border hover:bg-slate-50 transition-colors"
                      >
                        Snooze
                      </button>
                    )}
                  </div>
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
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Target</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Last done</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Next due</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sched) => {
                    const status = maintenanceStatus(sched.next_due_at);
                    return (
                      <tr key={sched.id} onClick={() => navigate(`/maintenance/${sched.id}`)} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer">
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono font-medium tracking-wide text-indigo-700">
                              {sched.expand?.kit?.serial ?? (sched.kit ? sched.kit : null) ?? (sched.expand?.component?.serial ? sched.expand.component.serial : sched.component ?? "—")}
                            </span>
                            {sched.expand?.kit?.tags && <KitTagList tags={sched.expand.kit.tags} />}
                            {sched.component && !sched.kit && (
                              <span className="font-sans font-normal text-muted-foreground">(component)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{maintenanceTypeLabel(sched.type)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {sched.last_done_at ? formatDateOnly(sched.last_done_at) : <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                            <MaintenanceStatusBadge status={status} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); setRecordingSchedule(sched); }}
                              className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap"
                            >
                              Record done
                            </button>
                            {user?.role === "admin" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingSchedule(sched); }}
                                className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap"
                              >
                                Edit
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSnoozeSchedule(sched); }}
                                className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap"
                              >
                                Snooze
                              </button>
                            )}
                          </div>
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

      <NewMaintenanceScheduleDialog
        open={showAddSchedule}
        onClose={() => setShowAddSchedule(false)}
        onSaved={() => { setShowAddSchedule(false); load(); }}
      />

      <EditScheduleDialog
        schedule={editingSchedule}
        onClose={() => setEditingSchedule(null)}
        onSaved={() => { setEditingSchedule(null); load(); }}
      />

      <SnoozeScheduleDialog
        schedule={snoozeSchedule}
        onClose={() => setSnoozeSchedule(null)}
        onSnoozed={() => { setSnoozeSchedule(null); load(); }}
      />
    </div>
  );
}

