import { useState, useEffect, startTransition } from "react";
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
import { listEntities } from "../services/entities";
import { createTransaction } from "../services/transactions";
import type { Entity, Kit } from "../types";

interface Props {
  kit: Kit;
  currentEntityId?: string;
  currentEntityName?: string;
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
}

export function MoveKitDialog({ kit, currentEntityId, currentEntityName, open, onClose, onMoved }: Props) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [toEntityId, setToEntityId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setToEntityId("");
        setNotes("");
        setError("");
      });
      listEntities().then(setEntities).catch(() => setError("Failed to load entities."));
    }
  }, [open]);

  async function handleMove() {
    if (!toEntityId) { setError("Select destination entity."); return; }
    setError("");
    setLoading(true);
    try {
      await createTransaction({
        kitId: kit.id,
        fromEntityId: currentEntityId,
        toEntityId,
        notes: notes.trim() || undefined,
      });
      onMoved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to move kit.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Kit — {kit.serial}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm text-muted-foreground">Current location</p>
            <p className="font-medium">{currentEntityName ?? "Unknown"}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Move to</Label>
            <Select value={toEntityId} onValueChange={setToEntityId}>
              <SelectTrigger>
                <SelectValue placeholder="Select entity…" />
              </SelectTrigger>
              <SelectContent>
                {entities
                  .filter((e) => e.id !== currentEntityId)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleMove} disabled={loading}>
              {loading ? "Moving…" : "Move kit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
