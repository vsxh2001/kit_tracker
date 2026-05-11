import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileX } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { getRequest, updateRequestStatus, fulfillRequest, deleteRequest } from "../services/requests";
import { listKits } from "../services/kits";
import { listEntities } from "../services/entities";
import { useAuth } from "../context/AuthContext";
import { formatDateOnly, REQUEST_STATUS_VARIANTS } from "../lib/utils";
import { RequestFormDialog } from "../components/RequestFormDialog";
import { toast } from "../components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import type { KitRequest, Kit, Entity } from "../types";

type ConfirmKind = "delete" | "cancel";

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, canDecideRequests, user } = useAuth();
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
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);

  async function load() {
    if (!id) return;
    try {
      const [r, k, e] = await Promise.all([getRequest(id), listKits(), listEntities()]);
      setRequest(r);
      setKits(k);
      setEntities(e);
      setAssignKit(r.designated_kit ?? "none");
      setAssignEntity(r.target_entity ?? "none");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  const assignmentDirty =
    request != null &&
    ((assignKit === "none" ? undefined : assignKit) !== (request.designated_kit || undefined) ||
      (assignEntity === "none" ? undefined : assignEntity) !== (request.target_entity || undefined));

  async function doAction(action: () => Promise<unknown>, successMsg?: string) {
    setError("");
    setActionLoading(true);
    try {
      await action();
      if (successMsg) toast({ title: successMsg, variant: "success" });
      await load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const msg = e?.message ?? "Action failed.";
      setError(msg);
      toast({ title: "Action failed", description: msg, variant: "destructive" });
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
      }),
      "Request approved"
    );
  }

  async function handleReject() {
    doAction(() =>
      updateRequestStatus(id!, "rejected", {
        decision_notes: decisionNotes.trim() || undefined,
      }),
      "Request rejected"
    );
  }

  async function handleFulfill() {
    const kitId = assignKit === "none" ? undefined : assignKit;
    if (!kitId) {
      const msg = "Assign a kit before fulfilling.";
      setError(msg);
      toast({ title: msg, variant: "destructive" });
      return;
    }
    doAction(async () => {
      if (assignmentDirty) {
        await updateRequestStatus(id!, request!.status, {
          designated_kit: kitId,
          target_entity: assignEntity === "none" ? undefined : assignEntity,
        });
      }
      const fresh = await getRequest(id!);
      await fulfillRequest(fresh);
    }, "Request fulfilled");
  }

  async function handleCancel() {
    setConfirmKind(null);
    doAction(() => updateRequestStatus(id!, "cancelled"), "Request cancelled");
  }

  async function handleSaveAssignment() {
    doAction(() =>
      updateRequestStatus(id!, request!.status, {
        designated_kit: assignKit === "none" ? undefined : assignKit,
        target_entity: assignEntity === "none" ? undefined : assignEntity,
      }),
      "Assignment saved"
    );
  }

  async function handleDelete() {
    setConfirmKind(null);
    setError("");
    setActionLoading(true);
    try {
      await deleteRequest(id!);
      toast({ title: "Request deleted", variant: "success" });
      navigate("/requests");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const msg = e?.message ?? "Delete failed.";
      setError(msg);
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!request) return (
    <EmptyState
      icon={FileX}
      heading="Request not found"
      body="It may have been deleted or you don't have access."
      cta={{ label: "Back to requests", href: "/requests" }}
    />
  );

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

        {/* Decision actions (admin + technician) */}
        {canDecideRequests && request.status !== "fulfilled" && request.status !== "cancelled" && request.status !== "rejected" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
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
                  <Button
                    size="sm"
                    onClick={handleFulfill}
                    disabled={actionLoading}
                    title={assignmentDirty ? "Saves assignment, then fulfills" : undefined}
                  >
                    {assignmentDirty ? "Save & Fulfill" : "Fulfill"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveAssignment}
                  disabled={actionLoading || !assignmentDirty}
                >
                  Save assignment
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={actionLoading}>
                  Edit request
                </Button>
                {isAdmin && (
                  <Button size="sm" variant="destructive" onClick={() => setConfirmKind("delete")} disabled={actionLoading}>
                    Delete request
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Admin delete — shown for fulfilled/cancelled/rejected where admin actions card is hidden */}
        {isAdmin && (request.status === "fulfilled" || request.status === "cancelled" || request.status === "rejected") && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Danger zone</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" onClick={() => setConfirmKind("delete")} disabled={actionLoading}>
                Delete request
              </Button>
            </CardContent>
          </Card>
        )}

        {/* User actions (cancel + edit) — shown only to requester when not a decision-maker */}
        {isOwner && !canDecideRequests && request.status === "open" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={actionLoading}>
                Edit request
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setConfirmKind("cancel")} disabled={actionLoading}>
                Cancel request
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setConfirmKind("delete")} disabled={actionLoading}>
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
        showKitField={canDecideRequests}
      />

      <AlertDialog open={confirmKind !== null} onOpenChange={(o) => !o && setConfirmKind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmKind === "delete" ? "Delete this request?" : "Cancel this request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmKind === "delete"
                ? "This permanently removes the request. Cannot be undone."
                : "Mark this request as cancelled. You can no longer fulfill it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmKind === "delete" ? handleDelete : handleCancel}
            >
              {confirmKind === "delete" ? "Delete" : "Cancel request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
