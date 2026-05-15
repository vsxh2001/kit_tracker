import { useEffect, useState, startTransition } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AddComponentDialog } from "../components/AddComponentDialog";
import { listComponents } from "../services/components";
import { pb } from "../lib/pocketbase";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { Component, ComponentTransaction } from "../types";

interface ComponentRow {
  component: Component;
  latestTx?: ComponentTransaction;
}

export function ComponentsPage() {
  const { canDecideRequests } = useAuth();
  const [rows, setRows] = useState<ComponentRow[]>([]);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<"all" | "in-kit" | "standalone">("all");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [components, allTxs] = await Promise.all([
        listComponents({ activeOnly: true }),
        pb.collection("component_transactions").getFullList<ComponentTransaction>({
          sort: "-timestamp,-created",
          expand: "to_kit,to_entity",
          requestKey: "components-page-all-tx",
        }),
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

  const filtered = rows.filter(({ component, latestTx }) => {
    if (search) {
      const q = search.toLowerCase();
      const productName = component.expand?.product?.name ?? "";
      const matches =
        component.serial.toLowerCase().includes(q) ||
        productName.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (locationFilter === "in-kit") {
      if (!latestTx?.to_kit) return false;
    } else if (locationFilter === "standalone") {
      if (latestTx?.to_kit) return false;
    }
    return true;
  });

  function containerLabel(tx?: ComponentTransaction) {
    if (!tx) return "—";
    if (tx.expand?.to_kit) return `Kit: ${tx.expand.to_kit.serial}`;
    if (tx.expand?.to_entity) return `Entity: ${tx.expand.to_entity.name}`;
    if (tx.to_kit) return `Kit: ${tx.to_kit}`;
    if (tx.to_entity) return `Entity: ${tx.to_entity}`;
    return "—";
  }

  function containerLink(tx?: ComponentTransaction): string | null {
    if (!tx) return null;
    if (tx.to_kit) return `/kits/${tx.to_kit}`;
    if (tx.to_entity) return `/entities/${tx.to_entity}`;
    return null;
  }

  function productLabel(component: Component): string {
    const p = component.expand?.product;
    if (!p) return "—";
    const parts = [p.name];
    if (p.manufacturer || p.model) parts.push([p.manufacturer, p.model].filter(Boolean).join(" "));
    return parts.join(" · ");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Inventory</p>
          <h1 className="text-2xl font-semibold tracking-tight">Components</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{rows.length} component{rows.length !== 1 ? "s" : ""} registered</p>
        </div>
        {canDecideRequests && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            New component
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search by serial or product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Select value={locationFilter} onValueChange={(v) => setLocationFilter(v as typeof locationFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            <SelectItem value="in-kit">In kit</SelectItem>
            <SelectItem value="standalone">Standalone</SelectItem>
          </SelectContent>
        </Select>
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
            <p className="text-muted-foreground text-sm py-8 text-center">No components found.</p>
          )}

          {/* Mobile card list */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map(({ component, latestTx }) => {
                const link = containerLink(latestTx);
                const product = component.expand?.product;
                return (
                  <Link key={component.id} to={`/components/${component.id}`}>
                    <div className="rounded-lg border bg-card px-4 py-3 hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        {component.serial ? (
                          <span className="font-mono font-medium text-xs tracking-wide text-indigo-700">{component.serial}</span>
                        ) : component.is_bulk ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Bulk × {component.quantity}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-40">—</span>
                        )}
                        {product && (
                          <Badge variant="outline" className="text-[10px]">{product.name}</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{link ? containerLabel(latestTx) : "—"}</span>
                        {component.is_bulk && <span>Qty: {component.quantity}</span>}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {component.is_bulk && <Badge variant="secondary" className="text-[10px]">Bulk</Badge>}
                        {!component.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <Card className="overflow-hidden hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Product / Serial</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Container</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Bulk</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">Created</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ component, latestTx }) => {
                      const link = containerLink(latestTx);
                      const product = component.expand?.product;
                      return (
                        <tr key={component.id} className="border-b last:border-0 hover:bg-slate-50/60 transition-colors group">
                          <td className="px-4 py-3">
                            {product ? (
                              <Link to={`/products/${product.id}`} className="text-indigo-600 hover:underline font-medium text-xs">
                                {productLabel(component)}
                              </Link>
                            ) : (
                              <span className="font-medium text-xs text-muted-foreground">—</span>
                            )}
                            {component.serial ? (
                              <div className="font-mono text-[11px] text-indigo-700 mt-0.5">{component.serial}</div>
                            ) : component.is_bulk ? (
                              <div className="mt-0.5">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Bulk × {component.quantity}</Badge>
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {link ? (
                              <Link to={link} className="text-indigo-600 hover:underline text-xs">
                                {containerLabel(latestTx)}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground opacity-40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-xs">{component.quantity}</td>
                          <td className="px-4 py-3">
                            {component.is_bulk
                              ? <Badge variant="secondary" className="text-[10px]">Bulk</Badge>
                              : <span className="text-muted-foreground opacity-40">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {component.is_active
                              ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                              : <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs tabular-nums">
                            {formatDate(component.created)}
                          </td>
                          <td className="px-4 py-3">
                            <Link to={`/components/${component.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
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
