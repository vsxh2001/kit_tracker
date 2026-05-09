import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, FileText, CheckCircle, Clock } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { listKits } from "../services/kits";
import { listRequests } from "../services/requests";
import { listRecentTransactions } from "../services/transactions";
import type { Kit, KitRequest, Transaction } from "../types";
import { cn, formatDate } from "../lib/utils";
import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [kits, setKits] = useState<Kit[]>([]);
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const pendingApproval = !user?.role;

  useEffect(() => {
    Promise.all([
      listKits(),
      listRequests(),
      listRecentTransactions(8),
    ]).then(([k, r, t]) => {
      setKits(k);
      setRequests(r);
      setRecentTx(t.items);
    }).catch((err) => {
      if (!err?.isAbort) console.error(err);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const openRequests = requests.filter((r) => r.status === "open").length;
  const approvedRequests = requests.filter((r) => r.status === "approved").length;

  return (
    <div className="space-y-7">
      {pendingApproval && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your account is awaiting admin approval. You can browse but actions are limited until your role is assigned.
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Equipment overview and recent activity</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Package} label="Total kits" value={kits.length} color="blue" onClick={() => navigate("/kits")} />
            <StatCard icon={FileText} label="Open requests" value={openRequests} color="amber" onClick={() => navigate("/requests?status=open")} />
            <StatCard icon={CheckCircle} label="Awaiting fulfillment" value={approvedRequests} color="green" onClick={() => navigate("/requests?status=approved")} />
            <StatCard icon={Clock} label="Total requests" value={requests.length} color="slate" onClick={() => navigate("/requests")} />
          </div>

          {/* Recent transactions */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold tracking-tight">Recent transactions</h2>
              <span className="text-xs text-muted-foreground">{recentTx.length} shown</span>
            </div>
            {recentTx.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Kit</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">From</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">To</th>
                        <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
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
            )}
          </div>
        </>
      )}
    </div>
  );
}

const STAT_COLORS = {
  blue:  { chip: "bg-blue-50 text-blue-500 ring-blue-100", bar: "bg-blue-500" },
  amber: { chip: "bg-amber-50 text-amber-500 ring-amber-100", bar: "bg-amber-500" },
  green: { chip: "bg-emerald-50 text-emerald-500 ring-emerald-100", bar: "bg-emerald-500" },
  slate: { chip: "bg-slate-100 text-slate-400 ring-slate-200", bar: "bg-slate-400" },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: keyof typeof STAT_COLORS;
  onClick?: () => void;
}) {
  const colors = STAT_COLORS[color];
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
            <p className="text-3xl font-bold mt-1.5 tabular-nums tracking-tight">{value}</p>
          </div>
          <div className={cn("h-9 w-9 rounded-lg ring-1 flex items-center justify-center shrink-0 mt-0.5", colors.chip)}>
            <Icon style={{ width: "18px", height: "18px" }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
