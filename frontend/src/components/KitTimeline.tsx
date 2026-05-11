import { useEffect, useState, startTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { listTransactionsForKit } from "../services/transactions";
import { formatDateOnly, entityTimelineColor } from "../lib/utils";
import type { Transaction } from "../types";

interface Segment {
  entityName: string;
  start: number;
  end: number;
  color: string;
}

interface Props {
  kitId: string;
}

export function KitTimeline({ kitId }: Props) {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [nowMs, setNowMs] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const fetched = await listTransactionsForKit(kitId);
      setNowMs(Date.now());
      setTxs(fetched);
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
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Location history</CardTitle>
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
                const durationDays = Math.round((seg.end - seg.start) / (1000 * 60 * 60 * 24));
                const durationLabel = durationDays === 1 ? "1 day" : `${durationDays} days`;
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
