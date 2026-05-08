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
import { createRequest, updateRequest } from "../services/requests";
import { listKits } from "../services/kits";
import { listEntities } from "../services/entities";
import type { Kit, Entity, KitRequest } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the dialog operates in edit mode. */
  request?: KitRequest;
  /** When true, the preferred-kit field is shown in edit mode (admin only). */
  showKitField?: boolean;
}

export function RequestFormDialog({ open, onClose, onSaved, request, showKitField }: Props) {
  const isEdit = Boolean(request);
  const [kits, setKits] = useState<Kit[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [notes, setNotes] = useState("");
  const [kitId, setKitId] = useState("none");
  const [entityId, setEntityId] = useState("none");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      Promise.all([listKits(), listEntities()])
        .then(([k, e]) => { setKits(k); setEntities(e); })
        .catch(() => setError("Failed to load options."));
      // Pre-fill from existing request when editing, otherwise reset
      setNotes(request?.notes ?? "");
      setKitId(request?.designated_kit ?? "none");
      setEntityId(request?.target_entity ?? "none");
      setExpectedReturn(isEdit ? (request?.expected_return ?? "") : "");
      setDeliveryDate(request?.delivery_date ?? "");
      setError("");
    }
  }, [open]);

  async function handleSubmit() {
    setError("");
    if (!deliveryDate) {
      setError("Delivery date is required");
      return;
    }
    setLoading(true);
    try {
      if (isEdit && request) {
        await updateRequest(request.id, {
          notes: notes.trim() || undefined,
          designated_kit: kitId === "none" ? undefined : kitId,
          target_entity: entityId === "none" ? undefined : entityId,
          delivery_date: deliveryDate,
        });
      } else {
        await createRequest({
          notes: notes.trim() || undefined,
          designated_kit: kitId === "none" ? undefined : kitId,
          target_entity: entityId === "none" ? undefined : entityId,
          expected_return: expectedReturn || undefined,
          delivery_date: deliveryDate,
        });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? (isEdit ? "Failed to update request." : "Failed to create request."));
    } finally {
      setLoading(false);
    }
  }

  // In edit mode, show kit field only when explicitly allowed (admin).
  // In create mode, always show it.
  const showKit = !isEdit || showKitField;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Request" : "New Request"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {showKit && (
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
          )}
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
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Expected return date (optional)</Label>
              <input
                type="date"
                value={expectedReturn}
                onChange={(e) => setExpectedReturn(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Delivery date</Label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
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
              {loading
                ? (isEdit ? "Saving…" : "Submitting…")
                : (isEdit ? "Save changes" : "Submit request")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
