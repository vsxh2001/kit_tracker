import { useEffect, useState, startTransition } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AddComponentDialog } from "../components/AddComponentDialog";
import { listComponents } from "../services/components";
import { listAllComponentTransactions } from "../services/componentTransactions";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { expiryStatus, daysUntilExpiry } from "../lib/utils";
import type { Component, ComponentTransaction, Kit } from "../types";

interface ComponentRow {
  component: Component;
  latestTx?: ComponentTransaction;
}

function productLabel(component: Component): string {
  const p = component.expand?.product;
  if (!p) return "—";
  const parts = [p.name];
  if (p.manufacturer || p.model) parts.push([p.manufacturer, p.model].filter(Boolean).join(" "));
  return parts.join(" · ");
}

function currentKitSerial(latestTx?: ComponentTransaction): string | null {
  if (!latestTx?.to_kit) return null;
  if (latestTx.expand?.to_kit) return latestTx.expand.to_kit.serial;
  return latestTx.to_kit;
}

function currentKitId(latestTx?: ComponentTransaction): string | null {
  if (!latestTx?.to_kit) return null;
  return latestTx.to_kit;
}

function th(label: string) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider">
      {label}
    </th>
  );
}

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const status = expiryStatus(expiresAt);
  if (status === "none" || status === "ok") return null;
  const days = daysUntilExpiry(expiresAt);
  if (status === "expired") {
    return <Badge variant="destructive" className="text-xs">Expired {Math.abs(days)}d ago</Badge>;
  }
  return <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-100">Expires in {days}d</Badge>;
}

interface SectionTableProps {
  rows: ComponentRow[];
  isSerializedSection: boolean;
  navigate: ReturnType<typeof useNavigate>;
  emptyMessage: string;
}

function SectionTable({ rows, isSerializedSection, navigate, emptyMessage }: SectionTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">{emptyMessage}</p>
    );
  }

  return (
    <>
      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {rows.map(({ component, latestTx }) => {
          const kitSerial = currentKitSerial(latestTx);
          const kitId = currentKitId(latestTx);
          const product = component.expand?.product;
          return (
            <Link key={component.id} to={`/components/${component.id}`}>
              <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  {isSerializedSection ? (
                    <span className="font-mono font-medium text-xs tracking-wide text-indigo-700">
                      {component.serial || "—"}
                    </span>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      Qty × {component.quantity}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1.5">
                    {product && (
                      <Badge variant="outline" className="text-xs">{product.name}</Badge>
                    )}
                    {product?.is_consumable && (
                      <Badge variant="outline" className="text-xs">Consumable</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {kitSerial && kitId ? (
                      <span>Kit: {kitSerial}</span>
                    ) : (
                      <span>—</span>
                    )}
                    {component.bin_code && (
                      <span className="font-mono text-indigo-700">Bin: {component.bin_code}</span>
                    )}
                    {component.lot_code && (
                      <span className="font-mono text-indigo-700">Lot: {component.lot_code}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!component.is_active && (
                      <Badge variant="destructive" className="text-xs">Inactive</Badge>
                    )}
                    <ExpiryBadge expiresAt={component.expires_at} />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className="overflow-hidden hidden md:block">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80">
                {th("Product")}
                {isSerializedSection ? th("Serial") : th("Quantity")}
                {th("Kit")}
                {th("Bin")}
                {th("Lot")}
                {th("Active")}
                {th("Actions")}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ component, latestTx }) => {
                const kitSerial = currentKitSerial(latestTx);
                const kitId = currentKitId(latestTx);
                const product = component.expand?.product;
                return (
                  <tr
                    key={component.id}
                    className="border-b last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/components/${component.id}`)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {product ? (
                          <Link
                            to={`/products/${product.id}`}
                            className="text-indigo-600 hover:underline font-medium text-xs"
                          >
                            {productLabel(component)}
                          </Link>
                        ) : (
                          <span className="font-medium text-xs text-muted-foreground">—</span>
                        )}
                        {product?.is_consumable && (
                          <Badge variant="outline" className="text-xs">Consumable</Badge>
                        )}
                      </div>
                    </td>
                    {isSerializedSection ? (
                      <td className="px-4 py-3 font-mono text-xs text-indigo-700 tabular-nums">
                        {component.serial || <span className="text-muted-foreground opacity-40">—</span>}
                      </td>
                    ) : (
                      <td className="px-4 py-3 tabular-nums text-xs">{component.quantity}</td>
                    )}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {kitSerial && kitId ? (
                        <Link
                          to={`/kits/${kitId}`}
                          className="text-indigo-600 hover:underline text-xs"
                        >
                          {kitSerial}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-700">
                      {component.bin_code || <span className="text-muted-foreground opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-700">
                      {component.lot_code || <span className="text-muted-foreground opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        {component.is_active ? (
                          <Badge variant="outline" className="text-xs">Active</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">Inactive</Badge>
                        )}
                        <ExpiryBadge expiresAt={component.expires_at} />
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/components/${component.id}`}
                        className="text-indigo-600 hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

export function ComponentsPage() {
  const navigate = useNavigate();
  const { canDecideRequests } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ComponentRow[]>([]);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("__all__");
  const [kitFilter, setKitFilter] = useState("__all__");
  const [showInactive, setShowInactive] = useState(false);
  const expiringSoonOnly = searchParams.get("expiringSoon") === "true";
  const consumableOnly = searchParams.get("consumable") === "true";
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [components, allTxs] = await Promise.all([
        listComponents({ requestKey: "list-components-page" }),
        listAllComponentTransactions(),
      ]);
      // Dedupe latest tx per component
      const latestByComponent = new Map<string, ComponentTransaction>();
      for (const tx of allTxs) {
        if (!latestByComponent.has(tx.component)) latestByComponent.set(tx.component, tx);
      }
      setRows(components.map((c) => ({ component: c, latestTx: latestByComponent.get(c.id) })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  // Distinct active products from dataset — product filter is always active-only
  // regardless of the "show inactive components" toggle
  const allProducts = Array.from(
    new Map(
      rows
        .map(({ component }) => component.expand?.product)
        .filter((p): p is NonNullable<typeof p> => p != null && p.is_active)
        .map((p) => [p.id, p])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Distinct kits from dataset (only components that are in a kit)
  const allKits = Array.from(
    new Map(
      rows
        .map(({ latestTx }) => latestTx?.expand?.to_kit)
        .filter((k): k is Kit => Boolean(k))
        .map((k) => [k.id, k])
    ).values()
  ).sort((a, b) => a.serial.localeCompare(b.serial));

  // Apply filters (client-side)
  const filtered = rows.filter(({ component, latestTx }) => {
    // Active toggle — default hides inactive
    if (!showInactive && !component.is_active) return false;

    // Search (serial OR product name OR bin code OR lot code)
    if (search) {
      const q = search.toLowerCase();
      const productName = component.expand?.product?.name ?? "";
      const binCode = component.bin_code ?? "";
      const lotCode = component.lot_code ?? "";
      const matches =
        component.serial.toLowerCase().includes(q) ||
        productName.toLowerCase().includes(q) ||
        binCode.toLowerCase().includes(q) ||
        lotCode.toLowerCase().includes(q);
      if (!matches) return false;
    }

    // Product filter
    if (productFilter !== "__all__" && component.product !== productFilter) return false;

    // Kit filter
    if (kitFilter !== "__all__") {
      if (currentKitId(latestTx) !== kitFilter) return false;
    }

    // Expiring-soon filter (covers expired + expiring-soon, drops ok + none)
    if (expiringSoonOnly) {
      const s = expiryStatus(component.expires_at);
      if (s !== "expired" && s !== "expiring-soon") return false;
    }

    // Consumable-only filter — gates on the parent product's is_consumable flag
    if (consumableOnly && !component.expand?.product?.is_consumable) return false;

    return true;
  });

  function toggleConsumableOnly(next: boolean) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("consumable", "true");
      else params.delete("consumable");
      return params;
    });
  }

  function toggleExpiringSoonOnly(next: boolean) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set("expiringSoon", "true");
      else params.delete("expiringSoon");
      return params;
    });
  }

  // Sort: product name asc, then serial/quantity asc
  const sortedFiltered = [...filtered].sort((a, b) => {
    const pA = a.component.expand?.product?.name ?? "";
    const pB = b.component.expand?.product?.name ?? "";
    const cmp = pA.localeCompare(pB);
    if (cmp !== 0) return cmp;
    // Secondary: serial (serialized) or quantity (bulk)
    const sA = a.component.serial || String(a.component.quantity);
    const sB = b.component.serial || String(b.component.quantity);
    return sA.localeCompare(sB);
  });

  const serializedRows = sortedFiltered.filter(
    ({ component }) => component.expand?.product?.is_serialized !== false
  );
  const bulkRows = sortedFiltered.filter(
    ({ component }) => component.expand?.product?.is_serialized === false
  );

  const filtersEmpty =
    !search && productFilter === "__all__" && kitFilter === "__all__" && !showInactive;
  const noData = rows.filter((r) => r.component.is_active || showInactive).length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Inventory</p>
          <h1 className="text-2xl font-semibold tracking-tight">Components</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} component{rows.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        {canDecideRequests && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            New component
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search by serial, product, bin or lot…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All products" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All products</SelectItem>
            {allProducts.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kitFilter} onValueChange={setKitFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All kits" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All kits</SelectItem>
            {allKits.map((k) => (
              <SelectItem key={k.id} value={k.id}>{k.serial}</SelectItem>
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
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={expiringSoonOnly}
            onChange={(e) => toggleExpiringSoonOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Expiring soon only
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
          {/* Global empty state — no data at all and filters clear */}
          {filtersEmpty && noData && (
            <div className="py-12 text-center">
              <p className="text-muted-foreground text-sm">No components yet — create one</p>
              {canDecideRequests && (
                <Button size="sm" className="mt-3" onClick={() => setShowAdd(true)}>
                  <Plus className="h-4 w-4" />
                  New component
                </Button>
              )}
            </div>
          )}

          {/* Serialized section */}
          {(!filtersEmpty || !noData) && (
            <>
              <div className="space-y-2">
                <h2 className="text-base font-semibold tracking-tight">Serialized components</h2>
                <SectionTable
                  rows={serializedRows}
                  isSerializedSection={true}
                  navigate={navigate}
                  emptyMessage="No serialized components match"
                />
              </div>

              {/* Bulk section */}
              <div className="space-y-2">
                <h2 className="text-base font-semibold tracking-tight">Bulk components</h2>
                <SectionTable
                  rows={bulkRows}
                  isSerializedSection={false}
                  navigate={navigate}
                  emptyMessage="No bulk components match"
                />
              </div>
            </>
          )}
        </>
      )}

      <AddComponentDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={load}
      />
    </div>
  );
}
