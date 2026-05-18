import { useState, useEffect, startTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { createShift, updateShift } from "../services/oncall";
import { listUsers } from "../services/users";
import { toast } from "./ui/use-toast";
import type { OnCallShift, PBUser } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided — edit mode */
  shift?: OnCallShift | null;
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  // PB stores as "YYYY-MM-DD HH:MM:SS.sssZ" or ISO string
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // datetime-local takes/displays LOCAL time as YYYY-MM-DDTHH:MM.
  // toISOString() returned UTC parts → input mislabeled them as local →
  // edit-with-no-change silently shifted timestamps by the local offset.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddShiftDialog({ open, onClose, onSaved, shift }: Props) {
  const isEdit = !!shift;
  const [userId, setUserId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [notes, setNotes] = useState("");
  const [eligibleUsers, setEligibleUsers] = useState<PBUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const all = await listUsers();
      setEligibleUsers(all.filter((u) => u.role === "admin" || u.role === "technician"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (open) {
      startTransition(() => loadUsers());
      startTransition(() => {
        if (shift) {
          setUserId(shift.user);
          setStartAt(toDatetimeLocal(shift.start_at));
          setEndAt(toDatetimeLocal(shift.end_at));
          setNotes(shift.notes ?? "");
        } else {
          setUserId("");
          setStartAt("");
          setEndAt("");
          setNotes("");
        }
        setError("");
      });
    }
  }, [open, shift]);

  function reset() {
    setUserId("");
    setStartAt("");
    setEndAt("");
    setNotes("");
    setError("");
  }

  async function handleSave() {
    if (!userId) { setError("Select a user."); return; }
    if (!startAt) { setError("Start date/time is required."); return; }
    if (!endAt) { setError("End date/time is required."); return; }
    if (endAt <= startAt) { setError("End must be after start."); return; }
    setError("");
    setSaving(true);
    try {
      const startISO = new Date(startAt).toISOString();
      const endISO = new Date(endAt).toISOString();
      if (isEdit && shift) {
        await updateShift(shift.id, { userId, startAt: startISO, endAt: endISO, notes: notes.trim() });
        toast({ title: "Shift updated", variant: "success" });
      } else {
        await createShift({ userId, startAt: startISO, endAt: endISO, notes: notes.trim() });
        toast({ title: "Shift created", variant: "success" });
      }
      reset();
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to save shift.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) { reset(); onClose(); }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Shift" : "Add On-Call Shift"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "Edit an existing on-call shift." : "Schedule a new on-call shift."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="shift-user">User</Label>
            <select
              id="shift-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={loadingUsers}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select user…</option>
              {eligibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email} ({u.role})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift-start">Start</Label>
            <Input
              id="shift-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift-end">End</Label>
            <Input
              id="shift-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift-notes">Notes</Label>
            <Textarea
              id="shift-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add shift"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
