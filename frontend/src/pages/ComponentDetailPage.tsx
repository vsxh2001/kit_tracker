import { useEffect, useState, startTransition, type ReactNode } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Wrench } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { MoveComponentDialog } from "../components/MoveComponentDialog";
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
import { getComponent, updateComponent } from "../services/components";
import { listTransactionsForComponent } from "../services/componentTransactions";
import { listSchedulesForComponent, updateSchedule } from "../services/maintenance";
import { countComponentsForProduct, getOnHandForProduct } from "../services/products";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateOnly, maintenanceStatus, expiryStatus } from "../lib/utils";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import type { ExpiryStatus } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import { AddScheduleDialog } from "../components/AddScheduleDialog";
import { RecordMaintenanceDialog } from "../components/RecordMaintenanceDialog";
import { EmptyState } from "../components/EmptyState";
import { ConsumableBadge } from "../components/ConsumableBadge";
import { LowStockBadge } from "../components/LowStockBadge";
import { MaintenanceStatusBadge } from "../components/MaintenanceStatusBadge";
import { InactiveBadge } from "../components/InactiveBadge";
import { TrackedBadge } from "../components/TrackedBadge";
import { ExpiryBadge } from "../components/ExpiryBadge";
import { KitTagList } from "../components/KitTagList";
import { RetiredBadge } from "../components/RetiredBadge";
import type { Component, ComponentTransaction, KitMaintenanceSchedule } from "../types";

export function ComponentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canTransferKits, canDecideRequests, isAdmin } = useAuth();
  const [component, setComponent] = useState<Component | null>(null);
  const [history, setHistory] = useState<ComponentTransaction[]>([]);
  const [productInstanceCount, setProductInstanceCount] = useState<number | null>(null);
  const [productOnHand, setProductOnHand] = useState<number | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCascadeDelete, setShowCascadeDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editSerial, setEditSerial] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBinCode, setEditBinCode] = useState("");
  const [editLotCode, setEditLotCode] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [showAddSched, setShowAddSched] = useState(false);
  const [recordingSchedule, setRecordingSchedule] = useState<KitMaintenanceSchedule | null>(null);
  const [deactivatingSched, setDeactivatingSched] = useState<KitMaintenanceSchedule | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [c, h] = await Promise.all([
        getComponent(id),
        listTransactionsForComponent(id),
      ]);
      setComponent(c);
      setHistory(h);
      if (c.product) {
        countComponentsForProduct(c.product)
          .then(setProductInstanceCount)
          .catch(() => {});
        getOnHandForProduct(c.product, c.expand?.product?.is_serialized ?? true)
          .then(setProductOnHand)
          .catch(() => {});
      } else {
        setProductInstanceCount(null);
        setProductOnHand(null);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  async function loadSchedules() {
    if (!id) return;
    try {
      setSchedules(await listSchedulesForComponent(id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => loadSchedules()); }, [id]);

  async function handleDeactivateSchedule() {
    if (!deactivatingSched) return;
    try {
      await updateSchedule(deactivatingSched.id, { is_active: false });
      toast({ title: "Schedule deactivated", description: maintenanceTypeLabel(deactivatingSched.type), variant: "success" });
      setDeactivatingSched(null);
      loadSchedules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate", description: err?.message, variant: "destructive" });
    }
  }

  function openEdit() {
    if (!component) return;
    setEditSerial(component.serial);
    setEditNotes(component.notes);
    setEditBinCode(component.bin_code ?? "");
    setEditLotCode(component.lot_code ?? "");
    setEditExpiresAt(component.expires_at ? component.expires_at.slice(0, 10) : "");
    setEditError("");
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    if (!component) return;
    setEditSaving(true);
    try {
      await updateComponent(component.id, {
        serial: editSerial.trim(),
        notes: editNotes.trim(),
        bin_code: editBinCode.trim(),
        lot_code: editLotCode.trim(),
        expires_at: editExpiresAt || "",
      });
      toast({ title: "Component updated", variant: "success" });
      setShowEdit(false);
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setEditError(e?.message ?? "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!component) return;
    try {
      await updateComponent(component.id, { is_active: false });
      const label = component.serial || component.expand?.product?.name || component.product;
      toast({ title: "Component deactivated", description: label, variant: "success" });
      navigate("/components");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast({ title: "Failed to deactivate", description: e?.message, variant: "destructive" });
    }
  }

  function locationLabel(tx: ComponentTransaction): ReactNode {
    if (tx.expand?.to_kit) return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Kit: {tx.expand.to_kit.serial}</span>
        <RetiredBadge isActive={tx.expand.to_kit.is_active} />
        <KitTagList tags={tx.expand.to_kit.tags} />
      </span>
    );
    if (tx.expand?.to_entity) return `Entity: ${tx.expand.to_entity.name}`;
    if (tx.to_kit) return `Kit: ${tx.to_kit}`;
    if (tx.to_entity) return `Entity: ${tx.to_entity}`;
    return "—";
  }

  function locationLink(tx: ComponentTransaction): string | null {
    if (tx.to_kit) return `/kits/${tx.to_kit}`;
    if (tx.to_entity) return `/entities/${tx.to_entity}`;
    return null;
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!component) return <p>Component not found.</p>;

  const latest = history[0];
  const productName = component.expand?.product?.name ?? component.expand?.product?.category ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/components")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {component.serial
              ? <span className="font-mono tracking-wide text-indigo-700">{component.serial}</span>
              : <span>{productName}</span>}
          </h1>
          <InactiveBadge isActive={component.is_active} size="md" />
          {component.is_bulk && <Badge variant="secondary">Bulk</Badge>}
          <ConsumableBadge isConsumable={component.expand?.product?.is_consumable} size="md" />
          <TrackedBadge tracked={component.expand?.product?.track_in_status} size="md" />
          <ExpiryBadge expiresAt={component.expires_at} />
        </div>
      </div>

      {/* Info + Actions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 text-sm pt-0">
            <Row label="Serial" value={component.serial || "—"} mono />
            <Row label="Notes" value={component.notes || "—"} />
            {component.is_bulk && (
              <Row label="Quantity" value={component.quantity != null ? String(component.quantity) : "—"} />
            )}
            <Row label="Bulk" value={component.is_bulk ? "Yes" : "No"} />
            <Row label="Bin / shelf" value={component.bin_code || "—"} mono />
            <Row label="Lot code" value={component.lot_code || "—"} mono />
            <Row label="Expires at" value={component.expires_at ? formatDateOnly(component.expires_at) : "—"} />
            {component.expires_at && (
              <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
                <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">Expiry status</p>
                <ExpiryStatusPill expiresAt={component.expires_at} />
              </div>
            )}
            {latest && <Row label="Current location" value={locationLabel(latest)} />}
          </CardContent>
        </Card>
        {component.expand?.product && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Product</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Link to={`/products/${component.expand.product.id}`} className="block hover:underline">
                <p className="font-medium text-sm">{component.expand.product.name}</p>
              </Link>
              {(component.expand.product.manufacturer || component.expand.product.model) && (
                <p className="text-xs text-muted-foreground">
                  {[component.expand.product.manufacturer, component.expand.product.model].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {component.expand.product.is_serialized ? "Serialized component" : "Bulk component"}
              </p>
              {productOnHand !== null && component.expand.product.reorder_point != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">On hand: {productOnHand}</span>
                  <LowStockBadge reorderPoint={component.expand.product.reorder_point} onHand={productOnHand} />
                </div>
              )}
              {productInstanceCount !== null && (
                <Link
                  to={`/products/${component.expand.product.id}`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Other instances of this product ({productInstanceCount} total)
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {(canDecideRequests || canTransferKits) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              {canTransferKits && (
                <Button size="sm" onClick={() => setShowMove(true)}>
                  Move
                </Button>
              )}
              {canDecideRequests && (
                <Button size="sm" variant="outline" onClick={openEdit}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
              {canDecideRequests && component.is_active && (
                <Button size="sm" variant="destructive" onClick={() => setShowDeactivate(true)}>
                  Deactivate
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Movement history */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Movement history</h2>
          <span className="text-xs text-muted-foreground">{history.length} record{history.length !== 1 ? "s" : ""}</span>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements.</p>
        ) : (
          <>
            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {history.map((tx) => {
                const fromLabel: ReactNode = tx.expand?.from_kit
                  ? (
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>Kit: {tx.expand.from_kit.serial}</span>
                      <RetiredBadge isActive={tx.expand.from_kit.is_active} />
                      <KitTagList tags={tx.expand.from_kit.tags} />
                    </span>
                  )
                  : tx.expand?.from_entity
                  ? `Entity: ${tx.expand.from_entity.name}`
                  : tx.from_kit || tx.from_entity || "—";
                return (
                  <div key={tx.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground tabular-nums">{formatDate(tx.timestamp)}</span>
                      <span className="text-xs text-muted-foreground">{tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? ""}</span>
                    </div>
                    <div className="text-sm font-medium">
                      {fromLabel} → {locationLabel(tx)}
                    </div>
                    {tx.quantity !== 1 && <p className="text-xs text-muted-foreground mt-0.5">Qty: {tx.quantity}</p>}
                    {tx.notes && <p className="text-xs text-muted-foreground mt-0.5">{tx.notes}</p>}
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
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">From</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">To</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((tx) => {
                      const fromLabel: ReactNode = tx.expand?.from_kit
                        ? (
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>Kit: {tx.expand.from_kit.serial}</span>
                            <RetiredBadge isActive={tx.expand.from_kit.is_active} />
                            <KitTagList tags={tx.expand.from_kit.tags} />
                          </span>
                        )
                        : tx.expand?.from_entity
                        ? `Entity: ${tx.expand.from_entity.name}`
                        : tx.from_kit || tx.from_entity || null;
                      const toLink = locationLink(tx);
                      return (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                            {formatDate(tx.timestamp)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {fromLabel ?? <span className="opacity-30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium">
                            {toLink ? (
                              <Link to={toLink} className="text-indigo-600 hover:underline">{locationLabel(tx)}</Link>
                            ) : (
                              locationLabel(tx)
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-xs">{tx.quantity}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {tx.notes || <span className="opacity-30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? <span className="opacity-30">—</span>}
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

      {/* Maintenance schedules */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Maintenance</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</span>
            {isAdmin && (
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
            cta={isAdmin ? { label: "Add schedule", onClick: () => setShowAddSched(true) } : undefined}
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
                      {isAdmin && (
                        <button
                          onClick={() => setDeactivatingSched(sched)}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          Deactivate
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
                              {isAdmin && (
                                <button
                                  onClick={() => setDeactivatingSched(sched)}
                                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  Deactivate
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
            componentId={id}
            open={showAddSched}
            onClose={() => setShowAddSched(false)}
            onSaved={loadSchedules}
          />
        )}

        {recordingSchedule && (
          <RecordMaintenanceDialog
            schedule={recordingSchedule}
            open={!!recordingSchedule}
            onClose={() => setRecordingSchedule(null)}
            onRecorded={() => { setRecordingSchedule(null); loadSchedules(); }}
          />
        )}
      </div>

      <MoveComponentDialog
        component={component}
        open={showMove}
        onClose={() => setShowMove(false)}
        onSuccess={load}
      />

      {/* Edit dialog */}
      {showEdit && (
        <AlertDialog open={showEdit} onOpenChange={(v) => !v && setShowEdit(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Edit Component</AlertDialogTitle>
              <AlertDialogDescription className="sr-only">Edit component details.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Serial</label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editSerial}
                  onChange={(e) => setEditSerial(e.target.value)}
                  placeholder="Optional serial"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Notes</label>
                <textarea
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Bin / shelf code</label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editBinCode}
                  onChange={(e) => setEditBinCode(e.target.value)}
                  maxLength={16}
                  placeholder="e.g. A3-04"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Lot code</label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editLotCode}
                  onChange={(e) => setEditLotCode(e.target.value)}
                  maxLength={32}
                  placeholder="e.g. LOT-2026-A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Expires at</label>
                <input
                  type="date"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editExpiresAt}
                  onChange={(e) => setEditExpiresAt(e.target.value)}
                />
              </div>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowEdit(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <AlertDialog open={showDeactivate} onOpenChange={setShowDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate component?</AlertDialogTitle>
            <AlertDialogDescription>
              This component will be marked inactive. You can still view its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeactivate}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              Hard-delete this component and all dependent rows. Last-resort tool to fix history.
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

      <CascadeDeleteDialog
        open={showCascadeDelete}
        onOpenChange={setShowCascadeDelete}
        collection="components"
        recordId={component.id}
        onDeleted={() => {
          navigate("/components");
          toast({ title: "Component deleted with cascade", variant: "success" });
        }}
      />
    </div>
  );
}

function ExpiryStatusPill({ expiresAt }: { expiresAt: string }) {
  const status: ExpiryStatus = expiryStatus(expiresAt);
  if (status === "expired") {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">Expired</span>;
  }
  if (status === "expiring-soon") {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700">Expiring soon</span>;
  }
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700">OK</span>;
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className={`text-sm text-right break-all ${mono ? "font-mono text-xs tracking-wide text-indigo-700" : ""}`}>{value}</p>
    </div>
  );
}
