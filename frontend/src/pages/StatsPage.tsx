import { useEffect, useState, startTransition } from "react";
import { Navigate } from "react-router-dom";
import { BarChart3, Package, Users, TrendingUp, Clock, AlertTriangle, Wrench, Cpu } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { computeStats } from "../services/stats";
import { listAllActiveSchedules } from "../services/maintenance";
import { listProducts, countComponentsForProduct } from "../services/products";
import { maintenanceStatus } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import type { UtilizationStats } from "../services/stats";
import type { RequestStatus, Product } from "../types";

interface ProductUsage {
  product: Product;
  count: number;
}

const STATUS_COLORS: Record<RequestStatus, string> = {
  open: "bg-amber-400",
  approved: "bg-blue-500",
  fulfilled: "bg-emerald-500",
  rejected: "bg-red-400",
  cancelled: "bg-slate-400",
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Open",
  approved: "Approved",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const ALL_STATUSES: RequestStatus[] = ["open", "approved", "fulfilled", "rejected", "cancelled"];

export function StatsPage() {
  const { canDecideRequests, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<UtilizationStats | null>(null);
  const [overdueMaintenanceCount, setOverdueMaintenanceCount] = useState(0);
  const [topProducts, setTopProducts] = useState<ProductUsage[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, scheds, prods] = await Promise.all([
        computeStats(),
        listAllActiveSchedules(),
        listProducts({ includeInactive: false }),
      ]);
      setStats(s);
      setOverdueMaintenanceCount(scheds.filter((sc) => maintenanceStatus(sc.next_due_at) === "overdue").length);
      // Count components per product in parallel with unique requestKeys
      const counts = await Promise.all(prods.map((p) => countComponentsForProduct(p.id)));
      const usage: ProductUsage[] = prods.map((p, i) => ({ product: p, count: counts[i] }));
      usage.sort((a, b) => b.count - a.count);
      setTopProducts(usage.slice(0, 5));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  if (authLoading) return null;
  if (!canDecideRequests) return <Navigate to="/dashboard" replace />;

  const utilizationPct = stats && stats.totalKits > 0
    ? Math.round((stats.kitsOut / stats.totalKits) * 100)
    : 0;

  const totalRequests = stats
    ? ALL_STATUSES.reduce((s, st) => s + stats.statusBreakdown[st], 0)
    : 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Analytics</p>
        <h1 className="text-2xl font-semibold tracking-tight">Utilization</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fleet utilization and request analytics</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

          {/* Card 1 — Fleet utilization */}
          <Card data-testid="card-utilization">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Package className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Fleet utilization</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-bold tabular-nums tracking-tight">
                  {utilizationPct}%
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {stats?.totalKits ?? 0} total kits
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${utilizationPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span><span className="font-semibold text-foreground">{stats?.kitsOut ?? 0}</span> out</span>
                <span><span className="font-semibold text-foreground">{stats?.kitsInStorage ?? 0}</span> in storage</span>
              </div>
            </CardContent>
          </Card>

          {/* Card 2 — Top 5 requesters */}
          <Card data-testid="card-top-requesters">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Top requesters (30d)</span>
              </div>
              {!stats || stats.topRequesters.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No requests in the last 30 days.</p>
              ) : (
                <ol className="space-y-1.5">
                  {stats.topRequesters.map((r, i) => (
                    <li key={r.email} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                      <span className="text-sm truncate flex-1 min-w-0">{r.email}</span>
                      <span className="text-xs font-semibold tabular-nums text-indigo-600">{r.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Card 3 — Top 5 most-moved kits */}
          <Card data-testid="card-top-kits">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Most moved kits (30d)</span>
              </div>
              {!stats || stats.topMovedKits.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No kit movements in the last 30 days.</p>
              ) : (
                <ol className="space-y-1.5">
                  {stats.topMovedKits.map((k, i) => (
                    <li key={k.serial} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                      <span className="font-mono text-sm text-indigo-700 truncate flex-1 min-w-0">{k.serial}</span>
                      <span className="text-xs font-semibold tabular-nums text-indigo-600">{k.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Card 4 — Request status breakdown */}
          <Card data-testid="card-status-breakdown">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Request status breakdown</span>
              </div>
              {!stats || totalRequests === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No requests yet.</p>
              ) : (
                <div className="space-y-2">
                  {ALL_STATUSES.map((status) => {
                    const count = stats.statusBreakdown[status];
                    const pct = totalRequests > 0 ? (count / totalRequests) * 100 : 0;
                    return (
                      <div key={status} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
                          <span className="font-semibold tabular-nums">{count}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${STATUS_COLORS[status]} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 5 — Overdue returns */}
          <Card data-testid="card-overdue">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Overdue returns</span>
              </div>
              <div className="flex items-end gap-3">
                <p className={`text-3xl font-bold tabular-nums tracking-tight ${stats && stats.overdueCount > 0 ? "text-red-500" : ""}`}>
                  {stats?.overdueCount ?? 0}
                </p>
                <span className="text-xs text-muted-foreground mb-1">fulfilled requests past expected return</span>
              </div>
              {stats && stats.overdueCount > 0 && (
                <a
                  href="/requests?status=fulfilled"
                  className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline font-medium"
                >
                  View fulfilled requests →
                </a>
              )}
            </CardContent>
          </Card>

          {/* Card 6 — Avg fulfillment time */}
          <Card data-testid="card-avg-fulfillment">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Avg fulfillment time (30d)</span>
              </div>
              {!stats || stats.avgFulfillmentDays === null ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No fulfilled requests in the last 30 days.</p>
              ) : (
                <div>
                  <p className="text-3xl font-bold tabular-nums tracking-tight">
                    {stats.avgFulfillmentDays.toFixed(1)}
                    <span className="text-base font-normal text-muted-foreground ml-1">days</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">avg time from submission to fulfillment</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 7 — Overdue maintenance */}
          <Card data-testid="card-overdue-maintenance">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wrench className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Overdue maintenance</span>
              </div>
              <div className="flex items-end gap-3">
                <p className={`text-3xl font-bold tabular-nums tracking-tight ${overdueMaintenanceCount > 0 ? "text-red-500" : ""}`}>
                  {overdueMaintenanceCount}
                </p>
                <span className="text-xs text-muted-foreground mb-1">active schedules past due date</span>
              </div>
              {overdueMaintenanceCount > 0 && (
                <a
                  href="/maintenance?status=overdue"
                  className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline font-medium"
                >
                  View maintenance →
                </a>
              )}
            </CardContent>
          </Card>

          {/* Card 8 — Top products by usage */}
          <Card data-testid="card-top-products">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Top products by usage</span>
              </div>
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No products with linked components.</p>
              ) : (
                <ol className="space-y-1.5">
                  {topProducts.map((r, i) => (
                    <li key={r.product.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                      <span className="text-sm truncate flex-1 min-w-0">{r.product.name}</span>
                      <span className="text-xs font-semibold tabular-nums text-indigo-600">{r.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
