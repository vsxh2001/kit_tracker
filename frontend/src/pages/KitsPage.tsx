import { useEffect, useState, startTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Download, Upload, ChevronUp, ChevronDown, Printer } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { KitFormDialog } from "../components/KitFormDialog";
import { ImportKitsDialog } from "../components/ImportKitsDialog";
import { BulkTransferDialog } from "../components/BulkTransferDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { listKits, exportKitsCsv, listUpcomingDeliveries, parseTags, softDeleteKit, updateKit } from "../services/kits";
import { listLatestTxByKit } from "../services/transactions";
import type { UpcomingDelivery } from "../services/kits";
import { listAllActiveSchedules } from "../services/maintenance";
import { Skeleton } from "../components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import { toast } from "../components/ui/use-toast";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateOnly, maintenanceStatus } from "../lib/utils";
import { MaintenanceStatusBadge } from "../components/MaintenanceStatusBadge";
import type { Kit, Transaction, KitMaintenanceSchedule } from "../types";

interface KitRow {
  kit: Kit;
  latest?: Transaction;
}

type SortField = "serial" | "delivery" | "maintenance";
type SortDir = "asc" | "desc";

type BulkAction = "retire" | "activate";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === "asc" ? (
    <ChevronUp className="inline h-3 w-3 ml-0.5" />
  ) : (
    <ChevronDown className="inline h-3 w-3 ml-0.5" />
  );
}

export function KitsPage() {
  const navigate = useNavigate();
  const { canDecideRequests, isAdmin } = useAuth();
  const [rows, setRows] = useState<KitRow[]>([]);
  const [deliveries, setDeliveries] = useState<Map<string, UpcomingDelivery>>(new Map());
  const [schedulesByKit, setSchedulesByKit] = useState<Map<string, KitMaintenanceSchedule[]>>(new Map());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "retired" | "all">("active");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Kit | null>(null);
  const [sortField, setSortField] = useState<SortField>("serial");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkTransfer, setShowBulkTransfer] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [kits, upcomingMap, allSchedules, latestByKit] = await Promise.all([
        listKits(true),
        listUpcomingDeliveries(),
        listAllActiveSchedules(),
        listLatestTxByKit(),
      ]);
      const withLatest = kits.map((kit) => ({
        kit,
        latest: latestByKit.get(kit.id),
      }));
      setRows(withLatest);
      setDeliveries(upcomingMap);
      // Group schedules by kit
      const byKit = new Map<string, KitMaintenanceSchedule[]>();
      for (const s of allSchedules) {
        if (!s.kit) continue;
        const arr = byKit.get(s.kit) ?? [];
        arr.push(s);
        byKit.set(s.kit, arr);
      }
      setSchedulesByKit(byKit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  async function handleExport() {
    try {
      const csv = await exportKitsCsv();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toLocaleDateString("en-CA");
      a.download = `kits-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  async function handleDeleteKit() {
    if (!deleteTarget) return;
    try {
      await softDeleteKit(deleteTarget.id);
      setRows((prev) => prev.filter((r) => r.kit.id !== deleteTarget.id));
      toast({ title: "Kit deactivated", description: deleteTarget.serial, variant: "success" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate kit", description: err?.message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[]) {
    if (ids.every((id) => selected.has(id))) {
      // all currently visible selected → deselect all
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  async function executeBulkAction(action: BulkAction) {
    setBulkLoading(true);
    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        if (action === "retire") {
          await softDeleteKit(id);
        } else {
          await updateKit(id, { is_active: true });
        }
        succeeded++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (!err?.isAbort) failed++;
      }
    }
    setBulkLoading(false);
    setBulkAction(null);
    setSelected(new Set());
    if (failed === 0) {
      const label = action === "retire" ? "retired" : "activated";
      toast({ title: `${succeeded} kit${succeeded !== 1 ? "s" : ""} ${label}`, variant: "success" });
    } else {
      toast({
        title: `${succeeded} of ${ids.length} succeeded — ${failed} failed`,
        variant: "destructive",
      });
    }
    startTransition(() => load());
  }

  // Tag chips reflect kits visible under the current status filter — avoids showing
  // stale tags belonging only to retired kits when viewing Active.
  const allTags = Array.from(
    new Set(
      rows
        .filter(({ kit }) =>
          statusFilter === "all" ||
          (statusFilter === "active" && kit.is_active) ||
          (statusFilter === "retired" && !kit.is_active)
        )
        .flatMap(({ kit }) => parseTags(kit.tags))
    )
  ).sort();

  const filtersActive = statusFilter !== "active" || selectedTags.size > 0;

  function clearFilters() {
    setStatusFilter("active");
    setSelectedTags(new Set());
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  // Prune selection when filters change — drop kits no longer visible
  useEffect(() => {
    if (selected.size === 0) return;
    const visibleIds = new Set(
      rows
        .filter((r) => {
          const matchesSearch = r.kit.serial.toLowerCase().includes(search.toLowerCase());
          const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "active" && r.kit.is_active) ||
            (statusFilter === "retired" && !r.kit.is_active);
          const matchesTags =
            selectedTags.size === 0 ||
            parseTags(r.kit.tags).some((t) => selectedTags.has(t));
          return matchesSearch && matchesStatus && matchesTags;
        })
        .map((r) => r.kit.id)
    );
    startTransition(() => {
      setSelected((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => { if (visibleIds.has(id)) next.add(id); });
        return next.size === prev.size ? prev : next;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, selectedTags, rows]);

  const filtered = rows.filter((r) => {
    const matchesSearch = r.kit.serial.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && r.kit.is_active) ||
      (statusFilter === "retired" && !r.kit.is_active);
    const matchesTags =
      selectedTags.size === 0 ||
      parseTags(r.kit.tags).some((t) => selectedTags.has(t));
    return matchesSearch && matchesStatus && matchesTags;
  });

  function getEarliestNextDue(kitId: string): string | null {
    const scheds = schedulesByKit.get(kitId) ?? [];
    if (scheds.length === 0) return null;
    const dates = scheds.map((s) => s.next_due_at).filter(Boolean).sort();
    return dates[0] ?? null;
  }

  const sorted = [...filtered].sort((a, b) => {
    if (sortField === "serial") {
      const cmp = a.kit.serial.localeCompare(b.kit.serial);
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortField === "maintenance") {
      const ma = getEarliestNextDue(a.kit.id);
      const mb = getEarliestNextDue(b.kit.id);
      if (!ma && !mb) return 0;
      if (!ma) return sortDir === "asc" ? 1 : -1;
      if (!mb) return sortDir === "asc" ? -1 : 1;
      const cmp = ma.localeCompare(mb);
      return sortDir === "asc" ? cmp : -cmp;
    }
    // delivery sort: kits with upcoming come first (asc), kits without sort last
    const da = deliveries.get(a.kit.id);
    const db = deliveries.get(b.kit.id);
    if (!da && !db) return 0;
    if (!da) return sortDir === "asc" ? 1 : -1;
    if (!db) return sortDir === "asc" ? -1 : 1;
    const cmp = da.deliveryDate.localeCompare(db.deliveryDate);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const sortedIds = sorted.map((r) => r.kit.id);
  const allVisibleSelected = sortedIds.length > 0 && sortedIds.every((id) => selected.has(id));
  const someVisibleSelected = sortedIds.some((id) => selected.has(id));

  const selectedKits = rows.filter((r) => selected.has(r.kit.id)).map((r) => r.kit);
  const hasActiveSelected = selectedKits.some((k) => k.is_active);
  const hasInactiveSelected = selectedKits.some((k) => !k.is_active);

  const bulkRetireCount = selectedKits.filter((k) => k.is_active).length;
  const bulkActivateCount = selectedKits.filter((k) => !k.is_active).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Inventory</p>
          <h1 className="text-2xl font-semibold tracking-tight">Kits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtersActive
              ? `Showing ${filtered.length} of ${rows.length} kit${rows.length !== 1 ? "s" : ""}`
              : `${rows.length} kit${rows.length !== 1 ? "s" : ""} registered`}
          </p>
        </div>
        {canDecideRequests && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/kits/print">
                <Printer className="h-4 w-4" />
                Print labels
              </Link>
            </Button>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              New kit
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search by serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "retired" | "all")}>
          <SelectTrigger className="w-auto min-w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 overflow-x-auto">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors shrink-0 ${
                selectedTags.has(tag)
                  ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
                  : "bg-slate-100 text-muted-foreground hover:bg-slate-200"
              }`}
              aria-pressed={selectedTags.has(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {sorted.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">No kits found.</p>
          )}

          {/* Mobile card list */}
          {sorted.length > 0 && (
            <div className="md:hidden space-y-2">
              {sorted.map(({ kit, latest }) => {
                const upcoming = deliveries.get(kit.id);
                const nextMaint = getEarliestNextDue(kit.id);
                return (
                  <Link key={kit.id} to={`/kits/${kit.id}`}>
                    <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-medium text-xs tracking-wide text-indigo-700">{kit.serial}</span>
                          {!kit.is_active && <Badge variant="destructive" className="text-xs">Retired</Badge>}
                        </div>
                        {latest?.expand?.to_entity?.name ? (
                          <Badge variant="secondary">{latest.expand.to_entity.name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs opacity-40">No location</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="truncate">{kit.notes ?? ""}</span>
                        <span className="font-mono tabular-nums shrink-0 ml-2">{latest ? formatDate(latest.timestamp) : "—"}</span>
                      </div>
                      {upcoming && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Next: {formatDateOnly(upcoming.deliveryDate)} → {upcoming.targetEntityName}
                        </p>
                      )}
                      {nextMaint && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground">Maint: {formatDateOnly(nextMaint)}</span>
                          <MaintenanceStatusBadge status={maintenanceStatus(nextMaint)} size="sm" />
                        </div>
                      )}
                      {parseTags(kit.tags).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {[...parseTags(kit.tags)].sort().map((tag) => (
                            <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {isAdmin && (
                        <div className="mt-2" onClick={(e) => e.preventDefault()}>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(kit); }}
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Deactivate
                          </button>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Desktop table */}
          {sorted.length > 0 && (
            <div className="hidden md:block space-y-2">
              {/* Bulk action toolbar — only when rows selected */}
              {canDecideRequests && selected.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50">
                  <span className="text-sm font-medium text-indigo-800">{selected.size} kit{selected.size !== 1 ? "s" : ""} selected</span>
                  <div className="flex items-center gap-2 ml-auto">
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkLoading}
                        onClick={() => setShowBulkTransfer(true)}
                        className="border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                      >
                        Transfer
                      </Button>
                    )}
                    {hasActiveSelected && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkLoading}
                        onClick={() => setBulkAction("retire")}
                        className="border-red-200 text-red-700 hover:bg-red-50"
                      >
                        Retire {bulkRetireCount > 0 ? `(${bulkRetireCount})` : ""}
                      </Button>
                    )}
                    {hasInactiveSelected && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkLoading}
                        onClick={() => executeBulkAction("activate")}
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      >
                        Activate {bulkActivateCount > 0 ? `(${bulkActivateCount})` : ""}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkLoading}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        {canDecideRequests && (
                          <th className="w-10 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                              }}
                              onChange={() => toggleAll(sortedIds)}
                              aria-label="Select all"
                              className="h-4 w-4 rounded border-gray-300 accent-indigo-600 cursor-pointer"
                            />
                          </th>
                        )}
                        <th
                          className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                          onClick={() => handleSort("serial")}
                        >
                          Serial<SortIcon active={sortField === "serial"} dir={sortDir} />
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Current entity</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Last moved</th>
                        <th
                          className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                          onClick={() => handleSort("delivery")}
                        >
                          Next delivery<SortIcon active={sortField === "delivery"} dir={sortDir} />
                        </th>
                        <th
                          className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                          onClick={() => handleSort("maintenance")}
                        >
                          Next maintenance<SortIcon active={sortField === "maintenance"} dir={sortDir} />
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Tags</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Notes</th>
                        {isAdmin && <th className="px-4 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(({ kit, latest }) => {
                        const upcoming = deliveries.get(kit.id);
                        const isChecked = selected.has(kit.id);
                        return (
                          <tr key={kit.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/kits/${kit.id}`)}>
                            {canDecideRequests && (
                              <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRow(kit.id)}
                                  aria-label={`Select ${kit.serial}`}
                                  className="h-4 w-4 rounded border-gray-300 accent-indigo-600 cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3 font-mono font-medium text-xs tracking-wide text-indigo-700">
                              <div className="flex items-center gap-1.5">
                                <span>{kit.serial}</span>
                                {!kit.is_active && <Badge variant="destructive" className="text-xs">Retired</Badge>}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {latest?.expand?.to_entity?.name ? (
                                <Badge variant="secondary">{latest.expand.to_entity.name}</Badge>
                              ) : (
                                <span className="text-muted-foreground opacity-40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground font-mono text-xs tabular-nums">
                              {latest ? formatDate(latest.timestamp) : <span className="opacity-40">—</span>}
                            </td>
                            <td className="px-4 py-3 text-xs tabular-nums">
                              {upcoming ? (
                                <span>{formatDateOnly(upcoming.deliveryDate)} → {upcoming.targetEntityName}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {(() => {
                                const nextDue = getEarliestNextDue(kit.id);
                                if (!nextDue) return <span className="text-muted-foreground text-xs">—</span>;
                                const status = maintenanceStatus(nextDue);
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-muted-foreground tabular-nums">{formatDateOnly(nextDue)}</span>
                                    <MaintenanceStatusBadge status={status} size="sm" />
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3">
                              {parseTags(kit.tags).length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {[...parseTags(kit.tags)].sort().map((tag) => (
                                    <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground opacity-40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                              <span className="line-clamp-2">{kit.notes ?? <span className="opacity-40">—</span>}</span>
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => setDeleteTarget(kit)}
                                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  Deactivate
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <KitFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={load}
      />

      <ImportKitsDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={load}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate kit?</AlertDialogTitle>
            <AlertDialogDescription>
              Kit <strong>{deleteTarget?.serial}</strong> will be hidden from the catalog. Historical transactions remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteKit}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkTransferDialog
        kits={selectedKits}
        open={showBulkTransfer}
        onClose={() => setShowBulkTransfer(false)}
        onTransferred={() => {
          setSelected(new Set());
          startTransition(() => load());
        }}
      />

      {/* Bulk retire confirm dialog */}
      <AlertDialog open={bulkAction === "retire"} onOpenChange={(v) => !v && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {bulkRetireCount} kit{bulkRetireCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes them — they can be reactivated later. Historical transactions remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => executeBulkAction("retire")}>
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

