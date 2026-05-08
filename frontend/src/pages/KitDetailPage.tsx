import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { MoveKitDialog } from "../components/MoveKitDialog";
import { KitFormDialog } from "../components/KitFormDialog";
import { getKit, getKitHistory, updateKit } from "../services/kits";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { Kit, Transaction } from "../types";

export function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [kit, setKit] = useState<Kit | null>(null);
  const [latest, setLatest] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    try {
      const [k, h] = await Promise.all([getKit(id), getKitHistory(id)]);
      setKit(k);
      setHistory(h);
      setLatest(h[0] ?? null);
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleRetire() {
    if (!kit || !confirm(`Retire ${kit.serial}?`)) return;
    try {
      await updateKit(kit.id, { is_active: false });
      navigate("/kits");
    } catch (err: any) {
      console.error(err);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!kit) return <p>Kit not found.</p>;

  const currentEntity = latest?.expand?.to_entity;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/kits")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold font-mono">{kit.serial}</h1>
        {!kit.is_active && <Badge variant="destructive">Retired</Badge>}
      </div>

      {/* Info card */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Serial" value={kit.serial} mono />
            <Row label="Notes" value={kit.notes ?? "—"} />
            <Row label="Current location" value={currentEntity?.name ?? "Unknown"} />
            {latest && <Row label="Last moved" value={formatDate(latest.timestamp)} />}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setShowMove(true)}>
                <ArrowRight className="h-4 w-4" />
                Move kit
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              {kit.is_active && (
                <Button size="sm" variant="destructive" onClick={handleRetire}>
                  Retire kit
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Transaction history */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Transaction history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions.</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">From</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">To</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Notes</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((tx) => (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(tx.timestamp)}
                      </td>
                      <td className="p-3">{tx.expand?.from_entity?.name ?? "—"}</td>
                      <td className="p-3 font-medium">{tx.expand?.to_entity?.name ?? tx.to_entity}</td>
                      <td className="p-3 text-muted-foreground">{tx.notes ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">
                        {tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <MoveKitDialog
        kit={kit}
        currentEntityId={currentEntity?.id}
        currentEntityName={currentEntity?.name}
        open={showMove}
        onClose={() => setShowMove(false)}
        onMoved={load}
      />
      <KitFormDialog
        kit={kit}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={load}
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono" : ""}>{value}</p>
    </div>
  );
}
