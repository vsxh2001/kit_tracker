import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { RequestFormDialog } from "../components/RequestFormDialog";
import { listRequests } from "../services/requests";
import { useAuth } from "../context/AuthContext";
import { formatDateOnly } from "../lib/utils";
import type { KitRequest, RequestStatus } from "../types";

const STATUS_VARIANTS: Record<RequestStatus, "gray" | "success" | "destructive" | "purple" | "secondary"> = {
  open: "secondary",
  approved: "success",
  rejected: "destructive",
  fulfilled: "purple",
  cancelled: "gray",
};

export function RequestsPage() {
  useAuth();
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const all = await listRequests();
      setRequests(all);
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = statusFilter === "all"
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Requests</h1>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          New request
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
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
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Requester</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Kit</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Target</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No requests.</td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 text-muted-foreground">{formatDateOnly(r.date)}</td>
                    <td className="p-3">
                      {r.expand?.requester?.name ?? r.expand?.requester?.email ?? "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant={STATUS_VARIANTS[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="p-3 font-mono">
                      {r.expand?.designated_kit?.serial ?? "—"}
                    </td>
                    <td className="p-3">{r.expand?.target_entity?.name ?? "—"}</td>
                    <td className="p-3">
                      <Link to={`/requests/${r.id}`}>
                        <Button variant="ghost" size="icon">
                          <ArrowRight className="h-4 w-4" />
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
