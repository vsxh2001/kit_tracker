import { useEffect, useState } from "react";
import { Package, FileText, CheckCircle, Clock } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { listKits } from "../services/kits";
import { listRequests } from "../services/requests";
import { listRecentTransactions } from "../services/transactions";
import type { Kit, KitRequest, Transaction } from "../types";
import { cn, formatDate } from "../lib/utils";

export function DashboardPage() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Package} label="Total kits" value={kits.length} color="blue" />
            <StatCard icon={FileText} label="Open requests" value={openRequests} color="amber" />
            <StatCard icon={CheckCircle} label="Awaiting fulfillment" value={approvedRequests} color="green" />
            <StatCard icon={Clock} label="Total requests" value={requests.length} color="slate" />
          </div>

          {/* Recent transactions */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent transactions</h2>
            {recentTx.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Kit</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">From</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">To</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTx.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {formatDate(tx.timestamp)}
                          </td>
                          <td className="p-3 font-mono font-medium">
                            {tx.expand?.kit?.serial ?? tx.kit}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {tx.expand?.from_entity?.name ?? "—"}
                          </td>
                          <td className="p-3">
                            {tx.expand?.to_entity?.name ?? tx.to_entity}
                          </td>
                          <td className="p-3 text-muted-foreground truncate max-w-[200px]">
                            {tx.notes ?? "—"}
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
  blue:  "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  green: "bg-green-50 text-green-600",
  slate: "bg-slate-100 text-slate-500",
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: keyof typeof STAT_COLORS;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", STAT_COLORS[color])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
