import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowRight, Download, Upload, ChevronUp, ChevronDown, Printer } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { KitFormDialog } from "../components/KitFormDialog";
import { ImportKitsDialog } from "../components/ImportKitsDialog";
import { listKits, getLatestTransaction, exportKitsCsv, listUpcomingDeliveries, parseTags } from "../services/kits";
import type { UpcomingDelivery } from "../services/kits";
import { listAllActiveSchedules } from "../services/maintenance";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateOnly, maintenanceStatus } from "../lib/utils";
import type { MaintStatus } from "../lib/utils";
import type { Kit, Transaction, KitMaintenanceSchedule } from "../types";

interface KitRow {
  kit: Kit;
  latest?: Transaction;
}

type SortField = "serial" | "delivery" | "maintenance";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === "asc" ? (
    <ChevronUp className="inline h-3 w-3 ml-0.5" />
  ) : (
    <ChevronDown className="inline h-3 w-3 ml-0.5" />
  );
}

export function KitsPage() {
  const { canDecideRequests } = useAuth();
  const [rows, setRows] = useState<KitRow[]>([]);
  const [deliveries, setDeliveries] = useState<Map<string, UpcomingDelivery>>(new Map());
  const [schedulesByKit, setSchedulesByKit] = useState<Map<string, KitMaintenanceSchedule[]>>(new Map());
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [sortField, setSortField] = useState<SortField>("serial");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  async function load() {
    setLoading(true);
    try {
      const [kits, upcomingMap, allSchedules] = await Promise.all([
        listKits(),
        listUpcomingDeliveries(),
        listAllActiveSchedules(),
      ]);
      const withLatest = await Promise.all(
        kits.map(async (kit) => ({
          kit,
          latest: (await getLatestTransaction(kit.id)) ?? undefined,
        }))
      );
      setRows(withLatest);
      setDeliveries(upcomingMap);
      // Group schedules by kit
      const byKit = new Map<string, KitMaintenanceSchedule[]>();
      for (const s of allSchedules) {
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
      const date = new Date().toISOString().slice(0, 10);
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

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const allTags = Array.from(
    new Set(rows.flatMap(({ kit }) => parseTags(kit.tags)))
  ).sort();

  const filtered = rows.filter((r) => {
    const matchesSearch = r.kit.serial.toLowerCase().includes(search.toLowerCase());
    const matchesTag = activeTag === null || parseTags(r.kit.tags).includes(activeTag);
    return matchesSearch && matchesTag;
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Inventory</p>
          <h1 className="text-2xl font-semibold tracking-tight">Kits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{rows.length} kit{rows.length !== 1 ? "s" : ""} registered</p>
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

      <Input
        placeholder="Search by serial…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs"
      />

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                activeTag === tag
                  ? "bg-indigo-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
              aria-pressed={activeTag === tag}
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
                        <span className="font-mono font-medium text-xs tracking-wide text-indigo-700">{kit.serial}</span>
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
                          <KitMaintPill status={maintenanceStatus(nextMaint)} />
                        </div>
                      )}
                      {parseTags(kit.tags).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {[...parseTags(kit.tags)].sort().map((tag) => (
                            <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {tag}
                            </span>
                          ))}
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
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th
                        className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                        onClick={() => handleSort("serial")}
                      >
                        Serial<SortIcon active={sortField === "serial"} dir={sortDir} />
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Current entity</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Last moved</th>
                      <th
                        className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                        onClick={() => handleSort("delivery")}
                      >
                        Next delivery<SortIcon active={sortField === "delivery"} dir={sortDir} />
                      </th>
                      <th
                        className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider cursor-pointer select-none"
                        onClick={() => handleSort("maintenance")}
                      >
                        Next maintenance<SortIcon active={sortField === "maintenance"} dir={sortDir} />
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Tags</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(({ kit, latest }) => {
                      const upcoming = deliveries.get(kit.id);
                      return (
                        <tr key={kit.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors group">
                          <td className="px-4 py-3 font-mono font-medium text-xs tracking-wide text-indigo-700">{kit.serial}</td>
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
                                  <KitMaintPill status={status} />
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {parseTags(kit.tags).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {[...parseTags(kit.tags)].sort().map((tag) => (
                                  <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
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
                          <td className="px-4 py-3">
                            <Link to={`/kits/${kit.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
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
    </div>
  );
}

function KitMaintPill({ status }: { status: MaintStatus }) {
  if (status === "overdue") return <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">Overdue</span>;
  if (status === "due-soon") return <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">Due soon</span>;
  return <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">OK</span>;
}
