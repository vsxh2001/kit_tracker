import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, ArrowRight, Wrench, Plus, Download } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { MoveKitDialog } from "../components/MoveKitDialog";
import { KitFormDialog } from "../components/KitFormDialog";
import { KitTimeline } from "../components/KitTimeline";
import { AddComponentDialog } from "../components/AddComponentDialog";
import { MoveComponentDialog } from "../components/MoveComponentDialog";
import { AddScheduleDialog } from "../components/AddScheduleDialog";
import { RecordMaintenanceDialog } from "../components/RecordMaintenanceDialog";
import { KitQR } from "../components/KitQR";
import { KitCalendar } from "../components/KitCalendar";
import { getKit, getKitHistory, softDeleteKit, uploadKitAttachment, deleteKitAttachment, exportKitTimelineCsv } from "../services/kits";
import { AttachmentList } from "../components/AttachmentList";
import { listComponentsInKit } from "../services/componentTransactions";
import { listSchedulesForKit, updateSchedule } from "../services/maintenance";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateOnly, maintenanceStatus } from "../lib/utils";
import type { MaintStatus } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import { CascadeDeleteDialog } from "../components/CascadeDeleteDialog";
import type { Kit, Transaction, Component, KitMaintenanceSchedule } from "../types";

export function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canTransferKits, canDecideRequests, isAdmin } = useAuth();
  const [kit, setKit] = useState<Kit | null>(null);
  const [latest, setLatest] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [components, setComponents] = useState<Component[]>([]);
  const [showAddComp, setShowAddComp] = useState(false);
  const [movingComponent, setMovingComponent] = useState<Component | null>(null);
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [showAddSched, setShowAddSched] = useState(false);
  const [recordingSchedule, setRecordingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [deactivatingSched, setDeactivatingSched] = useState<KitMaintenanceSchedule | null>(null);
  const [historyTab, setHistoryTab] = useState<"history" | "calendar">("history");
  const [showCascadeDelete, setShowCascadeDelete] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    let aborted = false;
    try {
      const [k, h, comps, scheds] = await Promise.all([
        getKit(id),
        getKitHistory(id),
        listComponentsInKit(id),
        listSchedulesForKit(id),
      ]);
      setKit(k);
      setHistory(h);
      setLatest(h[0] ?? null);
      setComponents(comps);
      setSchedules(scheds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.isAbort) { aborted = true; return; }
      console.error(err);
    } finally {
      if (!aborted) setLoading(false);
    }
  }

  async function handleDeactivateSchedule() {
    if (!deactivatingSched) return;
    try {
      await updateSchedule(deactivatingSched.id, { is_active: false });
      toast({ title: "Schedule deactivated", description: deactivatingSched.type, variant: "success" });
      setDeactivatingSched(null);
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate", description: err?.message, variant: "destructive" });
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  async function handleDelete() {
    if (!kit) return;
    try {
      await softDeleteKit(kit.id);
      toast({ title: "Kit deactivated", description: kit.serial, variant: "success" });
      navigate("/kits");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate kit", description: err?.message, variant: "destructive" });
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!kit) return <p>Kit not found.</p>;

  const currentEntity = latest?.expand?.to_entity;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/kits")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold font-mono tracking-wide">{kit.serial}</h1>
          {!kit.is_active && <Badge variant="destructive">Retired</Badge>}
        </div>
      </div>

      {/* Info card */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
              <div title="Scan to open this kit">
                <KitQR kitId={kit.id} size={96} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-0 text-sm pt-0">
            <Row label="Serial" value={kit.serial} mono />
            <Row label="Notes" value={kit.notes ?? "—"} />
            <Row label="Current location" value={currentEntity?.name ?? "Unknown"} />
            {latest && <Row label="Last moved" value={formatDate(latest.timestamp)} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {canTransferKits && (
              <Button size="sm" onClick={() => setShowMove(true)}>
                <ArrowRight className="h-4 w-4" />
                Move kit
              </Button>
            )}
            {canDecideRequests && (
              <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => exportKitTimelineCsv(kit.id, kit.serial)}>
              <Download className="h-4 w-4" />
              Export timeline
            </Button>
            {isAdmin && (
              <Button size="sm" variant="destructive" onClick={() => setShowDelete(true)}>
                Deactivate
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Location history timeline */}
      <KitTimeline kitId={kit.id} />

      {/* History / Calendar tab toggle */}
      <div>
        {/* Tab controls */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-1 rounded-md border bg-white p-0.5">
            <button
              onClick={() => setHistoryTab("history")}
              className={[
                "px-3 py-1 text-xs font-medium rounded transition-colors",
                historyTab === "history"
                  ? "bg-indigo-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              History
            </button>
            <button
              onClick={() => setHistoryTab("calendar")}
              className={[
                "px-3 py-1 text-xs font-medium rounded transition-colors",
                historyTab === "calendar"
                  ? "bg-indigo-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              Calendar
            </button>
          </div>
          {historyTab === "history" && (
            <span className="text-xs text-muted-foreground">{history.length} record{history.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {historyTab === "calendar" ? (
          <KitCalendar kitId={kit.id} kitIsActive={kit.is_active} />
        ) : (
          <>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions.</p>
            ) : (
              <>
              <div className="md:hidden space-y-2">
                {history.map((tx) => (
                  <div key={tx.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatDate(tx.timestamp)}</span>
                      <span className="text-xs text-muted-foreground">{tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? ""}</span>
                    </div>
                    <div className="text-sm font-medium">
                      {tx.expand?.from_entity?.name ?? "—"} → {tx.expand?.to_entity?.name ?? tx.to_entity}
                    </div>
                    {tx.notes && <p className="text-xs text-muted-foreground mt-0.5">{tx.notes}</p>}
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <Card className="overflow-hidden hidden md:block">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">From</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">To</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono text-xs tabular-nums">
                            {formatDate(tx.timestamp)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{tx.expand?.from_entity?.name ?? <span className="opacity-30">—</span>}</td>
                          <td className="px-4 py-3 font-medium">{tx.expand?.to_entity?.name ?? tx.to_entity}</td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[200px]"><span className="line-clamp-2">{tx.notes ?? <span className="opacity-30">—</span>}</span></td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? <span className="opacity-30">—</span>}
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
      </div>

      {/* Components in kit */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Components in kit</h2>
          <span className="text-xs text-muted-foreground">{components.length} component{components.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex gap-2 mb-3">
          {canDecideRequests && (
            <button
              onClick={() => setShowAddComp(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Add component
            </button>
          )}
          {!canDecideRequests && canTransferKits && (
            <button
              onClick={() => setShowAddComp(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-slate-50 transition-colors"
            >
              Move existing here
            </button>
          )}
        </div>
        {components.length === 0 ? (
          <p className="text-sm text-muted-foreground">No components in this kit.</p>
        ) : (
          <>
            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {components.map((comp) => (
                <div key={comp.id} className="rounded-lg border bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      {comp.expand?.product ? (
                        <Link to={`/products/${comp.expand.product.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                          {comp.expand.product.name}
                        </Link>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">—</span>
                      )}
                      {comp.serial && <span className="font-mono text-[11px] text-indigo-700 ml-2">{comp.serial}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {comp.is_bulk && <span className="text-xs text-muted-foreground">Qty: {comp.quantity}</span>}
                      {canTransferKits && (
                        <button
                          onClick={() => setMovingComponent(comp)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors"
                        >
                          Move
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Product / Type / Serial</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((comp) => (
                      <tr key={comp.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">
                          {comp.expand?.product ? (
                            <Link to={`/products/${comp.expand.product.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                              {comp.expand.product.name}
                            </Link>
                          ) : (
                            <div className="text-xs font-medium text-muted-foreground">—</div>
                          )}
                          {comp.serial && <div className="font-mono text-[11px] text-indigo-700 mt-0.5">{comp.serial}</div>}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-xs">{comp.quantity}</td>
                        <td className="px-4 py-3 text-right">
                          {canTransferKits && (
                            <button
                              onClick={() => setMovingComponent(comp)}
                              className="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors"
                            >
                              Move
                            </button>
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
      </div>

      {/* Maintenance schedules */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Maintenance</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</span>
            {canDecideRequests && (
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
            cta={canDecideRequests ? { label: "Add schedule", onClick: () => setShowAddSched(true) } : undefined}
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
                      <span className="text-xs font-semibold">{sched.type}</span>
                      <MaintStatusPill status={status} />
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
                      {canDecideRequests && (
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
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Description</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Interval</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Last done</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Next due</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((sched) => {
                      const status = maintenanceStatus(sched.next_due_at);
                      return (
                        <tr key={sched.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-medium text-xs">{sched.type}</td>
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
                              <MaintStatusPill status={status} />
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
                              {canDecideRequests && (
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
      </div>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attachments</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <AttachmentList
            kit={kit}
            canEdit={canDecideRequests}
            onUpload={canDecideRequests ? async (file) => {
              try {
                const updated = await uploadKitAttachment(kit.id, file);
                setKit(updated);
                toast({ title: "File uploaded", description: file.name, variant: "success" });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } catch (err: any) {
                toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
              }
            } : undefined}
            onDelete={canDecideRequests ? async (filename) => {
              try {
                const updated = await deleteKitAttachment(kit.id, filename);
                setKit(updated);
                toast({ title: "Attachment deleted", description: filename, variant: "success" });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } catch (err: any) {
                toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
              }
            } : undefined}
          />
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              Hard-delete this kit and all dependent rows. Last-resort tool to fix history.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowCascadeDelete(true)}
            >
              Cascade Hard Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <MoveKitDialog
        kit={kit}
        currentEntityId={currentEntity?.id}
        currentEntityName={currentEntity?.name}
        open={showMove}
        onClose={() => setShowMove(false)}
        onMoved={load}
      />
      <KitFormDialog
        kit={kit}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={load}
      />

      <AddComponentDialog
        open={showAddComp}
        onClose={() => setShowAddComp(false)}
        targetKit={kit.id}
        onSuccess={load}
      />
      {movingComponent && (
        <MoveComponentDialog
          component={movingComponent}
          open={!!movingComponent}
          onClose={() => setMovingComponent(null)}
          onSuccess={() => { setMovingComponent(null); load(); }}
        />
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate kit?</AlertDialogTitle>
            <AlertDialogDescription>
              Kit <strong>{kit.serial}</strong> will be hidden from the catalog. Historical transactions remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivatingSched} onOpenChange={(v) => !v && setDeactivatingSched(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deactivatingSched?.type}" will be removed from active maintenance tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeactivateSchedule}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showAddSched && kit && (
        <AddScheduleDialog
          kitId={kit.id}
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

      <CascadeDeleteDialog
        open={showCascadeDelete}
        onOpenChange={setShowCascadeDelete}
        collection="kits"
        recordId={kit.id}
        onDeleted={() => {
          navigate("/kits");
          toast({ title: "Kit deleted with cascade", variant: "success" });
        }}
      />
    </div>
  );
}

function MaintStatusPill({ status }: { status: MaintStatus }) {
  if (status === "overdue") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">Overdue</span>;
  if (status === "due-soon") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">Due soon</span>;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">OK</span>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className={`text-sm text-right break-all ${mono ? "font-mono text-xs tracking-wide text-indigo-700" : ""}`}>{value}</p>
    </div>
  );
}
