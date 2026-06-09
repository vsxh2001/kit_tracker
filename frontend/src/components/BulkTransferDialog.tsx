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
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { listEntities } from "../services/entities";
import { bulkCreateTransfer } from "../services/transactions";
import { KitTagList } from "./KitTagList";
import { RetiredBadge } from "./RetiredBadge";
import type { Entity, Kit } from "../types";

interface Props {
  kits: Kit[];
  open: boolean;
  onClose: () => void;
  onTransferred: () => void;
}

type Step = "form" | "confirm";

const CONFIRM_THRESHOLD = 5;

export function BulkTransferDialog({ kits, open, onClose, onTransferred }: Props) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [toEntityId, setToEntityId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [failedKits, setFailedKits] = useState<{ kitId: string; error: string }[]>([]);
  const [failedKitIds, setFailedKitIds] = useState<string[]>([]);
  const stalenessRef = useRef(0);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      stalenessRef.current += 1;
      startTransition(() => {
        setToEntityId("");
        setNotes("");
        setError("");
        setStep("form");
        setFailedKits([]);
        setFailedKitIds([]);
        setLoading(false);
      });
      async function loadEntities() {
        try {
          setEntities(await listEntities());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          if (!err?.isAbort) {
            console.error(err);
            setError("Failed to load entities.");
          }
        }
      }
      startTransition(() => loadEntities());
    }
  }, [open]);

  const kitIds = kits.map((k) => k.id);

  async function doTransfer(ids: string[]) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const myToken = stalenessRef.current;
    setError("");
    setLoading(true);
    try {
      const result = await bulkCreateTransfer({
        kitIds: ids,
        toEntityId,
        notes: notes.trim() || undefined,
      });
      if (stalenessRef.current !== myToken) return;
      const entityName = entities.find((e) => e.id === toEntityId)?.name ?? toEntityId;
      if (result.failed.length === 0) {
        toast({
          title: `Transferred ${result.ok.length} kit${result.ok.length !== 1 ? "s" : ""} to ${entityName}`,
          variant: "success",
        });
        onTransferred();
        onClose();
      } else {
        const newFailed = result.failed;
        setFailedKits(newFailed);
        setFailedKitIds(newFailed.map((f) => f.kitId));
        setStep("form");
        if (result.ok.length > 0) {
          toast({
            title: `${result.failed.length} of ${ids.length} failed`,
            description: `${result.ok.length} kit${result.ok.length !== 1 ? "s" : ""} transferred successfully.`,
            variant: "destructive",
          });
          onTransferred();
        } else {
          toast({
            title: "Transfer failed",
            description: `All ${ids.length} kits failed to transfer.`,
            variant: "destructive",
          });
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (stalenessRef.current !== myToken) return;
      setError(e?.message ?? "Failed to transfer kits.");
    } finally {
      isSubmittingRef.current = false;
      if (stalenessRef.current === myToken) {
        setLoading(false);
      }
    }
  }

  function handleTransferClick() {
    if (!toEntityId) { setError("Select destination entity."); return; }
    setError("");
    if (kits.length >= CONFIRM_THRESHOLD) {
      setStep("confirm");
    } else {
      doTransfer(kitIds);
    }
  }

  function handleRetry() {
    doTransfer(failedKitIds);
  }

  const entityName = entities.find((e) => e.id === toEntityId)?.name ?? toEntityId;
  const previewKits = kits.slice(0, 5);
  const overflowCount = kits.length - 5;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === "confirm"
              ? `Confirm transfer of ${kits.length} kit${kits.length !== 1 ? "s" : ""}`
              : `Transfer ${kits.length} kit${kits.length !== 1 ? "s" : ""}`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Transfer selected kits to another entity. Creates one transaction per kit.
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Transfer{" "}
              <span className="font-medium text-foreground">{kits.length} kit{kits.length !== 1 ? "s" : ""}</span>{" "}
              to{" "}
              <span className="font-medium text-foreground">{entityName}</span>?
              This creates {kits.length} transaction record{kits.length !== 1 ? "s" : ""} that cannot be deleted.
            </p>
            <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
              <ul className="text-xs space-y-0.5 text-muted-foreground">
                {previewKits.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-mono">{k.serial}</span>
                    <RetiredBadge isActive={k.is_active} />
                    <KitTagList tags={k.tags} />
                  </li>
                ))}
              </ul>
              {overflowCount > 0 && (
                <p className="text-xs text-muted-foreground italic">…and {overflowCount} more</p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("form")} disabled={loading}>Back</Button>
              <Button onClick={() => doTransfer(kitIds)} disabled={loading}>
                {loading ? "Transferring…" : "Confirm transfer"}
              </Button>
            </div>
          </div>
        ) : (
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
                <p className="text-sm font-medium text-destructive">
                  {failedKits.length} of {kitIds.length} failed:
                </p>
                <ul className="text-xs text-destructive space-y-0.5">
                  {failedKits.map(({ kitId, error: err }) => {
                    const failedKit = kits.find((k) => k.id === kitId);
                    const serial = failedKit?.serial ?? kitId;
                    return (
                      <li key={kitId} className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-mono">{serial}</span>
                        {failedKit && <RetiredBadge isActive={failedKit.is_active} />}
                        <KitTagList tags={failedKit?.tags} />
                        <span>: {err}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              {failedKitIds.length > 0 && (
                <Button variant="outline" onClick={handleRetry} disabled={loading || !toEntityId}>
                  {loading ? "Retrying…" : `Retry failed (${failedKitIds.length})`}
                </Button>
              )}
              <Button onClick={handleTransferClick} disabled={loading || !toEntityId}>
                {loading
                  ? "Transferring…"
                  : `Transfer ${kits.length} kit${kits.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
