import { useEffect, useState, startTransition, useRef } from "react";
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
import { createSchedule, bulkCreateSchedules } from "../services/maintenance";
import { listKits } from "../services/kits";
import { toast } from "./ui/use-toast";
import { KitTagList } from "./KitTagList";
import { MAINTENANCE_TYPES, maintenanceTypeLabel } from "../lib/maintenance-types";
import type { Kit, MaintenanceType } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function NewMaintenanceScheduleDialog({ open, onClose, onSaved }: Props) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKitId, setSelectedKitId] = useState("none");
  const [selectedKitIds, setSelectedKitIds] = useState<Set<string>>(new Set());
  const [kitSearch, setKitSearch] = useState("");
  const [type, setType] = useState("none");
  const [description, setDescription] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [lastDoneAt, setLastDoneAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Array<{ kitId: string; serial: string; error: string }>>([]);
  const isSubmittingRef = useRef(false);

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
    setSelectedKitIds(new Set());
    setKitSearch("");
    setType("none");
    setDescription("");
    setIntervalDays("30");
    setLastDoneAt("");
    setNotes("");
    setError("");
    setBulkMode(false);
    setBulkErrors([]);
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

  function toggleKitSelection(kitId: string) {
    setSelectedKitIds((prev) => {
      const next = new Set(prev);
      if (next.has(kitId)) {
        next.delete(kitId);
      } else {
        next.add(kitId);
      }
      return next;
    });
  }

  async function handleSave() {
    if (isSubmittingRef.current) return;
    if (type === "none") { setError("Type is required."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    const interval = parseInt(intervalDays, 10);
    if (!interval || interval < 1) { setError("Interval must be at least 1 day."); return; }
    isSubmittingRef.current = true;
    try {

    if (bulkMode) {
      if (selectedKitIds.size === 0) { setError("Select at least one kit."); return; }
      setError("");
      setBulkErrors([]);
      setLoading(true);
      try {
        const fields = {
          type: type as MaintenanceType,
          description: description.trim(),
          interval_days: interval,
          next_due_at: computeNextDue(),
          is_active: true,
          notes: notes.trim(),
          last_done_at: lastDoneAt || "",
        };
        const { ok, failed } = await bulkCreateSchedules([...selectedKitIds], fields);
        if (failed.length === 0) {
          toast({
            title: `Created ${ok.length} schedule${ok.length !== 1 ? "s" : ""}`,
            description: maintenanceTypeLabel(type),
            variant: "success",
          });
          reset();
          onSaved();
          onClose();
        } else if (ok.length === 0) {
          // All failed — stay open, show errors
          const errorsWithSerial = failed.map((f) => ({
            kitId: f.kitId,
            serial: kits.find((k) => k.id === f.kitId)?.serial ?? f.kitId,
            error: f.error,
          }));
          setBulkErrors(errorsWithSerial);
          setError("All schedules failed to create. See errors below.");
        } else {
          // Partial — close, show toast with summary
          const errorsWithSerial = failed.map((f) => ({
            kitId: f.kitId,
            serial: kits.find((k) => k.id === f.kitId)?.serial ?? f.kitId,
            error: f.error,
          }));
          setBulkErrors(errorsWithSerial);
          toast({
            title: `Created ${ok.length}, failed ${failed.length}`,
            description: `${failed.length} schedule${failed.length !== 1 ? "s" : ""} failed — see dialog for details.`,
            variant: "destructive",
          });
          // Stay open to show partial errors
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        setError(e?.message ?? "Failed to create schedules.");
      } finally {
        setLoading(false);
      }
    } else {
      if (selectedKitId === "none") { setError("Kit is required."); return; }
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
        toast({ title: "Schedule created", description: maintenanceTypeLabel(type), variant: "success" });
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
    } finally {
      isSubmittingRef.current = false;
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) { reset(); onClose(); }
  }

  const filteredKits = kitSearch.trim()
    ? kits.filter((k) => k.serial.toLowerCase().includes(kitSearch.trim().toLowerCase()))
    : kits;

  const intervalParsed = parseInt(intervalDays, 10);
  const kitOk = bulkMode ? selectedKitIds.size > 0 : selectedKitId !== "none";
  const typeOk = type !== "none";
  const descriptionOk = description.trim().length > 0;
  const intervalOk = Number.isFinite(intervalParsed) && intervalParsed >= 1;
  const isFormValid = kitOk && typeOk && descriptionOk && intervalOk;

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

          {/* Bulk mode toggle */}
          <div className="flex items-center gap-2">
            <input
              id="nsched-bulk-toggle"
              type="checkbox"
              checked={bulkMode}
              onChange={(e) => {
                setBulkMode(e.target.checked);
                setError("");
                setBulkErrors([]);
                setSelectedKitIds(new Set());
                setSelectedKitId("none");
              }}
              className="h-4 w-4 rounded border-input accent-indigo-600"
            />
            <Label htmlFor="nsched-bulk-toggle" className="cursor-pointer font-normal">
              Apply to multiple kits
            </Label>
          </div>

          {/* Kit picker — single vs multi */}
          {bulkMode ? (
            <div className="space-y-1.5">
              <Label>Kits <span className="text-muted-foreground font-normal">({selectedKitIds.size} selected)</span></Label>
              <input
                type="text"
                value={kitSearch}
                onChange={(e) => setKitSearch(e.target.value)}
                placeholder="Search by serial…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-1"
              />
              <div
                id="nsched-bulk-kit-list"
                className="max-h-40 overflow-y-auto rounded-md border border-input bg-background divide-y divide-border"
              >
                {filteredKits.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No kits found.</p>
                ) : (
                  filteredKits.map((k) => (
                    <label
                      key={k.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedKitIds.has(k.id)}
                        onChange={() => toggleKitSelection(k.id)}
                        className="h-4 w-4 rounded border-input accent-indigo-600"
                        data-kit-id={k.id}
                      />
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-mono text-xs tracking-wide text-indigo-700">{k.serial}</span>
                        <KitTagList tags={k.tags} />
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : (
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
          )}

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

          {bulkErrors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">Failed kits:</p>
              <ul className="text-xs text-destructive space-y-0.5 max-h-24 overflow-y-auto">
                {bulkErrors.map((e) => (
                  <li key={e.kitId} className="font-mono">
                    {e.serial}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading || !isFormValid}>
              {loading
                ? (bulkMode ? "Creating…" : "Creating…")
                : (bulkMode ? `Create ${selectedKitIds.size > 0 ? selectedKitIds.size + " " : ""}schedule${selectedKitIds.size !== 1 ? "s" : ""}` : "Create schedule")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

