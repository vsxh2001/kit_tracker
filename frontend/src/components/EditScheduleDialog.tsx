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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { updateSchedule } from "../services/maintenance";
import { toast } from "./ui/use-toast";
import { MAINTENANCE_TYPES, maintenanceTypeLabel } from "../lib/maintenance-types";
import type { KitMaintenanceSchedule, MaintenanceType } from "../types";

interface Props {
  schedule: KitMaintenanceSchedule | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditScheduleDialog({ schedule, onClose, onSaved }: Props) {
  const [type, setType] = useState<MaintenanceType | "">("");
  const [description, setDescription] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [nextDueAt, setNextDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schedule) return;
    startTransition(() => {
      setType(schedule.type);
      setDescription(schedule.description ?? "");
      setIntervalDays(String(schedule.interval_days));
      // PB date can be "YYYY-MM-DD HH:MM:SS..." — slice to 10 for date input
      setNextDueAt(schedule.next_due_at ? schedule.next_due_at.slice(0, 10) : "");
      setNotes(schedule.notes ?? "");
      setError("");
    });
  }, [schedule]);

  function handleOpenChange(v: boolean) {
    if (!v) onClose();
  }

  async function handleSave() {
    if (!schedule) return;
    if (!type) { setError("Type is required."); return; }
    const interval = parseInt(intervalDays, 10);
    if (!interval || interval < 1) { setError("Interval must be at least 1 day."); return; }
    if (!nextDueAt) { setError("Next due date is required."); return; }
    setError("");
    setLoading(true);
    try {
      await updateSchedule(schedule.id, {
        type: type as MaintenanceType,
        description: description.trim(),
        interval_days: interval,
        next_due_at: nextDueAt,
        notes: notes.trim(),
      });
      toast({
        title: "Schedule updated",
        description: maintenanceTypeLabel(type),
        variant: "success",
      });
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to update schedule.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!schedule} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Maintenance Schedule</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the maintenance schedule details. The kit cannot be changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="esched-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as MaintenanceType)}>
              <SelectTrigger id="esched-type">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="esched-desc">Description</Label>
            <Textarea
              id="esched-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the maintenance task…"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="esched-interval">Interval (days)</Label>
            <Input
              id="esched-interval"
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Interval applies to next maintenance forward. Changing it does not retroactively alter the current next due date.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="esched-next-due">Next due at</Label>
            <Input
              id="esched-next-due"
              type="date"
              value={nextDueAt}
              onChange={(e) => setNextDueAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="esched-notes">Notes</Label>
            <Textarea
              id="esched-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
