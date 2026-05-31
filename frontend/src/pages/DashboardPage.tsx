import { useEffect, useState, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Package, FileText, CheckCircle, Clock, Wrench, Users } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { listKits } from "../services/kits";
import { listRequests } from "../services/requests";
import { listRecentTransactions } from "../services/transactions";
import { requestsCreatedLast7Days } from "../services/stats";
import { listAllActiveSchedules } from "../services/maintenance";
import { listShifts } from "../services/oncall";
import { maintenanceStatus } from "../lib/utils";
import type { DailyCount } from "../services/stats";
import { Sparkline } from "../components/Sparkline";
import type { Kit, KitRequest, Transaction, OnCallShift } from "../types";
import { cn, formatDate } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { getSmtpStatus } from "../services/health";

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, isAdmin, canDecideRequests } = useAuth();
  const [kits, setKits] = useState<Kit[]>([]);
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [reqSparkline, setReqSparkline] = useState<DailyCount[]>([]);
  const [overdueMaintenanceCount, setOverdueMaintenanceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [oncallShifts, setOncallShifts] = useState<OnCallShift[]>([]);
  const [oncallLoading, setOncallLoading] = useState(true);
  const [smtpEnabled, setSmtpEnabled] = useState<boolean | null>(null);

  const pendingApproval = !user?.role;

  useEffect(() => {
    startTransition(() => {
      async function load() {
        setLoading(true);
        try {
          const [k, r, t, reqDaily, schedules] = await Promise.all([
            listKits(),
            listRequests(),
            listRecentTransactions(8),
            requestsCreatedLast7Days(),
            listAllActiveSchedules(),
          ]);
          setKits(k);
          setRequests(r);
          setRecentTx(t.items.filter((tx) => !tx.expand?.kit?.serial?.startsWith("_deleted_")));
          setReqSparkline(reqDaily);
          setOverdueMaintenanceCount(schedules.filter((s) => maintenanceStatus(s.next_due_at) === "overdue").length);
        } catch (err: unknown) {
          if (!(err as { isAbort?: boolean })?.isAbort) console.error(err);
        } finally {
          setLoading(false);
        }
      }
      load();
    });
  }, []);

  useEffect(() => {
    startTransition(() => {
      async function loadOncall() {
        setOncallLoading(true);
        try {
          const now = new Date().toISOString();
          const all = await listShifts({ limit: 200, sort: "start_at", includeInactive: false });
          setOncallShifts(all.filter((s) => s.start_at <= now && s.end_at >= now));
        } catch (err: unknown) {
          if (!(err as { isAbort?: boolean })?.isAbort) console.error(err);
        } finally {
          setOncallLoading(false);
        }
      }
      loadOncall();
    });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    startTransition(() => {
      async function loadSmtp() {
        try {
          const status = await getSmtpStatus();
          setSmtpEnabled(status.enabled);
        } catch (err: unknown) {
          if (!(err as { isAbort?: boolean })?.isAbort) console.error(err);
        }
      }
      loadSmtp();
    });
  }, [isAdmin]);

  const openRequests = requests.filter((r) => r.status === "open").length;
  const approvedRequests = requests.filter((r) => r.status === "approved").length;

  function oncallLabel(): string {
    if (oncallShifts.length === 0) return "No one";
    const first = oncallShifts[0];
    const u = first.expand?.user;
    const name = u?.name ? u.name.split(" ")[0] : u?.email ? u.email.split("@")[0] : first.user.slice(0, 6);
    return oncallShifts.length > 1 ? `${name} +${oncallShifts.length - 1}` : name;
  }

  function deltaLabel(daily: DailyCount[]): string {
    if (daily.length < 2) return "—";
    const today = daily[daily.length - 1].count;
    const yesterday = daily[daily.length - 2].count;
    const diff = today - yesterday;
    if (diff === 0) return "same as prev day";
    return `${diff > 0 ? "+" : ""}${diff} vs prev day`;
  }

  const reqCounts = reqSparkline.map((d) => d.count);

  if (pendingApproval) {
    return (
      <div className="space-y-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your account is awaiting admin approval. You can browse but actions are limited until your role is assigned.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Overview</p>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Equipment overview and recent activity</p>
      </div>

      {isAdmin && smtpEnabled === false && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          SMTP not configured — maintenance reminders are disabled. Set SMTP_HOST + credentials via Fly secrets (see CLAUDE.md → Email notifications setup).
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <>
          {/* Stats — "Awaiting fulfillment" is primary (solid indigo) as most actionable */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Package} label="Total kits" value={kits.length} color="blue" onClick={() => navigate("/kits")} />
            <StatCard icon={FileText} label="Open requests" value={openRequests} color="amber" sparklineData={reqCounts} delta={deltaLabel(reqSparkline)} onClick={() => navigate("/requests?status=open")} />
            <StatCard icon={CheckCircle} label="Awaiting fulfillment" value={approvedRequests} color="green" primary onClick={() => navigate("/requests?status=approved")} />
            <StatCard icon={Clock} label="Total requests" value={requests.length} color="slate" sparklineData={reqCounts} delta={deltaLabel(reqSparkline)} onClick={() => navigate("/requests")} />
          </div>
          {canDecideRequests && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={Wrench}
                label="Overdue maintenance"
                value={overdueMaintenanceCount}
                color={overdueMaintenanceCount > 0 ? "red" : "slate"}
                onClick={() => navigate("/maintenance")}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={Users}
              label="On call"
              value={0}
              stringValue={oncallLoading ? undefined : oncallLabel()}
              valueLoading={oncallLoading}
              color="violet"
              onClick={() => navigate("/oncall")}
            />
          </div>

          {/* Recent transactions */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold tracking-tight">Recent transactions</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{recentTx.length} shown</span>
                <Link to="/kits" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium hover:underline">View all →</Link>
              </div>
            </div>
            {recentTx.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <>
                <div className="md:hidden space-y-2">
                  {recentTx.map((tx) => (
                    <div
                      key={tx.id}
                      className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-indigo-50/40 transition-colors"
                      onClick={() => navigate(`/kits/${tx.expand?.kit?.id ?? tx.kit}`)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium text-xs tracking-wide text-indigo-700">
                          {tx.expand?.kit?.serial ?? tx.kit}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{formatDate(tx.timestamp)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tx.expand?.from_entity?.name ?? "—"} → {tx.expand?.to_entity?.name ?? tx.to_entity}
                      </div>
                      {tx.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{tx.notes}</p>}
                    </div>
                  ))}
                </div>

                <Card className="overflow-hidden hidden md:block">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Kit</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">From</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">To</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTx.map((tx) => (
                        <tr
                          key={tx.id}
                          className="border-b last:border-0 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                          onClick={() => navigate(`/kits/${tx.expand?.kit?.id ?? tx.kit}`)}
                        >
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                            {formatDate(tx.timestamp)}
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-xs tracking-wide text-indigo-700 hover:underline">
                            {tx.expand?.kit?.serial ?? tx.kit}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {tx.expand?.from_entity?.name ?? <span className="opacity-30">—</span>}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {tx.expand?.to_entity?.name ?? tx.to_entity}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                            {tx.notes ?? <span className="opacity-30">—</span>}
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
        </>
      )}
    </div>
  );
}

const STAT_COLORS = {
  blue:   { chip: "bg-blue-50 text-blue-500 ring-blue-100", bar: "bg-blue-500" },
  amber:  { chip: "bg-amber-50 text-amber-500 ring-amber-100", bar: "bg-amber-500" },
  green:  { chip: "bg-emerald-50 text-emerald-500 ring-emerald-100", bar: "bg-emerald-500" },
  slate:  { chip: "bg-slate-100 text-slate-400 ring-slate-200", bar: "bg-slate-400" },
  red:    { chip: "bg-red-50 text-red-500 ring-red-100", bar: "bg-red-500" },
  violet: { chip: "bg-violet-50 text-violet-500 ring-violet-100", bar: "bg-violet-500" },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  stringValue,
  valueLoading,
  color,
  primary,
  sparklineData,
  delta,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  stringValue?: string;
  valueLoading?: boolean;
  color: keyof typeof STAT_COLORS;
  primary?: boolean;
  sparklineData?: number[];
  delta?: string;
  onClick?: () => void;
}) {
  const colors = STAT_COLORS[color];

  if (primary) {
    return (
      <Card
        className={cn("overflow-hidden relative bg-indigo-600 border-indigo-500", onClick && "cursor-pointer hover:shadow-lg hover:shadow-indigo-900/30 transition-shadow")}
        onClick={onClick}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-indigo-200 font-medium uppercase tracking-wider truncate">{label}</p>
              <p className="text-3xl font-bold mt-1.5 tabular-nums tracking-tight text-white">{value}</p>
            </div>
            <div className="h-9 w-9 rounded-lg bg-indigo-500/60 ring-1 ring-indigo-400/40 flex items-center justify-center shrink-0 mt-0.5 text-white">
              <Icon style={{ width: "18px", height: "18px" }} />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn("overflow-hidden relative", onClick && "cursor-pointer hover:shadow-md transition-shadow")}
      onClick={onClick}
    >
      {/* Subtle top accent bar */}
      <div className={cn("h-0.5 w-full absolute top-0 left-0", colors.bar)} />
      <CardContent className="p-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider truncate">{label}</p>
            {valueLoading ? (
              <div className="mt-2 h-8 w-24 rounded bg-muted animate-pulse" />
            ) : stringValue !== undefined ? (
              <p className="text-2xl font-bold mt-1.5 tracking-tight truncate">{stringValue}</p>
            ) : (
              <p className="text-3xl font-bold mt-1.5 tabular-nums tracking-tight">{value}</p>
            )}
            {sparklineData && sparklineData.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <Sparkline data={sparklineData} color="var(--muted-foreground, #94a3b8)" />
                {delta && (
                  <span className="text-xs text-muted-foreground font-mono">{delta}</span>
                )}
              </div>
            )}
          </div>
          <div className={cn("h-9 w-9 rounded-lg ring-1 flex items-center justify-center shrink-0 mt-0.5", colors.chip)}>
            <Icon style={{ width: "18px", height: "18px" }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
