import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { MoveKitDialog } from "../components/MoveKitDialog";
import { KitFormDialog } from "../components/KitFormDialog";
import { KitTimeline } from "../components/KitTimeline";
import { AddComponentDialog } from "../components/AddComponentDialog";
import { MoveComponentDialog } from "../components/MoveComponentDialog";
import { getKit, getKitHistory, updateKit } from "../services/kits";
import { listComponentsInKit } from "../services/componentTransactions";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
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
import type { Kit, Transaction, Component } from "../types";

export function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, canTransferKits } = useAuth();
  const [kit, setKit] = useState<Kit | null>(null);
  const [latest, setLatest] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showRetire, setShowRetire] = useState(false);
  const [loading, setLoading] = useState(true);
  const [components, setComponents] = useState<Component[]>([]);
  const [showAddComp, setShowAddComp] = useState(false);
  const [movingComponent, setMovingComponent] = useState<Component | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [k, h, comps] = await Promise.all([getKit(id), getKitHistory(id), listComponentsInKit(id)]);
      setKit(k);
      setHistory(h);
      setLatest(h[0] ?? null);
      setComponents(comps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  async function handleRetire() {
    if (!kit) return;
    try {
      await updateKit(kit.id, { is_active: false });
      toast({ title: "Kit retired", description: kit.serial, variant: "success" });
      navigate("/kits");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to retire kit", description: err?.message, variant: "destructive" });
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
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 text-sm pt-0">
            <Row label="Serial" value={kit.serial} mono />
            <Row label="Notes" value={kit.notes ?? "—"} />
            <Row label="Current location" value={currentEntity?.name ?? "Unknown"} />
            {latest && <Row label="Last moved" value={formatDate(latest.timestamp)} />}
          </CardContent>
        </Card>

        {canTransferKits && (
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
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
              {isAdmin && kit.is_active && (
                <Button size="sm" variant="destructive" onClick={() => setShowRetire(true)}>
                  Retire kit
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Location history timeline */}
      <KitTimeline kitId={kit.id} />

      {/* Transaction history */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Transaction history</h2>
          <span className="text-xs text-muted-foreground">{history.length} record{history.length !== 1 ? "s" : ""}</span>
        </div>
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
      </div>

      {/* Components in kit */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Components in kit</h2>
          <span className="text-xs text-muted-foreground">{components.length} component{components.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex gap-2 mb-3">
          {isAdmin && (
            <button
              onClick={() => setShowAddComp(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Add component
            </button>
          )}
          {!isAdmin && canTransferKits && (
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
                      <span className="text-xs font-medium">{comp.type}</span>
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
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Type / Serial</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((comp) => (
                      <tr key={comp.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-xs font-medium">{comp.type}</div>
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

      <AlertDialog open={showRetire} onOpenChange={setShowRetire}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {kit.serial}?</AlertDialogTitle>
            <AlertDialogDescription>
              This kit will be marked inactive and hidden from active kit lists. You can still view its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRetire}>Retire</AlertDialogAction>
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
