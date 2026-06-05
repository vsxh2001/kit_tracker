import { useEffect, useState, startTransition } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AddProductDialog } from "../components/AddProductDialog";
import { listProducts, getComponentCountsByProduct, getOnHandByProduct, updateProduct, softDeleteProduct } from "../services/products";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
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
import type { Product } from "../types";

interface ProductRow {
  product: Product;
  componentCount: number;
  onHand: number;
}

type BulkAction = "retire" | "activate";

export function ProductsPage() {
  const navigate = useNavigate();
  const { canDecideRequests } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const lowStockOnly = searchParams.get("lowStock") === "true";
  const consumableOnly = searchParams.get("consumable") === "true";
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [products, counts, onHandMap] = await Promise.all([
        listProducts({ includeInactive: showInactive }),
        getComponentCountsByProduct(),
        getOnHandByProduct(),
      ]);
      setRows(products.map((p) => ({ product: p, componentCount: counts[p.id] ?? 0, onHand: onHandMap[p.id] ?? 0 })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [showInactive]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[]) {
    if (ids.every((id) => selected.has(id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  async function executeBulkAction(action: BulkAction) {
    setBulkLoading(true);
    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        if (action === "retire") {
          await softDeleteProduct(id);
        } else {
          await updateProduct(id, { is_active: true });
        }
        succeeded++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (!err?.isAbort) failed++;
      }
    }
    setBulkLoading(false);
    setBulkAction(null);
    setSelected(new Set());
    if (failed === 0) {
      const label = action === "retire" ? "retired" : "activated";
      toast({ title: `${succeeded} product${succeeded !== 1 ? "s" : ""} ${label}`, variant: "success" });
    } else {
      toast({
        title: `${succeeded} of ${ids.length} succeeded — ${failed} failed`,
        variant: "destructive",
      });
    }
    startTransition(() => load());
  }

  const allCategories = Array.from(
    new Set(rows.map((r) => r.product.category).filter((c): c is string => Boolean(c)))
  ).sort();

  const filtered = rows.filter(({ product, onHand }) => {
    if (search) {
      const q = search.toLowerCase();
      const matches =
        product.name.toLowerCase().includes(q) ||
        (product.manufacturer ?? "").toLowerCase().includes(q) ||
        (product.model ?? "").toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (categoryFilter !== "__all__" && product.category !== categoryFilter) return false;
    if (typeFilter !== "all") {
      const isSerial = product.is_serialized !== false;
      if (typeFilter === "serial" && !isSerial) return false;
      if (typeFilter === "bulk" && isSerial) return false;
    }
    if (lowStockOnly && !(product.reorder_point != null && onHand < product.reorder_point)) {
      return false;
    }
    if (consumableOnly && !product.is_consumable) return false;
    return true;
  });

  function toggleLowStockOnly(next: boolean) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("lowStock", "true");
      else params.delete("lowStock");
      return params;
    });
  }

  function toggleConsumableOnly(next: boolean) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("consumable", "true");
      else params.delete("consumable");
      return params;
    });
  }

  const filteredIds = filtered.map((r) => r.product.id);
  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someVisibleSelected = filteredIds.some((id) => selected.has(id));

  const selectedProducts = rows.filter((r) => selected.has(r.product.id)).map((r) => r.product);
  const hasActiveSelected = selectedProducts.some((p) => p.is_active);
  const hasInactiveSelected = selectedProducts.some((p) => !p.is_active);

  const bulkRetireCount = selectedProducts.filter((p) => p.is_active).length;
  const bulkActivateCount = selectedProducts.filter((p) => !p.is_active).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Catalog</p>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{rows.length} product{rows.length !== 1 ? "s" : ""} registered</p>
        </div>
        {canDecideRequests && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search by name, manufacturer, model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {allCategories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="serial">Serial</SelectItem>
            <SelectItem value="bulk">Bulk</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => toggleLowStockOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Low stock only
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={consumableOnly}
            onChange={(e) => toggleConsumableOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Consumable only
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">No products found.</p>
          )}

          {/* Mobile card list — no checkboxes (desktop-only bulk selection) */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map(({ product, componentCount, onHand }) => (
                <Link key={product.id} to={`/products/${product.id}`}>
                  <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-sm">{product.name}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={product.is_serialized !== false ? "secondary" : "purple"} className="text-xs">
                          {product.is_serialized !== false ? "Serial" : "Bulk"}
                        </Badge>
                        {product.is_consumable && <Badge variant="outline" className="text-xs">Consumable</Badge>}
                        {product.reorder_point != null && onHand < product.reorder_point && (
                          <Badge variant="destructive" className="text-xs">Low stock</Badge>
                        )}
                        {!product.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{[product.manufacturer, product.model].filter(Boolean).join(" · ") || "—"}</span>
                      <span>{componentCount} component{componentCount !== 1 ? "s" : ""}</span>
                    </div>
                    {product.category && (
                      <div className="mt-1">
                        <Badge variant="outline" className="text-xs">{product.category}</Badge>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <div className="hidden md:block space-y-2">
              {/* Bulk action toolbar — only when rows selected */}
              {canDecideRequests && selected.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50">
                  <span className="text-sm font-medium text-indigo-800">{selected.size} selected</span>
                  <div className="flex items-center gap-2 ml-auto">
                    {hasActiveSelected && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkLoading}
                        onClick={() => setBulkAction("retire")}
                        className="border-red-200 text-red-700 hover:bg-red-50"
                      >
                        Retire {bulkRetireCount > 0 ? `(${bulkRetireCount})` : ""}
                      </Button>
                    )}
                    {hasInactiveSelected && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkLoading}
                        onClick={() => executeBulkAction("activate")}
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      >
                        Activate {bulkActivateCount > 0 ? `(${bulkActivateCount})` : ""}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkLoading}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80">
                        {canDecideRequests && (
                          <th className="w-10 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                              }}
                              onChange={() => toggleAll(filteredIds)}
                              aria-label="Select all"
                              className="h-4 w-4 rounded border-gray-300 accent-indigo-600 cursor-pointer"
                            />
                          </th>
                        )}
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Name</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Category</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Type</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Manufacturer</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Model</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Components</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">Tracked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(({ product, componentCount, onHand }) => {
                        const isChecked = selected.has(product.id);
                        const lowStock = product.reorder_point != null && onHand < product.reorder_point;
                        return (
                          <tr key={product.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/products/${product.id}`)}>
                            {canDecideRequests && (
                              <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRow(product.id)}
                                  aria-label={`Select ${product.name}`}
                                  className="h-4 w-4 rounded border-gray-300 accent-indigo-600 cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3 font-medium text-xs">{product.name}</td>
                            <td className="px-4 py-3 text-xs">
                              {product.category
                                ? <Badge variant="outline" className="text-xs">{product.category}</Badge>
                                : <span className="text-muted-foreground opacity-40">—</span>}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <div className="flex items-center gap-1">
                                <Badge variant={product.is_serialized !== false ? "secondary" : "purple"} className="text-xs">
                                  {product.is_serialized !== false ? "Serial" : "Bulk"}
                                </Badge>
                                {product.is_consumable && <Badge variant="outline" className="text-xs">Consumable</Badge>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{product.manufacturer || <span className="opacity-40">—</span>}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{product.model || <span className="opacity-40">—</span>}</td>
                            <td className="px-4 py-3 tabular-nums text-xs">{componentCount}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {product.is_active
                                  ? <Badge variant="outline" className="text-xs">Active</Badge>
                                  : <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                                {lowStock && <Badge variant="destructive" className="text-xs">Low stock</Badge>}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {product.track_in_status
                                ? <Badge variant="secondary" className="text-xs">Tracked</Badge>
                                : <span className="text-muted-foreground opacity-40">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <AddProductDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={load}
      />

      {/* Bulk retire confirm dialog */}
      <AlertDialog open={bulkAction === "retire"} onOpenChange={(v) => !v && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {bulkRetireCount} product{bulkRetireCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes them — they can be reactivated later. Historical records remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => executeBulkAction("retire")}>
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
