import { useEffect, useState, startTransition } from "react";
import { ScrollText, Download, Loader2 } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui/button";
import { listAuditLog, exportAuditLogCsv } from "../services/audit";
import { pb } from "../lib/pocketbase";
import { formatDate } from "../lib/utils";
import { cn } from "../lib/utils";
import type { AuditLog, AuditVia } from "../types";
import { toast } from "../components/ui/use-toast";

const COLLECTIONS = ["All", "kits", "entities", "users", "requests", "transactions", "components", "products", "on_call_shifts", "kit_maintenance_schedules", "maintenance_records"] as const;
type CollectionFilter = (typeof COLLECTIONS)[number];

const ACTIONS = ["All", "create", "update", "delete", "cascade_delete", "cascade_partial", "create_failed", "update_failed", "frontend_error"] as const;
type ActionFilter = (typeof ACTIONS)[number];

const VIA_LABELS: Record<AuditVia, string> = {
  web: "Web",
  "wa-bot": "WhatsApp",
  "ai-agent": "AI chat",
  mcp: "MCP",
};

function viaLabel(via: string | undefined): string {
  if (!via) return "—";
  return VIA_LABELS[via as AuditVia] ?? via;
}

function parseVia(changesJson: string): string | undefined {
  try {
    return JSON.parse(changesJson)?.via;
  } catch {
    return undefined;
  }
}

function summarizeChanges(changesJson: string): string {
  try {
    const c = JSON.parse(changesJson);
    if (c.after && !c.before) return "Created";
    if (c.before && c.after) {
      const keys = Object.keys(c.after);
      return keys.length === 1 ? `${keys[0]} changed` : `${keys.length} fields changed`;
    }
    return "—";
  } catch {
    return "—";
  }
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
            value === opt
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-transparent text-muted-foreground border-border hover:border-indigo-400 hover:text-foreground"
          )}
        >
          {opt === "All" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>("All");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("All");
  const [viaFilter, setViaFilter] = useState<string>("all");
  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    startTransition(() => {
      const col = collectionFilter === "All" ? undefined : collectionFilter;
      setLoading(true);
      listAuditLog({ collection: col, limit: 50 })
        .then((data) => setEntries(data))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((err: any) => { if (!err?.isAbort) console.error(err); })
        .finally(() => setLoading(false));
    });
  }, [collectionFilter]);

  async function handleExport() {
    setExporting(true);
    try {
      const allRows = await pb.collection("audit_log").getFullList({ sort: "-created", requestKey: "audit-export-all" });
      const filteredAll = viaFilter !== "all"
        ? allRows.filter((r) => {
            try { return JSON.parse((r as unknown as AuditLog).changes)?.via === viaFilter; } catch { return false; }
          })
        : allRows;
      exportAuditLogCsv(filteredAll as unknown as AuditLog[]);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const filtered = entries.filter((e) => {
    if (actionFilter !== "All" && e.action !== actionFilter) return false;
    if (viaFilter !== "all" && parseVia(e.changes) !== viaFilter) return false;
    return true;
  });

  const actorLabel = (e: AuditLog) => {
    const u = e.expand?.actor;
    if (u?.name) return u.name;
    if (u?.email) return u.email;
    return e.actor || "—";
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
            Administration
          </p>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ScrollText className="h-6 w-6" />
            Audit Log
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Collection</p>
          <ChipGroup
            options={COLLECTIONS}
            value={collectionFilter}
            onChange={setCollectionFilter}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Action</p>
          <ChipGroup
            options={ACTIONS}
            value={actionFilter}
            onChange={setActionFilter}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Source</p>
          <Select value={viaFilter} onValueChange={setViaFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="wa-bot">WhatsApp</SelectItem>
              <SelectItem value="ai-agent">AI chat</SelectItem>
              <SelectItem value="mcp">MCP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">&nbsp;</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              : <Download className="h-4 w-4 mr-1.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          heading="No audit entries"
          body="No log entries match the current filters."
        />
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {filtered.map((e) => (
              <div
                key={e.id}
                className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setSelected(e)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{formatDate(e.created)}</p>
                    <p className="text-sm font-medium truncate">{actorLabel(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.collection_name} · {e.record_id}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      e.action === "create" ? "bg-emerald-100 text-emerald-700" :
                      e.action === "update" ? "bg-blue-100 text-blue-700" :
                      "bg-red-100 text-red-700"
                    )}>
                      {e.action}
                    </span>
                    <span className="text-xs text-muted-foreground underline">
                      {summarizeChanges(e.changes)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium text-muted-foreground">Timestamp</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Actor</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Collection</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Record ID</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Action</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b last:border-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setSelected(e)}
                    >
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(e.created)}</td>
                      <td className="p-3 font-medium max-w-[160px] truncate">{actorLabel(e)}</td>
                      <td className="p-3">{e.collection_name}</td>
                      <td className="p-3 text-muted-foreground font-mono text-xs max-w-[100px] truncate">{e.record_id}</td>
                      <td className="p-3">
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          e.action === "create" ? "bg-emerald-100 text-emerald-700" :
                          e.action === "update" ? "bg-blue-100 text-blue-700" :
                          "bg-red-100 text-red-700"
                        )}>
                          {e.action}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {viaLabel(parseVia(e.changes))}
                      </td>
                      <td className="p-3">
                        <button className="text-xs text-indigo-600 hover:text-indigo-800 underline underline-offset-2">
                          {summarizeChanges(e.changes)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Changes dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Changes — {selected?.collection_name} / {selected?.record_id}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-slate-950 text-slate-100 p-4 rounded-md overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
            {selected
              ? (() => {
                  try {
                    return JSON.stringify(JSON.parse(selected.changes), null, 2);
                  } catch {
                    return selected.changes;
                  }
                })()
              : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
