import { useEffect, useState, startTransition } from "react";
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
import { createSchedule } from "../services/maintenance";
import { listKits } from "../services/kits";
import { toast } from "./ui/use-toast";
import type { Kit } from "../types";

interface Props {
  /** When provided, the kit picker is hidden and this kit is used. */
  kitId?: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddScheduleDialog({ kitId, open, onClose, onSaved }: Props) {
  const showKitPicker = !kitId;
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKitId, setSelectedKitId] = useState("");

  useEffect(() => {
    if (!showKitPicker || !open) return;
    startTransition(() => {
      listKits()
        .then((data) => setKits(data))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((err: any) => { if (!err?.isAbort) console.error(err); });
    });
  }, [showKitPicker, open]);
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [lastDoneAt, setLastDoneAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setType("");
    setDescription("");
    setIntervalDays("30");
    setLastDoneAt("");
    setNotes("");
    setError("");
    setSelectedKitId("");
  }

  function computeNextDue(): string {
    const interval = parseInt(intervalDays, 10) || 0;
    if (lastDoneAt) {
      const base = new Date(lastDoneAt + "T00:00:00");
      base.setDate(base.getDate() + interval);
      return base.toISOString().slice(0, 10);
    }
    // no lastDoneAt → today
    return new Date().toISOString().slice(0, 10);
  }

  async function handleSave() {
    const resolvedKitId = kitId ?? selectedKitId;
    if (showKitPicker && !resolvedKitId) { setError("Kit is required."); return; }
    if (!type.trim()) { setError("Type is required."); return; }
    const interval = parseInt(intervalDays, 10);
    if (!interval || interval < 1) { setError("Interval must be at least 1 day."); return; }
    setError("");
    setLoading(true);
    try {
      await createSchedule({
        kit: resolvedKitId,
        type: type.trim(),
        description: description.trim(),
        interval_days: interval,
        last_done_at: lastDoneAt || "",
        next_due_at: computeNextDue(),
        is_active: true,
        notes: notes.trim(),
      });
      toast({ title: "Schedule created", description: type.trim(), variant: "success" });
      reset();
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to create schedule.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) { reset(); onClose(); }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Maintenance Schedule</DialogTitle>
          <DialogDescription className="sr-only">
            Create a recurring maintenance schedule for this kit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {showKitPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="sched-kit">Kit</Label>
              <select
                id="sched-kit"
                value={selectedKitId}
                onChange={(e) => setSelectedKitId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a kit…</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>{k.serial}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sched-type">Type</Label>
            <Input
              id="sched-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. Calibration, Battery check…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-desc">Description</Label>
            <Textarea
              id="sched-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-interval">Interval (days)</Label>
            <Input
              id="sched-interval"
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-last">Last done at (optional)</Label>
            <Input
              id="sched-last"
              type="date"
              value={lastDoneAt}
              onChange={(e) => setLastDoneAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If blank, next due will be set to today.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-notes">Notes</Label>
            <Textarea
              id="sched-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving…" : "Add schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
