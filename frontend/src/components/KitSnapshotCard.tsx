import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { getKitHistory } from "../services/kits";
import { listComponentTransactionsForKit } from "../services/componentTransactions";
import { listAllActiveSchedules } from "../services/maintenance";
import { holderAt, componentsAt, schedulesAt, endOfDayIso } from "../lib/snapshot";
import { formatDateOnly } from "../lib/utils";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import { ConsumableBadge } from "./ConsumableBadge";
import { TrackedBadge } from "./TrackedBadge";
import type { Transaction, ComponentTransaction, KitMaintenanceSchedule } from "../types";

interface Props {
  kitId: string;
  atDate: string; // YYYY-MM-DD
}

export function KitSnapshotCard({ kitId, atDate }: Props) {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [compTxs, setCompTxs] = useState<ComponentTransaction[]>([]);
  const [schedules, setSchedules] = useState<KitMaintenanceSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [h, ct, sc] = await Promise.all([
        getKitHistory(kitId),
        listComponentTransactionsForKit(kitId),
        listAllActiveSchedules({ filter: `kit = "${kitId}"` }),
      ]);
      setTxs(h);
      setCompTxs(ct);
      setSchedules(sc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, [kitId, atDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const atIso = endOfDayIso(atDate);
  const holder = holderAt(txs, atIso);
  const inKit = componentsAt(compTxs, kitId, atIso);
  const openScheds = schedulesAt(schedules, atIso);

  const formattedDate = formatDateOnly(atDate);

  if (loading) {
    return (
      <Card className="border-amber-300 bg-amber-50/40">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!holder) {
    return (
      <Card className="border-amber-300 bg-amber-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-amber-700 uppercase tracking-wider">
            Snapshot at end of {formattedDate}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Kit did not exist yet on {formattedDate}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-amber-700 uppercase tracking-wider">
          Snapshot at end of {formattedDate}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Holder */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Holder</p>
          {holder.expand?.to_entity ? (
            <Link
              to={`/entities/${holder.expand.to_entity.id}`}
              className="text-indigo-600 hover:underline font-medium"
            >
              {holder.expand.to_entity.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">{holder.to_entity}</span>
          )}
        </div>

        {/* is_active at that date — falls back to current value since no audit-log replay in v1 */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
          <Badge variant="success">Active</Badge>
          <span className="ml-2 text-xs text-muted-foreground" title="Retirement history not tracked in v1; showing 'Active' for any date the kit had transactions.">
            (history not tracked)
          </span>
        </div>

        {/* Components */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Components ({inKit.length})
          </p>
          {inKit.length === 0 ? (
            <p className="text-xs text-muted-foreground">None in kit at this date.</p>
          ) : (
            <ul className="space-y-0.5">
              {inKit.map((ct) => {
                const comp = ct.expand?.component;
                const product = comp?.expand?.product;
                return (
                  <li key={ct.component} className="text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    {product ? (
                      <Link
                        to={`/components/${ct.component}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {product.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{ct.component}</span>
                    )}
                    <ConsumableBadge isConsumable={product?.is_consumable} />
                    <TrackedBadge tracked={product?.track_in_status} />
                    {comp?.serial && (
                      <span className="font-mono text-xs text-indigo-700">{comp.serial}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Open maintenance */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Open maintenance ({openScheds.length})
          </p>
          {openScheds.length === 0 ? (
            <p className="text-xs text-muted-foreground">None due at this date.</p>
          ) : (
            <ul className="space-y-0.5">
              {openScheds.map((s) => {
                const due = new Date(s.next_due_at.slice(0, 10) + "T00:00:00").getTime();
                const snap = new Date(atIso).getTime();
                const overdueDays = Math.floor((snap - due) / 86400000);
                return (
                  <li key={s.id} className="text-xs flex items-center gap-2">
                    <span>{maintenanceTypeLabel(s.type)}</span>
                    {overdueDays > 0 && (
                      <span className="text-red-600 font-medium">{overdueDays}d overdue</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
