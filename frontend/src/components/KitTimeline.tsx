import { useEffect, useState, startTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Trash } from "lucide-react";
import { listTransactionsForKit, getTransactionVia } from "../services/transactions";
import { formatDate, formatDateOnly, entityTimelineColor } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { CascadeDeleteDialog } from "./CascadeDeleteDialog";
import type { AuditVia, Transaction } from "../types";

interface Segment {
  entityName: string;
  start: number;
  end: number;
  color: string;
}

interface Props {
  kitId: string;
}

const VIA_LABEL: Record<AuditVia, string> = {
  web: "via Web",
  "wa-bot": "via WhatsApp",
  "ai-agent": "via AI chat",
  mcp: "via MCP",
};

const VIA_STYLE: Record<AuditVia, string> = {
  web: "bg-slate-100 text-slate-600 border border-slate-200",
  "wa-bot": "bg-green-50 text-green-700 border border-green-200",
  "ai-agent": "bg-indigo-50 text-indigo-700 border border-indigo-200",
  mcp: "bg-amber-50 text-amber-700 border border-amber-200",
};

function OriginBadge({ via }: { via: AuditVia }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${VIA_STYLE[via]}`}
      data-testid="origin-badge"
      data-via={via}
    >
      {VIA_LABEL[via]}
    </span>
  );
}

export function KitTimeline({ kitId }: Props) {
  const { isAdmin } = useAuth();
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [viaMap, setViaMap] = useState<Record<string, AuditVia>>({});
  const [nowMs, setNowMs] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const fetched = await listTransactionsForKit(kitId);
      setNowMs(Date.now());
      setTxs(fetched);
      const ids = fetched.map((t) => t.id);
      const via = await getTransactionVia(ids);
      setViaMap(via);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [kitId]);

  const totalStart = txs.length > 0 ? new Date(txs[0].timestamp).getTime() : 0;
  const totalEnd = nowMs > 0 ? nowMs : totalStart + 1;
  const totalDuration = totalEnd - totalStart;

  const segments: Segment[] = txs.map((tx, i) => {
    const segStart = new Date(tx.timestamp).getTime();
    const segEnd = txs[i + 1] ? new Date(txs[i + 1].timestamp).getTime() : totalEnd;
    const entityName = tx.expand?.to_entity?.name ?? tx.to_entity;
    return {
      entityName,
      start: segStart,
      end: segEnd,
      color: entityTimelineColor(entityName),
    };
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Location history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : txs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No location history yet</p>
        ) : (
          <>
            <div className="relative h-12 w-full bg-muted rounded-md overflow-hidden">
              {segments.map((seg, i) => {
                const leftPct = ((seg.start - totalStart) / totalDuration) * 100;
                const widthPct = ((seg.end - seg.start) / totalDuration) * 100;
                const durationDays = Math.round(
                  (seg.end - seg.start) / (1000 * 60 * 60 * 24)
                );
                const durationLabel =
                  durationDays === 1 ? "1 day" : `${durationDays} days`;
                const tooltipText = `${seg.entityName} · ${durationLabel} (${formatDateOnly(new Date(seg.start).toISOString())} → ${formatDateOnly(new Date(seg.end).toISOString())})`;
                return (
                  <div
                    key={i}
                    className={`absolute top-0 h-full flex items-center justify-center text-xs font-medium text-white overflow-hidden ${seg.color}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={tooltipText}
                    data-testid="timeline-segment"
                    data-entity={seg.entityName}
                  >
                    <span className="truncate px-1">{seg.entityName}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1 font-mono text-[10px] text-muted-foreground tabular-nums">
              <span>{formatDateOnly(new Date(totalStart).toISOString())}</span>
              <span>{formatDateOnly(new Date(totalEnd).toISOString())}</span>
            </div>

            {/* Transaction rows with origin badges */}
            <div className="mt-4 space-y-2">
              {[...txs].reverse().map((tx) => {
                const via = viaMap[tx.id] as AuditVia | undefined;
                const actor =
                  tx.expand?.created_by?.name ??
                  tx.expand?.created_by?.email ??
                  "";
                const from = tx.expand?.from_entity?.name;
                const to = tx.expand?.to_entity?.name ?? tx.to_entity;
                return (
                  <div
                    key={tx.id}
                    className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0"
                  >
                    <div className="flex-1 flex flex-col gap-0.5">
                      <div className="text-sm font-medium">
                        {from ? (
                          <>
                            {from} → {to}
                          </>
                        ) : (
                          to
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {formatDate(tx.timestamp)}
                        </span>
                        {actor && <span>· {actor}</span>}
                        {via && <OriginBadge via={via} />}
                      </div>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletingTxId(tx.id)}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>

      <CascadeDeleteDialog
        open={!!deletingTxId}
        onOpenChange={(open) => { if (!open) setDeletingTxId(null); }}
        collection="transactions"
        recordId={deletingTxId ?? ""}
        onDeleted={() => {
          setDeletingTxId(null);
          startTransition(() => load());
        }}
      />
    </Card>
  );
}
