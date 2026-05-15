import { useEffect, useState, startTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AddProductDialog } from "../components/AddProductDialog";
import { listProducts, getComponentCountsByProduct } from "../services/products";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";

interface ProductRow {
  product: Product;
  componentCount: number;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { canDecideRequests } = useAuth();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [products, counts] = await Promise.all([
        listProducts({ includeInactive: showInactive }),
        getComponentCountsByProduct(),
      ]);
      setRows(products.map((p) => ({ product: p, componentCount: counts[p.id] ?? 0 })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [showInactive]);

  const allCategories = Array.from(
    new Set(rows.map((r) => r.product.category).filter((c): c is string => Boolean(c)))
  ).sort();

  const filtered = rows.filter(({ product }) => {
    if (search) {
      const q = search.toLowerCase();
      const matches =
        product.name.toLowerCase().includes(q) ||
        (product.manufacturer ?? "").toLowerCase().includes(q) ||
        (product.model ?? "").toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (categoryFilter !== "__all__" && product.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Catalog</p>
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
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
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

          {/* Mobile card list */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map(({ product, componentCount }) => (
                <Link key={product.id} to={`/products/${product.id}`}>
                  <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-sm">{product.name}</span>
                      {!product.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{[product.manufacturer, product.model].filter(Boolean).join(" · ") || "—"}</span>
                      <span>{componentCount} component{componentCount !== 1 ? "s" : ""}</span>
                    </div>
                    {product.category && (
                      <div className="mt-1">
                        <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Name</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Category</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Manufacturer</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Model</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Components</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ product, componentCount }) => (
                      <tr key={product.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/products/${product.id}`)}>
                        <td className="px-4 py-3 font-medium text-xs">{product.name}</td>
                        <td className="px-4 py-3 text-xs">
                          {product.category
                            ? <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                            : <span className="text-muted-foreground opacity-40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{product.manufacturer || <span className="opacity-40">—</span>}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{product.model || <span className="opacity-40">—</span>}</td>
                        <td className="px-4 py-3 tabular-nums text-xs">{componentCount}</td>
                        <td className="px-4 py-3">
                          {product.is_active
                            ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                            : <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AddProductDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={load}
      />
    </div>
  );
}
