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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { updateProduct } from "../services/products";
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
  const [specs, setSpecs] = useState(product.specs ?? "");
  const [error, setError] = useState("");
  const [specsError, setSpecsError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setName(product.name);
        setCategory(product.category ?? "");
        setManufacturer(product.manufacturer ?? "");
        setModel(product.model ?? "");
        setDescription(product.description ?? "");
        setUrl(product.url ?? "");
        setSpecs(product.specs ?? "");
        setError("");
        setSpecsError("");
      });
    }
  }, [open, product]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
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
      });
      toast({ title: "Product updated", description: name.trim(), variant: "success" });
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to update product.");
    } finally {
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
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
