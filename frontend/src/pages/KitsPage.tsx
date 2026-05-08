import { useEffect, useState } from "react";
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
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) =>
    r.kit.serial.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Kits</h1>
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
        className="max-w-xs"
      />

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-muted-foreground">Serial</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Current entity</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Last moved</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Notes</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      No kits found.
                    </td>
                  </tr>
                )}
                {filtered.map(({ kit, latest }) => (
                  <tr key={kit.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 font-mono font-medium">{kit.serial}</td>
                    <td className="p-3">
                      {latest?.expand?.to_entity?.name ? (
                        <Badge variant="secondary">{latest.expand.to_entity.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {latest ? formatDate(latest.timestamp) : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                      {kit.notes ?? "—"}
                    </td>
                    <td className="p-3">
                      <Link to={`/kits/${kit.id}`}>
                        <Button variant="ghost" size="icon">
                          <ArrowRight className="h-4 w-4" />
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

      <KitFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={load}
      />
    </div>
  );
}
