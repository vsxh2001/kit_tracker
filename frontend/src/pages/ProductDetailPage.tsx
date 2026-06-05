import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { EditProductDialog } from "../components/EditProductDialog";
import { AddComponentDialog } from "../components/AddComponentDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import { CascadeDeleteDialog } from "../components/CascadeDeleteDialog";
import { getProduct, listComponentsForProduct, softDeleteProduct, restoreProduct } from "../services/products";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import { toast } from "../components/ui/use-toast";
import type { Component, Product } from "../types";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canDecideRequests, isAdmin } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showAddComp, setShowAddComp] = useState(false);
  const [showCascadeDelete, setShowCascadeDelete] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    setLoading(true);
    let aborted = false;
    try {
      const [p, comps] = await Promise.all([
        getProduct(id),
        listComponentsForProduct(id),
      ]);
      setProduct(p);
      setComponents(comps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.isAbort) { aborted = true; return; }
      console.error(err);
    } finally {
      if (!aborted) setLoading(false);
    }
  }

  async function loadComponents() {
    if (!id) return;
    try {
      const comps = await listComponentsForProduct(id);
      setComponents(comps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  async function handleSoftDelete() {
    if (!product) return;
    try {
      await softDeleteProduct(product.id);
      toast({ title: "Product deactivated", description: product.name, variant: "success" });
      setShowDeactivate(false);
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast({ title: "Failed to deactivate", description: e?.message, variant: "destructive" });
    }
  }

  async function handleRestore() {
    if (!product) return;
    try {
      await restoreProduct(product.id);
      toast({ title: "Product restored", description: product.name, variant: "success" });
      setShowRestore(false);
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast({ title: "Failed to restore", description: e?.message, variant: "destructive" });
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!product) return <p>Product not found.</p>;

  const activeComps = components.filter((c) => c.is_active);
  const onHand = product.is_serialized
    ? activeComps.length
    : activeComps.reduce((s, c) => s + (c.quantity ?? 0), 0);

  let specsFormatted = product.specs ?? "";
  if (specsFormatted) {
    try {
      specsFormatted = JSON.stringify(JSON.parse(specsFormatted), null, 2);
    } catch {
      // leave as-is
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          {product.is_serialized
            ? <Badge variant="outline">Serialized</Badge>
            : <Badge variant="secondary">Bulk</Badge>}
          {product.is_consumable && <Badge variant="outline">Consumable</Badge>}
          {!product.is_active && <Badge variant="destructive">Inactive</Badge>}
        </div>
      </div>

      {/* Info + Actions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 text-sm pt-0">
            <Row label="Name" value={product.name} />
            <Row label="Category" value={product.category || "—"} />
            <Row label="Manufacturer" value={product.manufacturer || "—"} />
            <Row label="Model" value={product.model || "—"} />
            <Row label="Description" value={product.description || "—"} />
            <Row label="Reorder point" value={product.reorder_point != null ? String(product.reorder_point) : "—"} />
            <Row label="Consumable" value={product.is_consumable ? "Yes" : "No"} />
            {product.url && (
              <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
                <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">URL</p>
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:underline text-right break-all flex items-center gap-1"
                >
                  {product.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            )}
            <Row label="Created" value={formatDate(product.created)} />
          </CardContent>
        </Card>

        {canDecideRequests && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              {product.is_active ? (
                <Button size="sm" variant="destructive" onClick={() => setShowDeactivate(true)}>
                  Deactivate
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setShowRestore(true)}>
                  Restore
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Specs */}
      {specsFormatted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Specs</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <pre className="text-xs bg-slate-50 rounded-md p-3 overflow-auto max-h-48">{specsFormatted}</pre>
          </CardContent>
        </Card>
      )}

      {/* Components of this product */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight">Components of this product</h2>
            <span className="text-xs text-muted-foreground">{components.length} component{components.length !== 1 ? "s" : ""}</span>
            <span className="text-xs text-muted-foreground">On hand: {onHand}</span>
            {product.reorder_point != null && onHand < product.reorder_point && (
              <Badge variant="destructive" className="text-xs">Low stock</Badge>
            )}
          </div>
          {canDecideRequests && (
            <Button size="sm" onClick={() => setShowAddComp(true)}>
              <Plus className="h-4 w-4" />
              Add component
            </Button>
          )}
        </div>

        {components.length === 0 ? (
          <p className="text-sm text-muted-foreground">No components linked to this product.</p>
        ) : (
          <>
            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {components.map((comp) => (
                <Link key={comp.id} to={`/components/${comp.id}`}>
                  <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-medium">{comp.expand?.product?.name ?? "—"}</span>
                        {comp.serial && <span className="font-mono text-xs text-indigo-700 ml-2">{comp.serial}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {comp.bin_code && (
                          <span className="font-mono text-xs text-indigo-700">Bin: {comp.bin_code}</span>
                        )}
                        {comp.is_bulk && <Badge variant="secondary" className="text-xs">Bulk × {comp.quantity}</Badge>}
                        {!comp.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop table */}
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Serial</th>
                      {!product.is_serialized && (
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Qty</th>
                      )}
                      {!product.is_serialized && (
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Bulk</th>
                      )}
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Bin</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((comp) => (
                      <tr key={comp.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">
                          {comp.serial
                            ? <div className="font-mono text-xs text-indigo-700">{comp.serial}</div>
                            : <span className="text-muted-foreground opacity-40">—</span>}
                        </td>
                        {!product.is_serialized && (
                          <td className="px-4 py-3 tabular-nums text-xs">{comp.quantity}</td>
                        )}
                        {!product.is_serialized && (
                          <td className="px-4 py-3">
                            {comp.is_bulk
                              ? <Badge variant="secondary" className="text-xs">Bulk</Badge>
                              : <span className="text-muted-foreground opacity-40">—</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-xs text-indigo-700">
                          {comp.bin_code || <span className="text-muted-foreground opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {comp.is_active
                            ? <Badge variant="outline" className="text-xs">Active</Badge>
                            : <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/components/${comp.id}`} className="text-indigo-600 hover:underline text-xs">View</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {product && showEdit && (
        <EditProductDialog
          open={showEdit}
          product={product}
          onClose={() => setShowEdit(false)}
          onSuccess={load}
        />
      )}

      <AddComponentDialog
        open={showAddComp}
        onClose={() => setShowAddComp(false)}
        presetProductId={product.id}
        onSuccess={loadComponents}
      />

      <AlertDialog open={showDeactivate} onOpenChange={setShowDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate product?</AlertDialogTitle>
            <AlertDialogDescription>
              This product will be marked inactive and hidden from the default catalog. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleSoftDelete}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRestore} onOpenChange={setShowRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore product?</AlertDialogTitle>
            <AlertDialogDescription>
              This product will be marked active again and visible in the catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              Hard-delete this product and all dependent rows. Last-resort tool to fix history.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowCascadeDelete(true)}
            >
              Cascade Hard Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <CascadeDeleteDialog
        open={showCascadeDelete}
        onOpenChange={setShowCascadeDelete}
        collection="products"
        recordId={product.id}
        onDeleted={() => {
          navigate("/products");
          toast({ title: "Product deleted with cascade", variant: "success" });
        }}
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className={`text-sm text-right break-all ${mono ? "font-mono text-xs tracking-wide text-indigo-700" : ""}`}>{value}</p>
    </div>
  );
}
