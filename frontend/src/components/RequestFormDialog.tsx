import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { createRequest } from "../services/requests";
import { listKits } from "../services/kits";
import { listEntities } from "../services/entities";
import type { Kit, Entity } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function RequestFormDialog({ open, onClose, onSaved }: Props) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [notes, setNotes] = useState("");
  const [kitId, setKitId] = useState("none");
  const [entityId, setEntityId] = useState("none");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      Promise.all([listKits(), listEntities()])
        .then(([k, e]) => { setKits(k); setEntities(e); })
        .catch(() => setError("Failed to load options."));
      setNotes("");
      setKitId("none");
      setEntityId("none");
      setError("");
    }
  }, [open]);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      await createRequest({
        notes: notes.trim() || undefined,
        designated_kit: kitId === "none" ? undefined : kitId,
        target_entity: entityId === "none" ? undefined : entityId,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create request.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Preferred kit (optional)</Label>
            <Select value={kitId} onValueChange={setKitId}>
              <SelectTrigger><SelectValue placeholder="Any kit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any kit</SelectItem>
                {kits.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.serial}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target entity (optional)</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why do you need this kit?"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
