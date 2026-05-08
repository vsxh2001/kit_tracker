import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { createKit, updateKit } from "../services/kits";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSerial(kit?.serial ?? "");
      setNotes(kit?.notes ?? "");
      setError("");
    }
  }, [open, kit]);

  async function handleSave() {
    if (!serial.trim()) { setError("Serial is required."); return; }
    setError("");
    setLoading(true);
    try {
      if (kit) {
        await updateKit(kit.id, { serial: serial.trim(), notes: notes.trim() });
      } else {
        await createKit({ serial: serial.trim(), notes: notes.trim() });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save kit.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kit ? "Edit Kit" : "New Kit"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Serial</Label>
            <Input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="KIT-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
