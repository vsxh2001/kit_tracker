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
import { updateSchedule } from "../services/maintenance";
import { maintenanceTypeLabel } from "../lib/maintenance-types";
import { toast } from "./ui/use-toast";
import type { KitMaintenanceSchedule } from "../types";

interface Props {
  schedule: KitMaintenanceSchedule | null;
  onClose: () => void;
  onSnoozed: () => void;
}

/** UTC-stable: parse a PB date string "YYYY-MM-DD ..." and return y/m/d components. */
function parseDateYMD(pbDate: string): [number, number, number] {
  const parts = pbDate.slice(0, 10).split("-").map(Number);
  return [parts[0], parts[1] - 1, parts[2]];
}

/** Add N days to a PB date string (UTC-stable, no toISOString TZ shift). */
function addDays(pbDate: string, n: number): string {
  const [y, m, d] = parseDateYMD(pbDate);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Today's date as YYYY-MM-DD (UTC). */
function todayYMD(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type Mode = "7" | "30" | "custom";

export function SnoozeScheduleDialog({ schedule, onClose, onSnoozed }: Props) {
  const open = !!schedule;
  const [mode, setMode] = useState<Mode>("7");
  const [customDate, setCustomDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function defaultCustomDate(): string {
    if (!schedule?.next_due_at) return addDays(todayYMD(), 7);
    return addDays(schedule.next_due_at, 7);
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setMode("7");
      setCustomDate("");
      setError("");
      onClose();
    }
  }

  function handleModeChange(m: Mode) {
    setMode(m);
    if (m === "custom" && !customDate) {
      setCustomDate(defaultCustomDate());
    }
    setError("");
  }

  async function handleSnooze() {
    if (!schedule) return;

    let newDate: string;
    if (mode === "7") {
      newDate = addDays(schedule.next_due_at || todayYMD(), 7);
    } else if (mode === "30") {
      newDate = addDays(schedule.next_due_at || todayYMD(), 30);
    } else {
      if (!customDate) {
        setError("Please pick a date.");
        return;
      }
      newDate = customDate;
    }

    setLoading(true);
    setError("");
    try {
      await updateSchedule(schedule.id, { next_due_at: newDate });
      toast({
        title: "Schedule snoozed",
        description: `Next due moved to ${newDate}.`,
        variant: "success",
      });
      setMode("7");
      setCustomDate("");
      onSnoozed();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to snooze schedule.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Snooze Schedule</DialogTitle>
          <DialogDescription className="sr-only">
            Push the next due date forward without recording maintenance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Move <span className="font-medium text-foreground">{schedule ? maintenanceTypeLabel(schedule.type) : ""}</span> next due date forward.
            Current: <span className="font-medium text-foreground">{schedule?.next_due_at?.slice(0, 10) ?? "—"}</span>
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={mode === "7" ? "default" : "outline"}
              size="sm"
              onClick={() => handleModeChange("7")}
            >
              7 days
            </Button>
            <Button
              variant={mode === "30" ? "default" : "outline"}
              size="sm"
              onClick={() => handleModeChange("30")}
            >
              30 days
            </Button>
            <Button
              variant={mode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => handleModeChange("custom")}
            >
              Custom
            </Button>
          </div>

          {mode === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="snooze-custom-date">New next due date</Label>
              <Input
                id="snooze-custom-date"
                type="date"
                value={customDate}
                onChange={(e) => { setCustomDate(e.target.value); setError(""); }}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSnooze} disabled={loading}>
              {loading ? "Snoozing…" : "Snooze"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
