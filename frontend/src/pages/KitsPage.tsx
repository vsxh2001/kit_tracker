import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { KitFormDialog } from "../components/KitFormDialog";
import { listKits, getLatestTransaction } from "../services/kits";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { Kit, Transaction } from "../types";

interface KitRow {
  kit: Kit;
  latest?: Transaction;
}

export function KitsPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<KitRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const kits = await listKits();
      const withLatest = await Promise.all(
        kits.map(async (kit) => ({
          kit,
          latest: (await getLatestTransaction(kit.id)) ?? undefined,
        }))
      );
      setRows(withLatest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  const filtered = rows.filter((r) =>
    r.kit.serial.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{rows.length} kit{rows.length !== 1 ? "s" : ""} registered</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            New kit
          </Button>
        )}
      </div>

      <Input
        placeholder="Search by serial…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs"
      />

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">No kits found.</p>
          )}

          {/* Mobile card list */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map(({ kit, latest }) => (
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
                      <span className="tabular-nums shrink-0 ml-2">{latest ? formatDate(latest.timestamp) : "—"}</span>
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
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Serial</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Current entity</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Last moved</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Notes</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ kit, latest }) => (
                      <tr key={kit.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors group">
                        <td className="px-4 py-3 font-mono font-medium text-xs tracking-wide text-indigo-700">{kit.serial}</td>
                        <td className="px-4 py-3">
                          {latest?.expand?.to_entity?.name ? (
                            <Badge variant="secondary">{latest.expand.to_entity.name}</Badge>
                          ) : (
                            <span className="text-muted-foreground opacity-40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                          {latest ? formatDate(latest.timestamp) : <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                          {kit.notes ?? <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/kits/${kit.id}`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ArrowRight className="h-3.5 w-3.5" />
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
        </>
      )}

      <KitFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={load}
      />
    </div>
  );
}
