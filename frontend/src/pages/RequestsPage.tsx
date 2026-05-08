import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { RequestFormDialog } from "../components/RequestFormDialog";
import { listRequests } from "../services/requests";
import { formatDateOnly, REQUEST_STATUS_VARIANTS } from "../lib/utils";
import type { KitRequest } from "../types";

export function RequestsPage() {
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const all = await listRequests();
      setRequests(all);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  const filtered = statusFilter === "all"
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Equipment request queue</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          New request
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter !== "all" && (
          <span className="text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Requester</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Kit</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Target</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Expected return</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Delivery date</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">No requests.</td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors group">
                    <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{formatDateOnly(r.date)}</td>
                    <td className="px-4 py-3">
                      {r.expand?.requester?.name ?? r.expand?.requester?.email ?? <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={REQUEST_STATUS_VARIANTS[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-700 font-medium">
                      {r.expand?.designated_kit?.serial ?? <span className="opacity-40 font-normal font-sans text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">{r.expand?.target_entity?.name ?? <span className="opacity-40">—</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                      {r.expected_return ? formatDateOnly(r.expected_return) : <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                      {formatDateOnly(r.delivery_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/requests/${r.id}`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <RequestFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={load}
      />
    </div>
  );
}
