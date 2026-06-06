import { useEffect, useState, startTransition } from "react";
import { Plus, Wrench } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { AddScheduleDialog } from "../AddScheduleDialog";
import { RecordMaintenanceDialog } from "../RecordMaintenanceDialog";
import { EmptyState } from "../EmptyState";
import { listSchedulesForKit, updateSchedule } from "../../services/maintenance";
import { useAuth } from "../../context/AuthContext";
import { formatDateOnly, maintenanceStatus } from "../../lib/utils";
import { maintenanceTypeLabel } from "../../lib/maintenance-types";
import { MaintenanceStatusBadge } from "../MaintenanceStatusBadge";
import { toast } from "../ui/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";
import type { KitMaintenanceSchedule } from "../../types";

interface MaintenanceSectionProps {
  kitId: string;
  canEdit: boolean;
}

export function MaintenanceSection({ kitId, canEdit }: MaintenanceSectionProps) {
  const { canTransferKits } = useAuth();
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [showAddSched, setShowAddSched] = useState(false);
  const [recordingSchedule, setRecordingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [deactivatingSched, setDeactivatingSched] = useState<KitMaintenanceSchedule | null>(null);

  async function load() {
    setSchedules([]);
    try {
      const scheds = await listSchedulesForKit(kitId);
      setSchedules(scheds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [kitId]);

  async function handleDeactivateSchedule() {
    if (!deactivatingSched) return;
    try {
      await updateSchedule(deactivatingSched.id, { is_active: false });
      toast({ title: "Schedule deactivated", description: maintenanceTypeLabel(deactivatingSched.type), variant: "success" });
      setDeactivatingSched(null);
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold tracking-tight">Maintenance</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</span>
          {canEdit && (
            <button
              onClick={() => setShowAddSched(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add schedule
            </button>
          )}
        </div>
      </div>
      {schedules.length === 0 ? (
        <EmptyState
          icon={Wrench}
          heading="No maintenance schedules"
          body="Track recurring maintenance by adding a schedule."
          cta={canEdit ? { label: "Add schedule", onClick: () => setShowAddSched(true) } : undefined}
        />
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-2">
            {schedules.map((sched) => {
              const status = maintenanceStatus(sched.next_due_at);
              return (
                <div key={sched.id} className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{maintenanceTypeLabel(sched.type)}</span>
                    <MaintenanceStatusBadge status={status} />
                  </div>
                  {sched.description && <p className="text-xs text-muted-foreground">{sched.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Every {sched.interval_days}d</span>
                    <span>Last: {sched.last_done_at ? formatDateOnly(sched.last_done_at) : "—"}</span>
                    <span>Next: {sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {canTransferKits && (
                      <button
                        onClick={() => setRecordingSchedule(sched)}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors"
                      >
                        Record done
                      </button>
                    )}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => setShowAddSched(true)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeactivatingSched(sched)}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          Deactivate
                        </button>
                      </>
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
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Description</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Interval</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Last done</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Next due</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((sched) => {
                    const status = maintenanceStatus(sched.next_due_at);
                    return (
                      <tr key={sched.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-xs">{maintenanceTypeLabel(sched.type)}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px]">
                          <span className="line-clamp-2">{sched.description || <span className="opacity-30">—</span>}</span>
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums">{sched.interval_days}d</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {sched.last_done_at ? formatDateOnly(sched.last_done_at) : <span className="opacity-30">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{sched.next_due_at ? formatDateOnly(sched.next_due_at) : "—"}</span>
                            <MaintenanceStatusBadge status={status} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            {canTransferKits && (
                              <button
                                onClick={() => setRecordingSchedule(sched)}
                                className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap"
                              >
                                Record done
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  onClick={() => setDeactivatingSched(sched)}
                                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  Deactivate
                                </button>
                              </>
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

      <AlertDialog open={!!deactivatingSched} onOpenChange={(v) => !v && setDeactivatingSched(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deactivatingSched ? maintenanceTypeLabel(deactivatingSched.type) : ""}" will be removed from active maintenance tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeactivateSchedule}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showAddSched && (
        <AddScheduleDialog
          kitId={kitId}
          open={showAddSched}
          onClose={() => setShowAddSched(false)}
          onSaved={load}
        />
      )}

      {recordingSchedule && (
        <RecordMaintenanceDialog
          schedule={recordingSchedule}
          open={!!recordingSchedule}
          onClose={() => setRecordingSchedule(null)}
          onRecorded={() => { setRecordingSchedule(null); load(); }}
        />
      )}
    </div>
  );
}

