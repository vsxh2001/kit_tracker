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
import { updateProduct, countComponentsForProduct } from "../services/products";
import type { Product } from "../types";

interface Props {
  open: boolean;
  product: Product;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditProductDialog({ open, product, onClose, onSuccess }: Props) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category ?? "");
  const [manufacturer, setManufacturer] = useState(product.manufacturer ?? "");
  const [model, setModel] = useState(product.model ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [url, setUrl] = useState(product.url ?? "");
  const [reorderPoint, setReorderPoint] = useState(product.reorder_point != null ? String(product.reorder_point) : "");
  const [specs, setSpecs] = useState(product.specs ?? "");
  const [isSerialized, setIsSerialized] = useState(product.is_serialized ?? true);
  const [trackInStatus, setTrackInStatus] = useState(product.track_in_status ?? false);
  const [isConsumable, setIsConsumable] = useState(product.is_consumable ?? false);
  const [activeComponentCount, setActiveComponentCount] = useState(0);
  const [error, setError] = useState("");
  const [specsError, setSpecsError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setName(product.name);
        setCategory(product.category ?? "");
        setManufacturer(product.manufacturer ?? "");
        setModel(product.model ?? "");
        setDescription(product.description ?? "");
        setUrl(product.url ?? "");
        setReorderPoint(product.reorder_point != null ? String(product.reorder_point) : "");
        setSpecs(product.specs ?? "");
        setIsSerialized(product.is_serialized ?? true);
        setTrackInStatus(product.track_in_status ?? false);
        setIsConsumable(product.is_consumable ?? false);
        setActiveComponentCount(0);
        setError("");
        setSpecsError("");
      });
      async function loadCount() {
        try {
          const count = await countComponentsForProduct(product.id);
          setActiveComponentCount(count);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          if (!err?.isAbort) console.error(err);
        }
      }
      loadCount();
    }
  }, [open, product]);

  function handleSerializedToggle(checked: boolean) {
    if (activeComponentCount > 0) return;
    setIsSerialized(checked);
  }

  async function handleSubmit() {
    // Synchronous guard against double-click: setLoading is async so disabled={loading}
    // doesn't propagate before a second click in the same tick.
    if (submittingRef.current) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (reorderPoint !== "") {
      const n = Number(reorderPoint);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        setError("Reorder point must be a non-negative whole number.");
        return;
      }
    }
    if (specs.trim()) {
      try {
        JSON.parse(specs.trim());
      } catch {
        setSpecsError("Specs must be valid JSON.");
        return;
      }
    }
    setError("");
    setSpecsError("");
    submittingRef.current = true;
    setLoading(true);
    try {
      await updateProduct(product.id, {
        name: name.trim(),
        category: category.trim() || "",
        manufacturer: manufacturer.trim() || "",
        model: model.trim() || "",
        description: description.trim() || "",
        url: url.trim() || "",
        specs: specs.trim() || "",
        is_serialized: isSerialized,
        track_in_status: trackInStatus,
        is_consumable: isConsumable,
        reorder_point: reorderPoint !== "" ? Number(reorderPoint) : null,
      });
      toast({ title: "Product updated", description: name.trim(), variant: "success" });
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to update product.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription className="sr-only">
            Edit product details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-name">Name *</Label>
            <Input
              id="edit-prod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Laptop"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-category">Category</Label>
            <Input
              id="edit-prod-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Electronics"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-manufacturer">Manufacturer</Label>
            <Input
              id="edit-prod-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="e.g. Dell"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-model">Model</Label>
            <Input
              id="edit-prod-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. XPS 13"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-description">Description</Label>
            <Textarea
              id="edit-prod-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-url">URL</Label>
            <Input
              id="edit-prod-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/datasheet"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-reorder-point">Reorder point (optional)</Label>
            <Input
              id="edit-prod-reorder-point"
              type="number"
              min={0}
              step={1}
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
              placeholder="e.g. 5"
            />
            <p className="text-xs text-muted-foreground">Alert when active on-hand falls below this number. Leave blank to disable.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="edit-prod-serialized"
              checked={isSerialized}
              onChange={(e) => handleSerializedToggle(e.target.checked)}
              disabled={activeComponentCount > 0}
              className="h-4 w-4 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Label
              htmlFor="edit-prod-serialized"
              className={activeComponentCount > 0 ? "opacity-50 cursor-not-allowed" : ""}
            >
              Serialized (one unit per component)
            </Label>
          </div>
          {activeComponentCount > 0 && (
            <p className="text-sm text-muted-foreground">
              Cannot change — {activeComponentCount} active component{activeComponentCount !== 1 ? "s" : ""} exist{activeComponentCount === 1 ? "s" : ""}.
            </p>
          )}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="edit-prod-track-in-status"
              checked={trackInStatus}
              onChange={(e) => setTrackInStatus(e.target.checked)}
              className="h-4 w-4"
            />
            <div>
              <Label htmlFor="edit-prod-track-in-status">Track in kit status</Label>
              <p className="text-xs text-muted-foreground">Show this product&apos;s presence in /kit status</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="edit-prod-consumable"
              checked={isConsumable}
              onChange={(e) => setIsConsumable(e.target.checked)}
              className="h-4 w-4"
            />
            <div>
              <Label htmlFor="edit-prod-consumable">Consumable (one-way; not expected to return)</Label>
              <p className="text-xs text-muted-foreground">For tape, adhesives, batteries, and similar items consumed in use.</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-prod-specs">Specs (JSON)</Label>
            <Textarea
              id="edit-prod-specs"
              value={specs}
              onChange={(e) => { setSpecs(e.target.value); setSpecsError(""); }}
              placeholder='{"ram": "16GB", "storage": "512GB"}'
              rows={3}
            />
            {specsError && <p className="text-sm text-destructive">{specsError}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading || !name.trim()}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
