import { useEffect, useState, startTransition } from "react";
import { Navigate, Link } from "react-router-dom";
import { CalendarClock, ChevronLeft, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { toast } from "../components/ui/use-toast";
import {
  listScheduledBroadcasts,
  deleteScheduledBroadcast,
  updateScheduledBroadcast,
} from "../services/scheduledBroadcasts";
import { ScheduledBroadcastDialog } from "../components/ScheduledBroadcastDialog";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { ScheduledBroadcast } from "../types";

export function WhatsAppScheduledBroadcastsPage() {
  const { isAdmin, loading: authLoading, user } = useAuth();
  const [schedules, setSchedules] = useState<ScheduledBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledBroadcast | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledBroadcast | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setSchedules(await listScheduledBroadcasts());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  async function handleToggleEnabled(sched: ScheduledBroadcast) {
    setToggling(sched.id);
    try {
      await updateScheduledBroadcast(sched.id, { enabled: !sched.enabled });
      setSchedules((prev) =>
        prev.map((s) => s.id === sched.id ? { ...s, enabled: !s.enabled } : s)
      );
      toast({
        title: sched.enabled ? "Schedule disabled" : "Schedule enabled",
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to update schedule",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteScheduledBroadcast(deleteTarget.id);
      setSchedules((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      toast({ title: "Schedule deleted", variant: "success" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to delete schedule",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteTarget(null);
    }
  }

  function parseLastResult(raw: string): { successCount?: number; totalRecipients?: number; failed?: unknown[] } | null {
    try {
      return JSON.parse(raw || "null");
    } catch {
      return null;
    }
  }

  function parseRecipientLabel(raw: string): string {
    try {
      const rf = JSON.parse(raw || "{}");
      if (rf.type === "role") return `Role: ${rf.value}`;
      if (rf.type === "phones") {
        const count = Array.isArray(rf.value) ? rf.value.length : 0;
        return `${count} phone${count !== 1 ? "s" : ""}`;
      }
    } catch {
      // ignore
    }
    return "—";
  }

  function parseMsgLabel(raw: string): string {
    try {
      const msg = JSON.parse(raw || "{}");
      if (msg.type === "text") {
        const preview = (msg.text || "").slice(0, 40);
        return preview.length < (msg.text || "").length ? preview + "…" : preview;
      }
      if (msg.type === "template") return `Template: ${msg.template?.name ?? "?"}`;
    } catch {
      // ignore
    }
    return "—";
  }

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <Link
            to="/settings/whatsapp"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to WhatsApp settings"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <CalendarClock className="h-6 w-6 text-emerald-500 shrink-0" />
          <h1 className="text-xl font-semibold tracking-tight">Scheduled Broadcasts</h1>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        >
          <Plus className="h-4 w-4" />
          New schedule
        </Button>
      </div>

      {/* Schedule list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No scheduled broadcasts yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((sched) => {
            const lastResult = parseLastResult(sched.last_result);
            return (
              <Card key={sched.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CardTitle className="text-base truncate">{sched.name}</CardTitle>
                      <Badge variant={sched.enabled ? "success" : "gray"} className="shrink-0">
                        {sched.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleEnabled(sched)}
                        disabled={toggling === sched.id}
                        className="p-1.5 rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title={sched.enabled ? "Disable" : "Enable"}
                      >
                        {sched.enabled ? (
                          <X className="h-4 w-4" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => { setEditing(sched); setDialogOpen(true); }}
                        className="p-1.5 rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(sched)}
                        className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide mr-1">Cron</span>
                      <span className="font-mono text-xs">{sched.cron_expression}</span>
                    </span>
                    <span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide mr-1">To</span>
                      {parseRecipientLabel(sched.recipient_filter)}
                    </span>
                    <span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide mr-1">Msg</span>
                      {parseMsgLabel(sched.message)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last run:{" "}
                    {sched.last_run_at
                      ? <span className="text-foreground">{formatDate(sched.last_run_at)}</span>
                      : "never"}
                    {lastResult && sched.last_run_at && (
                      <span className="ml-2">
                        — {lastResult.successCount ?? 0}/{lastResult.totalRecipients ?? 0} sent
                        {Array.isArray(lastResult.failed) && lastResult.failed.length > 0 && (
                          <span className="text-red-500 ml-1">({lastResult.failed.length} failed)</span>
                        )}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit dialog */}
      <ScheduledBroadcastDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={() => startTransition(() => load())}
        initial={editing}
        currentUserId={user?.id}
      />

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
