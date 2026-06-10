import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { importEntitiesCsv } from "../services/entities";
import type { ImportEntitiesResult } from "../services/entities";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportEntitiesDialog({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportEntitiesResult | null>(null);
  const [error, setError] = useState("");

  function handleOpenChange(v: boolean) {
    if (!v) {
      setResult(null);
      setError("");
      if (fileRef.current) fileRef.current.value = "";
      onClose();
    }
  }

  async function handleSubmit() {
    // Synchronous guard against double-click: setLoading is async so disabled={loading}
    // doesn't propagate before a second click in the same tick. A double-click here would
    // POST the CSV twice, importing every row twice and bloating the skipped-duplicates list.
    if (submittingRef.current) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please select a CSV file.");
      return;
    }
    setError("");
    submittingRef.current = true;
    setLoading(true);
    try {
      const r = await importEntitiesCsv(file);
      setResult(r);
      onImported();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Import failed.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Entities from CSV</DialogTitle>
          <DialogDescription>
            First row should be header: name,description,type,is_active
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 pt-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-1.5 file:px-3 file:rounded file:border file:border-input file:text-sm file:bg-background file:cursor-pointer"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2 text-sm">
            <p>
              <span className="font-medium">Imported:</span> {result.imported}
            </p>
            <p>
              <span className="font-medium">Skipped:</span> {result.skipped.length}
            </p>
            {result.skipped.length > 0 && (
              <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={`${s.row}-${s.name}`}>
                    Row {s.row}: duplicate name {s.name}
                  </li>
                ))}
              </ul>
            )}
            <p>
              <span className="font-medium">Errors:</span> {result.errors.length}
            </p>
            {result.errors.length > 0 && (
              <ul className="ml-4 list-disc space-y-0.5 text-destructive">
                {result.errors.map((e, idx) => (
                  <li key={idx}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
