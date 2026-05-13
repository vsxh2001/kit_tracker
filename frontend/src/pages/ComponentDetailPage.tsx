import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
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
import { getComponent, updateComponent } from "../services/components";
import { listTransactionsForComponent } from "../services/componentTransactions";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import type { Component, ComponentTransaction } from "../types";

export function ComponentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canTransferKits, canDecideRequests } = useAuth();
  const [component, setComponent] = useState<Component | null>(null);
  const [history, setHistory] = useState<ComponentTransaction[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editSerial, setEditSerial] = useState("");
  const [editType, setEditType] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  function openEdit() {
    if (!component) return;
    setEditSerial(component.serial);
    setEditType(component.type);
    setEditNotes(component.notes);
    setEditError("");
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    if (!component) return;
    if (!editType.trim()) { setEditError("Type is required."); return; }
    setEditSaving(true);
    try {
      await updateComponent(component.id, {
        serial: editSerial.trim(),
        type: editType.trim(),
        notes: editNotes.trim(),
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
      toast({ title: "Component deactivated", description: component.serial || component.type, variant: "success" });
      navigate("/components");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast({ title: "Failed to deactivate", description: e?.message, variant: "destructive" });
    }
  }

  function locationLabel(tx: ComponentTransaction): string {
    if (tx.expand?.to_kit) return `Kit: ${tx.expand.to_kit.serial}`;
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
              : <span>{component.type}</span>}
          </h1>
          {!component.is_active && <Badge variant="destructive">Inactive</Badge>}
          {component.is_bulk && <Badge variant="secondary">Bulk</Badge>}
        </div>
      </div>

      {/* Info + Actions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 text-sm pt-0">
            <Row label="Type" value={component.type} />
            <Row label="Serial" value={component.serial || "—"} mono />
            <Row label="Notes" value={component.notes || "—"} />
            <Row label="Quantity" value={String(component.quantity)} />
            <Row label="Bulk" value={component.is_bulk ? "Yes" : "No"} />
            {latest && <Row label="Current location" value={locationLabel(latest)} />}
          </CardContent>
        </Card>

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
                const fromLabel = tx.expand?.from_kit
                  ? `Kit: ${tx.expand.from_kit.serial}`
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
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">From</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">To</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((tx) => {
                      const fromLabel = tx.expand?.from_kit
                        ? `Kit: ${tx.expand.from_kit.serial}`
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
                <label className="text-sm font-medium">Type</label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  placeholder="e.g. Battery"
                />
              </div>
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
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className={`text-sm text-right break-all ${mono ? "font-mono text-xs tracking-wide text-indigo-700" : ""}`}>{value}</p>
    </div>
  );
}
