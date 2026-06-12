import { useState, useEffect, useRef, startTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { toast } from "./ui/use-toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { createKit, updateKit, parseTags, serializeTags } from "../services/kits";
import type { Kit } from "../types";

interface Props {
  kit?: Kit;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function KitFormDialog({ kit, open, onClose, onSaved }: Props) {
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setSerial(kit?.serial ?? "");
        setNotes(kit?.notes ?? "");
        setTagsInput(parseTags(kit?.tags).join(", "));
        setError("");
      });
    }
  }, [open, kit]);

  async function handleSave() {
    // Synchronous guard against double-click: setLoading is async so disabled={loading}
    // doesn't propagate before a second click in the same tick.
    if (submittingRef.current) return;
    if (!serial.trim()) { setError("Serial is required."); return; }
    const rawTags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    if (rawTags.length > 10) { setError("Maximum 10 tags allowed."); return; }
    const tags = serializeTags(rawTags);
    setError("");
    submittingRef.current = true;
    setLoading(true);
    try {
      if (kit) {
        await updateKit(kit.id, { serial: serial.trim(), notes: notes.trim(), tags });
        toast({ title: "Kit updated", variant: "success" });
      } else {
        await createKit({ serial: serial.trim(), notes: notes.trim(), tags });
        toast({ title: "Kit created", variant: "success" });
        window.dispatchEvent(new CustomEvent("kit-tracker:data-changed"));
      }
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to save kit.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kit ? "Edit Kit" : "New Kit"}</DialogTitle>
          <DialogDescription className="sr-only">
            {kit ? "Update kit serial and notes." : "Register a new kit with a serial number and optional notes."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="kit-serial">Serial</Label>
            <Input
              id="kit-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="KIT-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-notes">Notes</Label>
            <Textarea
              id="kit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-tags">Tags (comma-separated)</Label>
            <Input
              id="kit-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="laptop, ssd, dell"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading || !serial.trim()}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
