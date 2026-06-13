import { useEffect, useRef, useState, startTransition } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Wrench } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { RecordMaintenanceDialog } from "../components/RecordMaintenanceDialog";
import { EditScheduleDialog } from "../components/EditScheduleDialog";
import { SnoozeScheduleDialog } from "../components/SnoozeScheduleDialog";
import { EmptyState } from "../components/EmptyState";
import { getSchedule, listRecordsForSchedule, updateSchedule } from "../services/maintenance";
import { baseUrl } from "../services/admin";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateOnly, maintenanceStatus } from "../lib/utils";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import { toast } from "../components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { MaintenanceStatusBadge } from "../components/MaintenanceStatusBadge";
import { KitTagList } from "../components/KitTagList";
import { RetiredBadge } from "../components/RetiredBadge";
import type { MaintStatus } from "../lib/utils";
import type { KitMaintenanceSchedule, MaintenanceRecord } from "../types";

export function ScheduleDetailPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const { user, canDecideRequests } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [schedule, setSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const deactivatingRef = useRef(false);

  async function load() {
    if (!scheduleId) return;
    setLoading(true);
    try {
      const [sched, recs] = await Promise.all([
        getSchedule(scheduleId),
        listRecordsForSchedule(scheduleId),
      ]);
      setSchedule(sched);
      setRecords(recs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [scheduleId]);

  async function handleDeactivate() {
    if (!schedule) return;
    // Synchronous guard against double-click: setConfirmDeactivateOpen(false) only fires after
    // the React commit, so a second click in the same tick would re-enter updateSchedule and
    // double the PATCH (2 schedule updates + 2 toasts + 2 audit rows).
    if (deactivatingRef.current) return;
    deactivatingRef.current = true;
    try {
      await updateSchedule(schedule.id, { is_active: false });
      toast({ title: "Schedule deactivated", description: maintenanceTypeLabel(schedule.type), variant: "success" });
      navigate("/maintenance");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate", description: err?.message, variant: "destructive" });
    } finally {
      deactivatingRef.current = false;
    }
  }

  const status: MaintStatus = schedule ? maintenanceStatus(schedule.next_due_at) : "ok";

  return (
    <div className="space-y-5">
      <Link
        to="/maintenance"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Maintenance
      </Link>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !schedule ? (
        <p className="text-sm text-muted-foreground">Schedule not found.</p>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Maintenance</p>
              <h1 className="text-2xl font-semibold tracking-tight">{maintenanceTypeLabel(schedule.type)}</h1>
              {schedule.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{schedule.description}</p>
              )}
            </div>
            {user?.role === "admin" && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditingOpen(true)}>
                  Edit
                </Button>
                <AlertDialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="min-h-[44px]">
                      Deactivate
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deactivate this schedule?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The schedule will be marked inactive and will stop generating reminders. Past records remain accessible. You can re-create a fresh schedule any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleDeactivate}>Deactivate</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          {/* Meta row */}
          <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                {schedule.kit ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Kit</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {schedule.expand?.kit ? (
                        <Link
                          to={`/kits/${schedule.kit}`}
                          className="font-mono font-medium text-indigo-700 hover:underline"
                        >
                          {schedule.expand.kit.serial}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{schedule.kit}</span>
                      )}
                      {schedule.expand?.kit && <RetiredBadge isActive={schedule.expand.kit.is_active} />}
                      <KitTagList tags={schedule.expand?.kit?.tags} />
                    </div>
                  </>
                ) : schedule.component ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Component</p>
                    <Link
                      to={`/components/${schedule.component}`}
                      className="font-mono font-medium text-indigo-700 hover:underline"
                    >
                      {schedule.expand?.component?.serial ?? schedule.component}
                    </Link>
                    {schedule.expand?.component?.expand?.product?.name && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {schedule.expand.component.expand.product.name}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Interval</p>
                <span>{schedule.interval_days} days</span>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Last done</p>
                <span>{schedule.last_done_at ? formatDateOnly(schedule.last_done_at) : <span className="opacity-40">—</span>}</span>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Next due</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{schedule.next_due_at ? formatDateOnly(schedule.next_due_at) : "—"}</span>
                  <MaintenanceStatusBadge status={status} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* History */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">History</h2>
            <div className="flex gap-2">
              {isAdmin && (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setSnoozeOpen(true)}>
                  Snooze
                </Button>
              )}
              {canDecideRequests && (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setRecordingOpen(true)}>
                  Record done
                </Button>
              )}
            </div>
          </div>

          {records.length === 0 ? (
            <EmptyState
              icon={Wrench}
              heading="No maintenance recorded yet"
              body={canDecideRequests ? "Use the button above to record the first maintenance event." : "No maintenance events have been recorded for this schedule."}
            />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {records.map((rec) => (
                  <div key={rec.id} className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{formatDate(rec.performed_at)}</span>
                      {rec.certificate ? (
                        <a
                          href={`${baseUrl()}/api/files/maintenance_records/${rec.id}/${rec.certificate}`}
                          download
                          className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground opacity-40">—</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      By: {rec.expand?.performed_by?.name ?? rec.performed_by}
                    </p>
                    {rec.notes && <p className="text-xs text-muted-foreground">{rec.notes}</p>}
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <Card className="overflow-hidden hidden md:block">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Performed at</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">By</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Notes</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Certificate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((rec) => (
                        <tr key={rec.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(rec.performed_at)}</td>
                          <td className="px-4 py-3 text-xs">
                            {rec.expand?.performed_by?.name ?? rec.performed_by}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {rec.notes || <span className="opacity-40">—</span>}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {rec.certificate ? (
                              <a
                                href={`${baseUrl()}/api/files/maintenance_records/${rec.id}/${rec.certificate}`}
                                download
                                className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                              >
                                <Download className="h-3 w-3" />
                                Download
                              </a>
                            ) : (
                              <span className="opacity-40">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {schedule && recordingOpen && (
        <RecordMaintenanceDialog
          schedule={schedule}
          open={recordingOpen}
          onClose={() => setRecordingOpen(false)}
          onRecorded={() => { setRecordingOpen(false); load(); }}
        />
      )}

      {editingOpen && (
        <EditScheduleDialog
          schedule={schedule}
          onClose={() => setEditingOpen(false)}
          onSaved={() => { setEditingOpen(false); load(); }}
        />
      )}

      <SnoozeScheduleDialog
        schedule={snoozeOpen ? schedule : null}
        onClose={() => setSnoozeOpen(false)}
        onSnoozed={() => { setSnoozeOpen(false); load(); }}
      />
    </div>
  );
}

