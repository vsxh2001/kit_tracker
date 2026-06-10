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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { createEntity, updateEntity } from "../services/entities";
import type { Entity, EntityCategory } from "../types";

interface Props {
  entity?: Entity;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EntityFormDialog({ entity, open, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<EntityCategory>("field");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setName(entity?.name ?? "");
        setDescription(entity?.description ?? "");
        setCategory(entity?.category ?? "field");
        setError("");
      });
    }
  }, [open, entity]);

  async function handleSave() {
    if (submittingRef.current) return;
    if (!name.trim()) { setError("Name is required."); return; }
    setError("");
    submittingRef.current = true;
    setLoading(true);
    try {
      if (entity) {
        await updateEntity(entity.id, { name: name.trim(), description: description.trim(), category });
        toast({ title: "Entity updated", variant: "success" });
      } else {
        await createEntity({ name: name.trim(), description: description.trim(), category });
        toast({ title: "Entity created", variant: "success" });
        window.dispatchEvent(new CustomEvent("kit-tracker:data-changed"));
      }
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to save entity.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity ? "Edit Entity" : "New Entity"}</DialogTitle>
          <DialogDescription className="sr-only">
            {entity ? "Update entity name and description." : "Create a new entity (location, team, or holder of kits)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="entity-name">Name</Label>
            <Input id="entity-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Logistics" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as EntityCategory)}>
              <SelectTrigger id="entity-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="field">Field</SelectItem>
                <SelectItem value="storage">Storage</SelectItem>
              </SelectContent>
            </Select>
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
