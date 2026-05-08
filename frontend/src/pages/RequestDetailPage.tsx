import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { getRequest, updateRequestStatus, fulfillRequest, deleteRequest } from "../services/requests";
import { getLatestTransaction, listKits } from "../services/kits";
import { listEntities } from "../services/entities";
import { useAuth } from "../context/AuthContext";
import { formatDateOnly, REQUEST_STATUS_VARIANTS } from "../lib/utils";
import { RequestFormDialog } from "../components/RequestFormDialog";
import type { KitRequest, Kit, Entity } from "../types";

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const [request, setRequest] = useState<KitRequest | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [assignKit, setAssignKit] = useState("none");
  const [assignEntity, setAssignEntity] = useState("none");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const [r, k, e] = await Promise.all([getRequest(id), listKits(), listEntities()]);
      setRequest(r);
      setKits(k);
      setEntities(e);
      setAssignKit(r.designated_kit ?? "none");
      setAssignEntity(r.target_entity ?? "none");
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function doAction(action: () => Promise<unknown>) {
    setError("");
    setActionLoading(true);
    try {
      await action();
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove() {
    doAction(() =>
      updateRequestStatus(id!, "approved", {
        decision_notes: decisionNotes.trim() || undefined,
        designated_kit: assignKit === "none" ? undefined : assignKit,
        target_entity: assignEntity === "none" ? undefined : assignEntity,
      })
    );
  }

  async function handleReject() {
    doAction(() =>
      updateRequestStatus(id!, "rejected", {
        decision_notes: decisionNotes.trim() || undefined,
      })
    );
  }

  async function handleFulfill() {
    if (!request?.designated_kit) {
      setError("Assign a kit before fulfilling.");
      return;
    }
    doAction(async () => {
      const latest = await getLatestTransaction(request.designated_kit!);
      await fulfillRequest(request, latest?.to_entity ?? "");
    });
  }

  async function handleCancel() {
    doAction(() => updateRequestStatus(id!, "cancelled"));
  }

  async function handleSaveAssignment() {
    doAction(() =>
      updateRequestStatus(id!, request!.status, {
        designated_kit: assignKit === "none" ? undefined : assignKit,
        target_entity: assignEntity === "none" ? undefined : assignEntity,
      })
    );
  }

  async function handleDelete() {
    if (!window.confirm("Delete this request? This cannot be undone.")) return;
    setError("");
    setActionLoading(true);
    try {
      await deleteRequest(id!);
      navigate("/requests");
    } catch (e: any) {
      setError(e?.message ?? "Delete failed.");
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!request) return <p>Request not found.</p>;

  const isOwner = request.requester === user?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/requests")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">Request</h1>
          <Badge variant={REQUEST_STATUS_VARIANTS[request.status]}>{request.status}</Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="text-sm pt-0">
            <Row label="Requester" value={request.expand?.requester?.name ?? request.expand?.requester?.email ?? "—"} />
            <Row label="Date" value={formatDateOnly(request.date)} />
            <Row label="Status" value={request.status} />
            <Row label="Designated kit" value={request.expand?.designated_kit?.serial ?? "—"} />
            <Row label="Target entity" value={request.expand?.target_entity?.name ?? "—"} />
            <Row label="Expected return" value={request.expected_return ? formatDateOnly(request.expected_return) : "—"} />
            <Row label="Delivery date" value={formatDateOnly(request.delivery_date)} />
            <Row label="Notes" value={request.notes ?? "—"} />
            {request.decision_notes && <Row label="Decision notes" value={request.decision_notes} />}
          </CardContent>
        </Card>

        {/* Admin actions */}
        {isAdmin && request.status !== "fulfilled" && request.status !== "cancelled" && request.status !== "rejected" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Admin actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-1.5">
                <Label>Assign kit</Label>
                <Select value={assignKit} onValueChange={setAssignKit}>
                  <SelectTrigger><SelectValue placeholder="Select kit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {kits.map((k) => (
                      <SelectItem key={k.id} value={k.id}>{k.serial}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Target entity</Label>
                <Select value={assignEntity} onValueChange={setAssignEntity}>
                  <SelectTrigger><SelectValue placeholder="Select entity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Decision notes</Label>
                <Textarea
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Notes for requester…"
                  rows={2}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {request.status === "open" && (
                  <>
                    <Button size="sm" onClick={handleApprove} disabled={actionLoading}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={handleReject} disabled={actionLoading}>Reject</Button>
                  </>
                )}
                {request.status === "approved" && (
                  <Button size="sm" onClick={handleFulfill} disabled={actionLoading}>Fulfill</Button>
                )}
                <Button size="sm" variant="outline" onClick={handleSaveAssignment} disabled={actionLoading}>
                  Save assignment
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={actionLoading}>
                  Edit request
                </Button>
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={actionLoading}>
                  Delete request
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Admin delete — shown for fulfilled/cancelled/rejected where admin actions card is hidden */}
        {isAdmin && (request.status === "fulfilled" || request.status === "cancelled" || request.status === "rejected") && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Admin actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" onClick={handleDelete} disabled={actionLoading}>
                Delete request
              </Button>
            </CardContent>
          </Card>
        )}

        {/* User actions (cancel + edit) — shown only to requester when not admin */}
        {isOwner && !isAdmin && request.status === "open" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={actionLoading}>
                Edit request
              </Button>
              <Button size="sm" variant="destructive" onClick={handleCancel} disabled={actionLoading}>
                Cancel request
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDelete} disabled={actionLoading}>
                Delete request
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <RequestFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); load(); }}
        request={request}
        showKitField={isAdmin}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className="text-sm text-right break-all">{value}</p>
    </div>
  );
}
