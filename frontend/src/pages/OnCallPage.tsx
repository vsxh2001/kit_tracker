import { useEffect, useState, startTransition } from "react";
import { Clock, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { AddShiftDialog } from "../components/AddShiftDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { listShifts, deleteShift } from "../services/oncall";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import type { OnCallShift } from "../types";

function shiftStatus(shift: OnCallShift): "Active" | "Upcoming" | "Past" {
  const now = new Date();
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  if (start <= now && now <= end) return "Active";
  if (start > now) return "Upcoming";
  return "Past";
}

function StatusBadge({ status }: { status: "Active" | "Upcoming" | "Past" }) {
  const classes =
    status === "Active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "Upcoming"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const classes =
    role === "admin"
      ? "bg-amber-100 text-amber-700"
      : role === "technician"
      ? "bg-sky-100 text-sky-700"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {role}
    </span>
  );
}

export function OnCallPage() {
  const { canDecideRequests } = useAuth();
  const [shifts, setShifts] = useState<OnCallShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShift, setEditShift] = useState<OnCallShift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OnCallShift | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setShifts(await listShifts({ sort: "-start_at" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteShift(deleteTarget.id);
      toast({ title: "Shift deleted", variant: "success" });
      setDeleteTarget(null);
      startTransition(() => load());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast({ title: "Failed to delete", description: e?.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Operations</p>
          <h1 className="text-2xl font-semibold tracking-tight">On-Call</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Scheduled on-call shifts</p>
        </div>
        {canDecideRequests && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            Add shift
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={Clock}
          heading="No on-call shifts scheduled"
          body="Add a shift to track who is on call."
          cta={canDecideRequests ? { label: "Add shift", onClick: () => setAddOpen(true) } : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left">Start</th>
                      <th className="px-4 py-3 text-left">End</th>
                      <th className="px-4 py-3 text-left">Notes</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      {canDecideRequests && <th className="px-4 py-3 text-left">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shifts.map((s) => {
                      const u = s.expand?.user;
                      const status = shiftStatus(s);
                      return (
                        <tr key={s.id} className="hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-medium">{u?.name || u?.email || s.user}</span>
                            {u?.role && (
                              <span className="ml-2"><RoleBadge role={u.role} /></span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(s.start_at)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(s.end_at)}</td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">{s.notes}</td>
                          <td className="px-4 py-3"><StatusBadge status={status} /></td>
                          {canDecideRequests && (
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setEditShift(s)}
                                  aria-label="Edit shift"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(s)}
                                  aria-label="Delete shift"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {shifts.map((s) => {
              const u = s.expand?.user;
              const status = shiftStatus(s);
              return (
                <Card key={s.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{u?.name || u?.email || s.user}</span>
                        {u?.role && <RoleBadge role={u.role} />}
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Start: {formatDate(s.start_at)}</p>
                      <p>End: {formatDate(s.end_at)}</p>
                      {s.notes && <p>Notes: {s.notes}</p>}
                    </div>
                    {canDecideRequests && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1"
                          onClick={() => setEditShift(s)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <AddShiftDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => startTransition(() => load())}
      />

      <AddShiftDialog
        open={!!editShift}
        shift={editShift}
        onClose={() => setEditShift(null)}
        onSaved={() => startTransition(() => load())}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the on-call shift. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
