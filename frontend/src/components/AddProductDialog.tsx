import { useState } from "react";
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
import { createProduct } from "../services/products";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddProductDialog({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [specs, setSpecs] = useState("");
  const [isSerialized, setIsSerialized] = useState(true);
  const [error, setError] = useState("");
  const [specsError, setSpecsError] = useState("");
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setName("");
    setCategory("");
    setManufacturer("");
    setModel("");
    setDescription("");
    setUrl("");
    setSpecs("");
    setIsSerialized(true);
    setError("");
    setSpecsError("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

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
      const prod = await createProduct({
        name: name.trim(),
        category: category.trim() || "",
        manufacturer: manufacturer.trim() || "",
        model: model.trim() || "",
        description: description.trim() || "",
        url: url.trim() || "",
        specs: specs.trim() || "",
        is_serialized: isSerialized,
      });
      toast({ title: "Product created", description: prod.name, variant: "success" });
      resetForm();
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to create product.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new product in the catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="prod-name">Name *</Label>
            <Input
              id="prod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Laptop"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-category">Category</Label>
            <Input
              id="prod-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Electronics"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-manufacturer">Manufacturer</Label>
            <Input
              id="prod-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="e.g. Dell"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-model">Model</Label>
            <Input
              id="prod-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. XPS 13"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-description">Description</Label>
            <Textarea
              id="prod-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-url">URL</Label>
            <Input
              id="prod-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/datasheet"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="prod-serialized"
              checked={isSerialized}
              onChange={(e) => setIsSerialized(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="prod-serialized">Serialized (one unit per component)</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-specs">Specs (JSON)</Label>
            <Textarea
              id="prod-specs"
              value={specs}
              onChange={(e) => { setSpecs(e.target.value); setSpecsError(""); }}
              placeholder='{"ram": "16GB", "storage": "512GB"}'
              rows={3}
            />
            {specsError && <p className="text-sm text-destructive">{specsError}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
