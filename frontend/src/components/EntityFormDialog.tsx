import { useState, useEffect, startTransition } from "react";
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
import { createEntity, updateEntity } from "../services/entities";
import type { Entity } from "../types";

interface Props {
  entity?: Entity;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EntityFormDialog({ entity, open, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setName(entity?.name ?? "");
        setDescription(entity?.description ?? "");
        setError("");
      });
    }
  }, [open, entity]);

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setError("");
    setLoading(true);
    try {
      if (entity) {
        await updateEntity(entity.id, { name: name.trim(), description: description.trim() });
      } else {
        await createEntity({ name: name.trim(), description: description.trim() });
      }
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to save entity.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity ? "Edit Entity" : "New Entity"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="entity-name">Name</Label>
            <Input id="entity-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Logistics" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-description">Description</Label>
            <Textarea
              id="entity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
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
