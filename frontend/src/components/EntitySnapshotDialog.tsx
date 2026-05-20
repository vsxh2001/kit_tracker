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
import { getEntityHoldingsAt } from "../services/timeMachine";
import { formatDate } from "../lib/utils";
import { endOfDayIso } from "../lib/snapshot";
import type { Kit } from "../types";

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
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const [date, setDate] = useState(todayStr);
  const [kits, setKits] = useState<Kit[]>([]);
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
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) startTransition(() => load(date));
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
                {kits.map((kit) => (
                  <div
                    key={kit.id}
                    className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    onClick={() => { onClose(); navigate(`/kits/${kit.id}`); }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs tracking-wide text-indigo-700">
                        {kit.serial}
                      </span>
                      {kit.is_active ? (
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Retired</Badge>
                      )}
                    </div>
                    {kit.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {kit.notes}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      Last tx: {formatDate(kit.updated)}
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
                    </tr>
                  </thead>
                  <tbody>
                    {kits.map((kit) => (
                      <tr
                        key={kit.id}
                        className="border-b last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer"
                        onClick={() => { onClose(); navigate(`/kits/${kit.id}`); }}
                      >
                        <td className="px-4 py-3 font-mono text-xs tracking-wide text-indigo-700">
                          {kit.serial}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {kit.notes ?? (
                            <span className="opacity-30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {kit.is_active ? (
                            <Badge variant="outline" className="text-xs">Active</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Retired</Badge>
                          )}
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
