import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { EntityFormDialog } from "../components/EntityFormDialog";
import { getEntity, getEntityTransactions } from "../services/entities";
import { listComponentsAtEntity } from "../services/componentTransactions";
import { MoveComponentDialog } from "../components/MoveComponentDialog";
import { AddComponentDialog } from "../components/AddComponentDialog";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { Entity, Transaction, Kit, Component } from "../types";

export function EntityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canTransferKits, canDecideRequests } = useAuth();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [currentKits, setCurrentKits] = useState<Kit[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [standaloneComponents, setStandaloneComponents] = useState<Component[]>([]);
  const [showAddComp, setShowAddComp] = useState(false);
  const [movingComponent, setMovingComponent] = useState<Component | null>(null);

  async function load() {
    if (!id) return;
    try {
      const [e, txs, comps] = await Promise.all([
        getEntity(id),
        getEntityTransactions(id),
        listComponentsAtEntity(id),
      ]);
      setEntity(e);
      setHistory(txs);

      // Derive current kits: for each kit, take latest tx; if to_entity = this entity → kit is here
      const latestByKit = new Map<string, Transaction>();
      for (const tx of txs) {
        const kitId = tx.kit;
        if (!latestByKit.has(kitId)) latestByKit.set(kitId, tx);
      }
      const here: Kit[] = [];
      for (const [, tx] of latestByKit) {
        if (tx.to_entity === id && tx.expand?.kit) {
          here.push(tx.expand.kit);
        }
      }
      setCurrentKits(here);
      setStandaloneComponents(comps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!entity) return <p>Entity not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/entities")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{entity.name}</h1>
          {!entity.is_active && <Badge variant="destructive">Inactive</Badge>}
        </div>
        {canDecideRequests && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowEdit(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>

      {/* Current kits */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Current kits</h2>
          <span className="text-xs text-muted-foreground">{currentKits.length} kit{currentKits.length !== 1 ? "s" : ""}</span>
        </div>
        {currentKits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No kits currently at this entity.</p>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {currentKits.map((kit) => (
                <div
                  key={kit.id}
                  className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                  onClick={() => navigate(`/kits/${kit.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs tracking-wide text-indigo-700">{kit.serial}</span>
                    {kit.is_active
                      ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                      : <Badge variant="destructive" className="text-[10px]">Retired</Badge>}
                  </div>
                  {kit.notes && <p className="text-xs text-muted-foreground mt-1">{kit.notes}</p>}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Serial</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentKits.map((kit) => (
                      <tr
                        key={kit.id}
                        className="border-b last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer"
                        onClick={() => navigate(`/kits/${kit.id}`)}
                      >
                        <td className="px-4 py-3 font-mono text-xs tracking-wide text-indigo-700">{kit.serial}</td>
                        <td className="px-4 py-3 text-muted-foreground">{kit.notes ?? <span className="opacity-30">—</span>}</td>
                        <td className="px-4 py-3">
                          {kit.is_active
                            ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                            : <Badge variant="destructive" className="text-[10px]">Retired</Badge>}
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
            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {history.map((tx) => (
                <div key={tx.id} className="rounded-lg border bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="font-mono text-xs text-indigo-700 cursor-pointer hover:underline"
                      onClick={() => navigate(`/kits/${tx.kit}`)}
                    >
                      {tx.expand?.kit?.serial ?? tx.kit}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(tx.timestamp)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tx.expand?.from_entity?.name ?? "—"} → {tx.expand?.to_entity?.name ?? tx.to_entity}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? ""}
                  </p>
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
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Kit</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">From</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">To</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((tx) => (
                      <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                          {formatDate(tx.timestamp)}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-xs text-indigo-700 cursor-pointer hover:underline"
                          onClick={() => navigate(`/kits/${tx.kit}`)}
                        >
                          {tx.expand?.kit?.serial ?? tx.kit}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{tx.expand?.from_entity?.name ?? <span className="opacity-30">—</span>}</td>
                        <td className="px-4 py-3 font-medium">{tx.expand?.to_entity?.name ?? tx.to_entity}</td>
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

      {/* Standalone components */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold tracking-tight">Standalone components</h2>
          <span className="text-xs text-muted-foreground">{standaloneComponents.length} component{standaloneComponents.length !== 1 ? "s" : ""}</span>
        </div>
        {canTransferKits && (
          <div className="mb-3">
            <button
              onClick={() => setShowAddComp(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-slate-50 transition-colors"
            >
              Move component here
            </button>
          </div>
        )}
        {standaloneComponents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No standalone components at this entity.</p>
        ) : (
          <>
            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {standaloneComponents.map((comp) => (
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
                    {standaloneComponents.map((comp) => (
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

      <EntityFormDialog
        entity={entity}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={() => { setShowEdit(false); load(); }}
      />
      <AddComponentDialog
        open={showAddComp}
        onClose={() => setShowAddComp(false)}
        targetEntity={id}
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
    </div>
  );
}
