import { useRef, useState, useEffect, startTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "./ui/use-toast";
import {
  getCascadePreview,
  cascadeDelete,
  type CascadeCollection,
  type CascadePreview,
} from "../services/admin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CascadeCollection;
  recordId: string;
  onDeleted?: (deleted: Record<string, number>) => void;
}

function toSingular(collection: CascadeCollection): string {
  const map: Record<CascadeCollection, string> = {
    kits: "kit",
    entities: "entity",
    components: "component",
    transactions: "transaction",
    products: "product",
  };
  return map[collection];
}

export function CascadeDeleteDialog({
  open,
  onOpenChange,
  collection,
  recordId,
  onDeleted,
}: Props) {
  const [preview, setPreview] = useState<CascadePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setPreview(null);
      setConfirmInput("");
      setError(null);
      setLoadingPreview(true);
    });
    getCascadePreview(collection, recordId)
      .then((p) => startTransition(() => setPreview(p)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .catch((err: any) => {
        if (!err?.isAbort)
          startTransition(() => setError(err?.message ?? "Failed to load preview."));
      })
      .finally(() => startTransition(() => setLoadingPreview(false)));
  }, [open, collection, recordId]);

  async function handleDelete() {
    // Synchronous guard against double-click: setSubmitting is async so disabled={submitting}
    // doesn't propagate before a second click in the same tick. A double-click here would
    // POST the cascade-delete twice — the first cascades and the second 404s, but the
    // audit log records both attempts and the race window is open against any concurrent
    // re-creation of the same identifier_value.
    if (submittingRef.current) return;
    if (!preview || confirmInput !== preview.identifier_value) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await cascadeDelete(collection, recordId, confirmInput);
      toast({ title: "Deleted", variant: "success" });
      onOpenChange(false);
      onDeleted?.(result.deleted);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err?.message ?? "Delete failed.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const singular = toSingular(collection);
  const canDelete =
    preview !== null &&
    !preview.blocked &&
    confirmInput === preview.identifier_value;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {preview
              ? `Hard delete ${singular} '${preview.identifier_value}' with cascade?`
              : `Hard delete ${singular} with cascade?`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Permanently removes the {singular} and all dependent rows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning banner */}
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            This cannot be undone. The record + all dependent rows will be permanently
            removed. An audit log row will be written first.
          </div>

          {loadingPreview && (
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          )}

          {!loadingPreview && preview && preview.blocked && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-destructive">
                Cannot delete — referenced by:
              </p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-1 pr-4 font-medium">Collection</th>
                    <th className="pb-1 pr-4 font-medium">Count</th>
                    <th className="pb-1 font-medium">Sample IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.blockers.map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-4">{b.collection}</td>
                      <td className="py-1 pr-4">{b.count}</td>
                      <td className="py-1 font-mono text-xs text-muted-foreground">
                        {b.sample_ids?.slice(0, 3).join(", ") ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm text-muted-foreground">
                Fix data first, then retry.
              </p>
            </div>
          )}

          {!loadingPreview && preview && !preview.blocked && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Will delete:</p>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {Object.entries(preview.counts).map(([col, count]) => (
                    <li key={col}>
                      {col}: {count}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cascade-confirm-input">
                  Type the {preview.identifier_field}{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {preview.identifier_value}
                  </code>{" "}
                  to enable the Delete button
                </Label>
                <Input
                  id="cascade-confirm-input"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={preview.identifier_value}
                  autoComplete="off"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!canDelete || submitting}
                  onClick={handleDelete}
                >
                  {submitting ? "Deleting…" : "Hard delete with cascade"}
                </Button>
              </div>
            </div>
          )}

          {!loadingPreview && preview && preview.blocked && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}

          {!loadingPreview && !preview && error && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
