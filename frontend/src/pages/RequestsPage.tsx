import { useEffect, useState, useMemo, startTransition } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Plus, CalendarDays, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Input } from "../components/ui/input";
import { RequestFormDialog } from "../components/RequestFormDialog";
import { KitTagList } from "../components/KitTagList";
import { listRequests } from "../services/requests";
import { formatDateOnly, REQUEST_STATUS_VARIANTS } from "../lib/utils";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
import type { KitRequest, RequestStatus } from "../types";

const VALID_STATUSES: RequestStatus[] = ["open", "approved", "rejected", "fulfilled", "cancelled"];
const TERMINAL_STATUSES = new Set<RequestStatus>(["fulfilled", "cancelled", "rejected"]);

type DeliveryFilter = "all" | "overdue" | "today" | "this-week" | "next-30";

function isValidStatus(s: string | null): s is RequestStatus {
  return VALID_STATUSES.includes(s as RequestStatus);
}

function isValidDelivery(s: string | null): s is DeliveryFilter {
  return ["all", "overdue", "today", "this-week", "next-30"].includes(s as DeliveryFilter);
}

function getStatusFromParams(params: URLSearchParams): RequestStatus | "all" {
  const s = params.get("status");
  return isValidStatus(s) ? s : "all";
}

function getDeliveryFromParams(params: URLSearchParams): DeliveryFilter {
  const s = params.get("delivery");
  return isValidDelivery(s) ? s : "all";
}

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

function localDateAddDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function matchesDelivery(r: KitRequest, filter: DeliveryFilter): boolean {
  if (filter === "all") return true;
  const delivery = formatDateOnly(r.delivery_date); // YYYY-MM-DD
  const today = todayISO();
  if (filter === "overdue") {
    return delivery < today && !TERMINAL_STATUSES.has(r.status);
  }
  if (filter === "today") {
    return delivery === today;
  }
  // next 7 days: today <= delivery <= today+7
  const iso7 = localDateAddDays(7);
  if (filter === "this-week") {
    return delivery >= today && delivery <= iso7;
  }
  // next 30 days
  const iso30 = localDateAddDays(30);
  return delivery >= today && delivery <= iso30;
}

export function RequestsPage() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const canCreate = isAdmin || user?.role === "user" || user?.role === "technician";
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState<KitRequest[]>([]);
  const statusFilter = useMemo(() => getStatusFromParams(searchParams), [searchParams]);
  const deliveryFilter = useMemo(() => getDeliveryFromParams(searchParams), [searchParams]);
  const searchQuery = useMemo(() => searchParams.get("search") ?? "", [searchParams]);
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

  function updateParam(key: string, value: string, sentinel: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === sentinel) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });
  }

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!matchesDelivery(r, deliveryFilter)) return false;
      if (q) {
        const name = (r.expand?.requester?.name ?? "").toLowerCase();
        const email = (r.expand?.requester?.email ?? "").toLowerCase();
        const serial = (r.expand?.designated_kit?.serial ?? "").toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !serial.includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusFilter, deliveryFilter, searchQuery]);

  const isFiltered = statusFilter !== "all" || deliveryFilter !== "all" || searchQuery !== "";

  function clearFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("status");
      next.delete("delivery");
      next.delete("search");
      return next;
    }, { replace: true });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Queue</p>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Equipment request queue</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/requests/calendar">
            <Button variant="ghost" size="sm">
              <CalendarDays className="h-4 w-4" />
              Calendar view
            </Button>
          </Link>
          {canCreate && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              New request
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => updateParam("status", v, "all")}>
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

        <Select value={deliveryFilter} onValueChange={(v) => updateParam("delivery", v, "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dates</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="this-week">This week</SelectItem>
            <SelectItem value="next-30">Next 30 days</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-72"
          placeholder="Search by requester name or kit serial..."
          value={searchQuery}
          onChange={(e) => updateParam("search", e.target.value, "")}
        />

        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}

        {isFiltered && (
          <span className="text-xs text-muted-foreground">
            Showing {filtered.length} of {requests.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">No requests.</p>
          )}

          {/* Mobile card list */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map((r) => (
                <Link key={r.id} to={`/requests/${r.id}`}>
                  <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <Badge variant={REQUEST_STATUS_VARIANTS[r.status]}>{r.status}</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatDateOnly(r.date)}</span>
                    </div>
                    <p className="text-sm font-medium">
                      {r.expand?.requester?.name ?? r.expand?.requester?.email ?? "—"}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      {r.expand?.designated_kit?.serial && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-indigo-700">{r.expand.designated_kit.serial}</span>
                          <KitTagList tags={r.expand.designated_kit.tags} />
                        </div>
                      )}
                      {r.expand?.target_entity?.name && (
                        <span>{r.expand.target_entity.name}</span>
                      )}
                      <span>Delivery: {formatDateOnly(r.delivery_date)}</span>
                      {r.expected_return && <span>Return: {formatDateOnly(r.expected_return)}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Date</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Requester</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Kit</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Target</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Expected return</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Delivery date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/requests/${r.id}`)}>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{formatDateOnly(r.date)}</td>
                        <td className="px-4 py-3">
                          {r.expand?.requester?.name ?? r.expand?.requester?.email ?? <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={REQUEST_STATUS_VARIANTS[r.status]}>{r.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {r.expand?.designated_kit?.serial ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-indigo-700 font-medium">{r.expand.designated_kit.serial}</span>
                              <KitTagList tags={r.expand.designated_kit.tags} />
                            </div>
                          ) : (
                            <span className="opacity-40 text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{r.expand?.target_entity?.name ?? <span className="opacity-40">—</span>}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                          {r.expected_return ? formatDateOnly(r.expected_return) : <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                          {formatDateOnly(r.delivery_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <RequestFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => {
          toast({ title: "Request created", variant: "success" });
          load();
        }}
      />
    </div>
  );
}
