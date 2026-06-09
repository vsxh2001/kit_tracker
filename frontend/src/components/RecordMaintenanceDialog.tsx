import { useState } from "react";
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
import { createMaintenanceRecord } from "../services/maintenance";
import { toast } from "./ui/use-toast";
import type { KitMaintenanceSchedule } from "../types";
import { pb } from "../lib/pocketbase";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import { KitTagList } from "./KitTagList";

interface Props {
  schedule: KitMaintenanceSchedule;
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

function addDaysLocal(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.toLocaleDateString("en-CA");
}

export function RecordMaintenanceDialog({ schedule, open, onClose, onRecorded }: Props) {
  const [performedAt, setPerformedAt] = useState(new Date().toLocaleDateString("en-CA"));
  const [notes, setNotes] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setPerformedAt(new Date().toLocaleDateString("en-CA"));
    setNotes("");
    setCertFile(null);
    setError("");
  }

  function computeNextDue(): string {
    return addDaysLocal(performedAt, schedule.interval_days);
  }

  async function handleSubmit() {
    if (!performedAt) { setError("Performed at date is required."); return; }
    setError("");
    setLoading(true);
    try {
      const userId = pb.authStore.model?.id ?? "";
      const nextDue = computeNextDue();

      const fd = new FormData();
      fd.append("schedule", schedule.id);
      fd.append("performed_at", performedAt);
      fd.append("performed_by", userId);
      fd.append("notes", notes.trim());
      fd.append("next_due_snapshot", nextDue);
      if (certFile) {
        fd.append("certificate", certFile);
      }
      await createMaintenanceRecord(fd);
      toast({ title: "Maintenance recorded", description: `${maintenanceTypeLabel(schedule.type)} — next due ${nextDue}`, variant: "success" });
      reset();
      onRecorded();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to save record.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) { reset(); onClose(); }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Record Maintenance — {maintenanceTypeLabel(schedule.type)}
            {schedule.expand?.kit?.serial && (
              <> · <span className="font-mono">{schedule.expand.kit.serial}</span></>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Record that maintenance was performed on this schedule.
          </DialogDescription>
          <KitTagList tags={schedule.expand?.kit?.tags} className="mt-1" />
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-performed-at">Performed at</Label>
            <Input
              id="rec-performed-at"
              type="date"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-notes">Notes</Label>
            <Textarea
              id="rec-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-cert">Certificate (optional)</Label>
            <Input
              id="rec-cert"
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">PDF or image files only.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving…" : "Record done"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
