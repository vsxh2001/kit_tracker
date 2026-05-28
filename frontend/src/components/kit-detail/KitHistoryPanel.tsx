import { useState } from "react";
import { Card, CardContent } from "../ui/card";
import { KitCalendar } from "../KitCalendar";
import { formatDate } from "../../lib/utils";
import type { AuditVia, Transaction } from "../../types";

const VIA_BADGE: Record<AuditVia, { label: string; className: string }> = {
  "wa-bot":      { label: "WhatsApp", className: "bg-green-100 text-green-800" },
  "wa-meta-bot": { label: "WhatsApp", className: "bg-green-100 text-green-800" },
  "ai-agent":    { label: "AI chat",  className: "bg-purple-100 text-purple-800" },
  mcp:           { label: "MCP",      className: "bg-blue-100 text-blue-800" },
  web:           { label: "Web",      className: "bg-slate-100 text-slate-600" },
};

function OriginBadge({ via }: { via: string }) {
  const cfg = VIA_BADGE[via as AuditVia];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${cfg?.className ?? "bg-slate-100 text-slate-600"}`}>
      {cfg?.label ?? via}
    </span>
  );
}

interface KitHistoryPanelProps {
  kitId: string;
  kitIsActive: boolean;
  history: Transaction[];
  viaMap?: Record<string, AuditVia>;
}

export function KitHistoryPanel({ kitId, kitIsActive, history, viaMap = {} }: KitHistoryPanelProps) {
  const [tab, setTab] = useState<"history" | "calendar">("history");

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1 rounded-md border bg-white p-0.5">
          <button
            onClick={() => setTab("history")}
            className={[
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              tab === "history"
                ? "bg-indigo-600 text-white"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            History
          </button>
          <button
            onClick={() => setTab("calendar")}
            className={[
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              tab === "calendar"
                ? "bg-indigo-600 text-white"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            Calendar
          </button>
        </div>
        {tab === "history" && (
          <span className="text-xs text-muted-foreground">
            {history.length} record{history.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {tab === "calendar" ? (
        <KitCalendar kitId={kitId} kitIsActive={kitIsActive} />
      ) : (
        <>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions.</p>
          ) : (
            <>
              <div className="md:hidden space-y-2">
                {history.map((tx) => (
                  <div key={tx.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {formatDate(tx.timestamp)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {viaMap[tx.id] && <OriginBadge via={viaMap[tx.id]} />}
                        <span className="text-xs text-muted-foreground">
                          {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? ""}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      {tx.expand?.from_entity?.name ?? "—"} → {tx.expand?.to_entity?.name ?? tx.to_entity}
                    </div>
                    {tx.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5">{tx.notes}</p>
                    )}
                  </div>
                ))}
              </div>

              <Card className="overflow-hidden hidden md:block">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">From</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">To</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Notes</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Via</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono text-xs tabular-nums">
                            {formatDate(tx.timestamp)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {tx.expand?.from_entity?.name ?? <span className="opacity-30">—</span>}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {tx.expand?.to_entity?.name ?? tx.to_entity}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                            <span className="line-clamp-2">
                              {tx.notes ?? <span className="opacity-30">—</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {viaMap[tx.id]
                              ? <OriginBadge via={viaMap[tx.id]} />
                              : <span className="opacity-30">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? (
                              <span className="opacity-30">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
