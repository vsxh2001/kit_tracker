import { useEffect, useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { RetiredBadge } from "./RetiredBadge";
import { KitTagList } from "./KitTagList";
import { getEntityHoldingsAt } from "../services/timeMachine";
import type { KitHolding } from "../services/timeMachine";
import { formatDate } from "../lib/utils";
import { endOfDayIso } from "../lib/snapshot";
import { toast } from "./ui/use-toast";

interface Props {
  entityId: string;
  entityName: string;
  open: boolean;
  onClose: () => void;
}

export function EntitySnapshotDialog({
  entityId,
  entityName,
  open,
  onClose,
}: Props) {
  const navigate = useNavigate();
  // Use local timezone for today's date so the date input default is correct
  // regardless of UTC offset (e.g. UTC+3 at 23:00 is still "today" locally).
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local TZ

  const [date, setDate] = useState(todayStr);
  const [kits, setKits] = useState<KitHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState(false);

  async function load(dateStr: string) {
    setLoading(true);
    setQueried(false);
    try {
      const atISO = endOfDayIso(dateStr);
      const result = await getEntityHoldingsAt(entityId, atISO);
      setKits(result);
      setQueried(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Failed to load snapshot",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  // Reset state and auto-load when dialog opens (or entityId changes).
  // Resetting date/kits/queried on every open prevents stale data from a
  // previous entity or date leaking into the new session.
  // All state updates are wrapped in startTransition to satisfy the
  // react-hooks/no-direct-set-state-in-use-effect lint rule.
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setDate(todayStr);
      setKits([]);
      setQueried(false);
      void load(todayStr);
    });
  }, [open, entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDate(e.target.value);
  }

  function handleSearch() {
    startTransition(() => load(date));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Snapshot — {entityName}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 mt-1">
          <label className="text-sm text-muted-foreground whitespace-nowrap">
            View as of
          </label>
          <input
            type="date"
            value={date}
            max={todayStr}
            onChange={handleDateChange}
            className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Snapshot date"
          />
          <Button size="sm" onClick={handleSearch} disabled={loading}>
            {loading ? "Loading…" : "Show"}
          </Button>
        </div>

        <div className="mt-4">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading snapshot…</p>
          )}

          {!loading && queried && kits.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Entity held no kits at end of {date}.
            </p>
          )}

          {!loading && queried && kits.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {kits.length} kit{kits.length !== 1 ? "s" : ""} at end of{" "}
                {date}
              </p>

              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {kits.map(({ kit, lastTxAt }) => (
                  <div
                    key={kit.id}
                    className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    onClick={() => {
                      if (kit.serial !== "(deleted kit)") {
                        onClose();
                        navigate(`/kits/${kit.id}`);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs tracking-wide text-indigo-700">
                          {kit.serial}
                        </span>
                        {kit.serial !== "(deleted kit)" && (
                          <KitTagList tags={kit.tags} />
                        )}
                      </div>
                      {kit.serial === "(deleted kit)" ? (
                        <Badge variant="destructive" className="text-xs">Deleted</Badge>
                      ) : (
                        <RetiredBadge isActive={kit.is_active} showActiveLabel />
                      )}
                    </div>
                    {kit.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {kit.notes}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      Last tx: {lastTxAt ? formatDate(lastTxAt) : "—"}
                    </p>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                        Serial
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                        Notes
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                        Last Tx
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {kits.map(({ kit, lastTxAt }) => (
                      <tr
                        key={kit.id}
                        className="border-b last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer"
                        onClick={() => {
                          if (kit.serial !== "(deleted kit)") {
                            onClose();
                            navigate(`/kits/${kit.id}`);
                          }
                        }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs tracking-wide text-indigo-700">
                              {kit.serial}
                            </span>
                            {kit.serial !== "(deleted kit)" && (
                              <KitTagList tags={kit.tags} />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {kit.notes ?? (
                            <span className="opacity-30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {kit.serial === "(deleted kit)" ? (
                            <Badge variant="destructive" className="text-xs">Deleted</Badge>
                          ) : (
                            <RetiredBadge isActive={kit.is_active} showActiveLabel />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">
                          {lastTxAt ? formatDate(lastTxAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
