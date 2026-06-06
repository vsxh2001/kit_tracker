import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../ui/card";
import { AddComponentDialog } from "../AddComponentDialog";
import { MoveComponentDialog } from "../MoveComponentDialog";
import { listComponentsInKit } from "../../services/componentTransactions";
import { expiryStatus } from "../../lib/utils";
import { ExpiryBadge } from "../ExpiryBadge";
import { ConsumableBadge } from "../ConsumableBadge";
import type { Component } from "../../types";

interface ComponentsTableProps {
  kitId: string;
  canEdit: boolean;
  canTransferKits: boolean;
}

export function ComponentsTable({ kitId, canEdit, canTransferKits }: ComponentsTableProps) {
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddComp, setShowAddComp] = useState(false);
  const [movingComponent, setMovingComponent] = useState<Component | null>(null);

  async function load() {
    setLoading(true);
    try {
      setComponents(await listComponentsInKit(kitId));
    } catch (err: unknown) {
      if ((err as { isAbort?: boolean })?.isAbort) return;
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [kitId]);

  if (loading) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold tracking-tight">Components in kit</h2>
        <span className="text-xs text-muted-foreground">{components.length} component{components.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex gap-2 mb-3">
        {canEdit && (
          <button
            onClick={() => setShowAddComp(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Add component
          </button>
        )}
        {!canEdit && canTransferKits && (
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {comp.expand?.product ? (
                      <Link to={`/products/${comp.expand.product.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                        {comp.expand.product.name}
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">—</span>
                    )}
                    <ConsumableBadge isConsumable={comp.expand?.product?.is_consumable} />
                    {comp.serial && <span className="font-mono text-xs text-indigo-700">{comp.serial}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {comp.is_bulk && <span className="text-xs text-muted-foreground">Qty: {comp.quantity}</span>}
                    {comp.bin_code && (
                      <span className="font-mono text-xs text-indigo-700">Bin: {comp.bin_code}</span>
                    )}
                    {comp.lot_code && (
                      <span className="font-mono text-xs text-indigo-700">Lot: {comp.lot_code}</span>
                    )}
                    <ExpiryBadge expiresAt={comp.expires_at} />
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
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Product / Type / Serial</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Qty</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Bin</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Lot</th>
                    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Expiry</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {components.map((comp) => (
                    <tr key={comp.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {comp.expand?.product ? (
                            <Link to={`/products/${comp.expand.product.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                              {comp.expand.product.name}
                            </Link>
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">—</span>
                          )}
                          <ConsumableBadge isConsumable={comp.expand?.product?.is_consumable} />
                        </div>
                        {comp.serial && <div className="font-mono text-xs text-indigo-700 mt-0.5">{comp.serial}</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs">{comp.quantity}</td>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-700">
                        {comp.bin_code || <span className="text-muted-foreground opacity-40">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-700">
                        {comp.lot_code || <span className="text-muted-foreground opacity-40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {comp.expires_at ? (
                          expiryStatus(comp.expires_at) === "ok" ? (
                            <span className="text-xs text-muted-foreground">{comp.expires_at.slice(0, 10)}</span>
                          ) : (
                            <ExpiryBadge expiresAt={comp.expires_at} />
                          )
                        ) : (
                          <span className="text-muted-foreground opacity-40">—</span>
                        )}
                      </td>
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

      <AddComponentDialog
        open={showAddComp}
        onClose={() => setShowAddComp(false)}
        targetKit={kitId}
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
