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
import { createSchedule } from "../services/maintenance";
import { listKits } from "../services/kits";
import { toast } from "./ui/use-toast";
import type { Kit } from "../types";

// Controlled type vocab — matches PR #5 (worktree-maintenance-ux-phase1).
// Kept inline here to avoid merge race; extract shared primitive after PR #5 lands.
const MAINTENANCE_TYPES = [
  { value: "calibration",   label: "Calibration" },
  { value: "inspection",    label: "Inspection" },
  { value: "service",       label: "Service" },
  { value: "replacement",   label: "Replacement" },
  { value: "certification", label: "Certification" },
  { value: "other",         label: "Other" },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function NewMaintenanceScheduleDialog({ open, onClose, onSaved }: Props) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKitId, setSelectedKitId] = useState("none");
  const [kitSearch, setKitSearch] = useState("");
  const [type, setType] = useState("none");
  const [description, setDescription] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [lastDoneAt, setLastDoneAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      listKits()
        .then((data) => setKits(data))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((err: any) => { if (!err?.isAbort) console.error(err); });
    });
  }, [open]);

  function reset() {
    setSelectedKitId("none");
    setKitSearch("");
    setType("none");
    setDescription("");
    setIntervalDays("30");
    setLastDoneAt("");
    setNotes("");
    setError("");
  }

  function computeNextDue(): string {
    const interval = parseInt(intervalDays, 10) || 0;
    if (lastDoneAt) {
      const base = new Date(lastDoneAt + "T00:00:00");
      base.setDate(base.getDate() + interval);
      return base.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  async function handleSave() {
    if (selectedKitId === "none") { setError("Kit is required."); return; }
    if (type === "none") { setError("Type is required."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    const interval = parseInt(intervalDays, 10);
    if (!interval || interval < 1) { setError("Interval must be at least 1 day."); return; }
    setError("");
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        kit: selectedKitId,
        type,
        description: description.trim(),
        interval_days: interval,
        next_due_at: computeNextDue(),
        is_active: true,
        notes: notes.trim(),
      };
      if (lastDoneAt) payload.last_done_at = lastDoneAt;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await createSchedule(payload as any);
      toast({ title: "Schedule created", description: MAINTENANCE_TYPES.find(t => t.value === type)?.label ?? type, variant: "success" });
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

  function handleOpenChange(v: boolean) {
    if (!v) { reset(); onClose(); }
  }

  const filteredKits = kitSearch.trim()
    ? kits.filter((k) => k.serial.toLowerCase().includes(kitSearch.trim().toLowerCase()))
    : kits;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Maintenance Schedule</DialogTitle>
          <DialogDescription className="sr-only">
            Create a recurring maintenance schedule for a kit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="nsched-kit">Kit</Label>
            <input
              id="nsched-kit-search"
              type="text"
              value={kitSearch}
              onChange={(e) => setKitSearch(e.target.value)}
              placeholder="Search by serial…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-1"
            />
            <select
              id="nsched-kit"
              value={selectedKitId}
              onChange={(e) => setSelectedKitId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="none">Select a kit…</option>
              {filteredKits.map((k) => (
                <option key={k.id} value={k.id}>{k.serial}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nsched-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="nsched-type">
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
            <Label htmlFor="nsched-desc">Description</Label>
            <Textarea
              id="nsched-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the maintenance task…"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nsched-interval">Interval (days)</Label>
            <Input
              id="nsched-interval"
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nsched-last">Last done at (optional)</Label>
            <Input
              id="nsched-last"
              type="date"
              value={lastDoneAt}
              onChange={(e) => setLastDoneAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If blank, next due will be set to today.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nsched-notes">Notes</Label>
            <Textarea
              id="nsched-notes"
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
              {loading ? "Creating…" : "Create schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
