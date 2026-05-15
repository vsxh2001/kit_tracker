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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { createComponent, listComponents } from "../services/components";
import { createComponentTransaction } from "../services/componentTransactions";
import { listProducts } from "../services/products";
import { useAuth } from "../context/AuthContext";
import { pb } from "../lib/pocketbase";
import type { Component, Product } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  targetKit?: string;
  targetEntity?: string;
  onSuccess: () => void;
  /** When set, product picker is locked to this product (read-only). */
  presetProductId?: string;
}

type Tab = "create" | "move";

export function AddComponentDialog({ open, onClose, targetKit, targetEntity, onSuccess, presetProductId }: Props) {
  const { isAdmin, canTransferKits } = useAuth();

  const defaultTab: Tab = isAdmin ? "create" : "move";
  const [tab, setTab] = useState<Tab>(defaultTab);

  // Create new fields
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [isBulk, setIsBulk] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [productId, setProductId] = useState(presetProductId ?? "");
  const [products, setProducts] = useState<Product[]>([]);
  const [presetProduct, setPresetProduct] = useState<Product | null>(null);

  // Move existing fields
  const [existingComponents, setExistingComponents] = useState<Component[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [moveQty, setMoveQty] = useState("1");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setTab(isAdmin ? "create" : "move");
        setSerial("");
        setNotes("");
        setIsBulk(false);
        setQuantity("1");
        setProductId(presetProductId ?? "");
        setSelectedId("");
        setMoveQty("1");
        setError("");
      });
      if (canTransferKits) {
        listComponents({ activeOnly: true })
          .then((comps) => {
            setExistingComponents(comps);
          })
          .catch(() => setError("Failed to load components."));
      }
      if (presetProductId) {
        // Load just enough to display the locked product name
        listProducts({ includeInactive: true })
          .then((prods) => {
            const found = prods.find((p) => p.id === presetProductId) ?? null;
            setPresetProduct(found);
            setProducts(prods);
          })
          .catch(() => {});
      } else {
        listProducts({ includeInactive: false })
          .then((prods) => {
            setProducts(prods);
            setPresetProduct(null);
          })
          .catch(() => {});
      }
    }
  }, [open, isAdmin, canTransferKits, presetProductId]);

  async function handleCreate() {
    if (!productId) { setError("Product is required."); return; }
    setError("");
    setLoading(true);
    try {
      const qty = parseInt(quantity, 10) || 1;
      const comp = await createComponent({
        serial: serial.trim(),
        notes: notes.trim(),
        is_bulk: isBulk,
        quantity: qty,
        is_active: true,
        product: productId,
      });
      // Create initial transaction placing it in target
      if (targetKit || targetEntity) {
        await createComponentTransaction({
          component: comp.id,
          to_kit: targetKit ?? "",
          to_entity: targetEntity ?? "",
          quantity: qty,
          notes: "",
          created_by: pb.authStore.model?.id,
        });
      }
      toast({ title: "Component created", description: comp.serial || comp.expand?.product?.name || comp.product, variant: "success" });
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to create component.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMove() {
    if (!selectedId) { setError("Select a component."); return; }
    setError("");
    setLoading(true);
    try {
      const selected = existingComponents.find((c) => c.id === selectedId);
      const qty = selected?.is_bulk ? (parseInt(moveQty, 10) || 1) : 1;
      await createComponentTransaction({
        component: selectedId,
        to_kit: targetKit ?? "",
        to_entity: targetEntity ?? "",
        quantity: qty,
        notes: "",
        created_by: pb.authStore.model?.id,
      });
      toast({ title: "Component moved", variant: "success" });
      onSuccess();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? "Failed to move component.");
    } finally {
      setLoading(false);
    }
  }

  const selectedComponent = existingComponents.find((c) => c.id === selectedId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Component</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new component or move an existing one into this location.
          </DialogDescription>
        </DialogHeader>

        {/* Tab selector */}
        {isAdmin && canTransferKits && (
          <div className="flex gap-1 border-b pb-2">
            <button
              onClick={() => setTab("create")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === "create" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-slate-100"}`}
            >
              Create new
            </button>
            <button
              onClick={() => setTab("move")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === "move" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-slate-100"}`}
            >
              Move existing
            </button>
          </div>
        )}

        <div className="space-y-4 pt-2">
          {tab === "create" && isAdmin && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="comp-product">Product *</Label>
                {presetProductId ? (
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    {presetProduct
                      ? `${presetProduct.name}${presetProduct.manufacturer ? ` — ${presetProduct.manufacturer}` : ""}${presetProduct.model ? ` ${presetProduct.model}` : ""}`
                      : presetProductId}
                  </div>
                ) : (
                  <Select
                    value={productId}
                    onValueChange={setProductId}
                  >
                    <SelectTrigger id="comp-product">
                      <SelectValue placeholder="Select a product…" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.manufacturer ? ` — ${p.manufacturer}` : ""}{p.model ? ` ${p.model}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-serial">Serial (optional)</Label>
                <Input
                  id="comp-serial"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-notes">Notes</Label>
                <Textarea
                  id="comp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes…"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="comp-bulk"
                  checked={isBulk}
                  onChange={(e) => setIsBulk(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="comp-bulk">Bulk item</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-qty">Quantity</Label>
                <Input
                  id="comp-qty"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </>
          )}

          {tab === "move" && canTransferKits && (
            <>
              <div className="space-y-1.5">
                <Label>Component</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select component…" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingComponents.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.expand?.product?.name ?? c.product}{c.serial ? ` — ${c.serial}` : ""}{c.is_bulk ? ` (qty: ${c.quantity})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedComponent?.is_bulk && (
                <div className="space-y-1.5">
                  <Label htmlFor="move-qty">Quantity to move (max {selectedComponent.quantity})</Label>
                  <Input
                    id="move-qty"
                    type="number"
                    min={1}
                    max={selectedComponent.quantity}
                    value={moveQty}
                    onChange={(e) => setMoveQty(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={tab === "create" ? handleCreate : handleMove}
              disabled={loading}
            >
              {loading ? "Saving…" : tab === "create" ? "Create" : "Move"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
