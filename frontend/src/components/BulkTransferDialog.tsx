import { useState, useEffect, startTransition } from "react";
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
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { listEntities } from "../services/entities";
import { bulkCreateTransfer } from "../services/transactions";
import type { Entity } from "../types";

interface Props {
  kitIds: string[];
  open: boolean;
  onClose: () => void;
  onTransferred: () => void;
}

export function BulkTransferDialog({ kitIds, open, onClose, onTransferred }: Props) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [toEntityId, setToEntityId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [failedKits, setFailedKits] = useState<{ kitId: string; error: string }[]>([]);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setToEntityId("");
        setNotes("");
        setError("");
        setFailedKits([]);
      });
      listEntities().then(setEntities).catch(() => setError("Failed to load entities."));
    }
  }, [open]);

  async function handleTransfer() {
    if (!toEntityId) { setError("Select destination entity."); return; }
    setError("");
    setFailedKits([]);
    setLoading(true);
    try {
      const result = await bulkCreateTransfer({
        kitIds,
        toEntityId,
        notes: notes.trim() || undefined,
      });
      const entityName = entities.find((e) => e.id === toEntityId)?.name ?? toEntityId;
      if (result.failed.length === 0) {
        toast({
          title: `Transferred ${result.ok.length} kit${result.ok.length !== 1 ? "s" : ""} to ${entityName}`,
          variant: "success",
        });
        onTransferred();
        onClose();
      } else {
        setFailedKits(result.failed);
        if (result.ok.length > 0) {
          toast({
            title: `${result.failed.length} of ${kitIds.length} failed`,
            description: `${result.ok.length} kit${result.ok.length !== 1 ? "s" : ""} transferred successfully.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Transfer failed",
            description: `All ${kitIds.length} kits failed to transfer.`,
            variant: "destructive",
          });
        }
        if (result.ok.length > 0) {
          onTransferred();
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to transfer kits.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer {kitIds.length} kit{kitIds.length !== 1 ? "s" : ""}</DialogTitle>
          <DialogDescription className="sr-only">
            Transfer selected kits to another entity. Creates one transaction per kit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Transfer to</Label>
            <Select value={toEntityId} onValueChange={setToEntityId}>
              <SelectTrigger>
                <SelectValue placeholder="Select entity…" />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
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
          {failedKits.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
              <p className="text-sm font-medium text-destructive">{failedKits.length} kit{failedKits.length !== 1 ? "s" : ""} failed:</p>
              <ul className="text-xs text-destructive space-y-0.5">
                {failedKits.map(({ kitId, error: err }) => (
                  <li key={kitId} className="font-mono">{kitId}: {err}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={loading || !toEntityId}>
              {loading
                ? "Transferring…"
                : `Transfer ${kitIds.length} kit${kitIds.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
