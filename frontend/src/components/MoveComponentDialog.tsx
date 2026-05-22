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
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { listKits } from "../services/kits";
import { listEntities } from "../services/entities";
import { createComponentTransaction, splitAndMoveBulk } from "../services/componentTransactions";
import { pb } from "../lib/pocketbase";
import type { Component, Kit, Entity } from "../types";

interface Props {
  component: Component;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type TargetType = "kit" | "entity";

export function MoveComponentDialog({ component, open, onClose, onSuccess }: Props) {
  const [targetType, setTargetType] = useState<TargetType>("kit");
  const [kits, setKits] = useState<Kit[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [targetId, setTargetId] = useState("");
  const [qty, setQty] = useState(String(component.quantity ?? 1));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setTargetType("kit");
        setTargetId("");
        setQty(String(component.quantity ?? 1));
        setNotes("");
        setError("");
      });
      Promise.all([listKits(), listEntities()])
        .then(([k, e]) => { setKits(k); setEntities(e); })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((err: any) => {
          if (!err?.isAbort) setError("Failed to load destinations.");
        });
    }
  }, [open, component.quantity]);

  async function handleMove() {
    if (isSubmittingRef.current) return;
    if (!targetId) { setError("Select a destination."); return; }
    setError("");
    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const moveQty = parseInt(qty, 10) || 1;
      const isFullMove = !component.is_bulk || moveQty >= (component.quantity ?? 1);

      if (!isFullMove) {
        // Split and move
        await splitAndMoveBulk(
          component.id,
          moveQty,
          targetType === "kit" ? { kit: targetId } : { entity: targetId },
          notes.trim() || undefined
        );
      } else {
        await createComponentTransaction({
          component: component.id,
          to_kit: targetType === "kit" ? targetId : "",
          to_entity: targetType === "entity" ? targetId : "",
          quantity: moveQty,
          notes: notes.trim(),
          created_by: pb.authStore.model?.id,
        });
      }

      toast({ title: "Component moved", variant: "success" });
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to move component.");
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Component — {component.serial || component.expand?.product?.name || "Component"}</DialogTitle>
          <DialogDescription className="sr-only">
            Move this component to a kit or entity. Creates a transaction record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Target type */}
          <div className="space-y-1.5">
            <Label>Move to</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setTargetType("kit"); setTargetId(""); }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${targetType === "kit" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-border text-muted-foreground hover:bg-slate-50"}`}
              >
                Kit
              </button>
              <button
                type="button"
                onClick={() => { setTargetType("entity"); setTargetId(""); }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${targetType === "entity" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-border text-muted-foreground hover:bg-slate-50"}`}
              >
                Entity
              </button>
            </div>
          </div>

          {/* Target selector */}
          <div className="space-y-1.5">
            <Label>{targetType === "kit" ? "Kit" : "Entity"}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${targetType}…`} />
              </SelectTrigger>
              <SelectContent>
                {(targetType === "kit" ? kits : entities).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {"serial" in item ? item.serial : item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity (for bulk) */}
          {component.is_bulk && (
            <div className="space-y-1.5">
              <Label htmlFor="move-qty">Quantity (max {component.quantity ?? "?"})</Label>
              <Input
                id="move-qty"
                type="number"
                min={1}
                max={component.quantity ?? undefined}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              {parseInt(qty, 10) < (component.quantity ?? 1) && (
                <p className="text-xs text-muted-foreground">
                  Will split bulk — a new component record will be created for the moved quantity.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="move-notes">Notes</Label>
            <Textarea
              id="move-notes"
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
              {loading ? "Moving…" : "Move"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
