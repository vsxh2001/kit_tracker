import { useEffect, useRef, useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Download, Upload } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { EntityFormDialog } from "../components/EntityFormDialog";
import { ImportEntitiesDialog } from "../components/ImportEntitiesDialog";
import { listEntities, updateEntity, exportEntitiesCsv } from "../services/entities";
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
import type { Entity } from "../types";

export function EntitiesPage() {
  const navigate = useNavigate();
  const { canDecideRequests } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Entity | undefined>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Entity | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"retire" | "activate" | null>(null);
  const bulkActionRef = useRef(false);
  const confirmActionRef = useRef(false);

  async function load() {
    setLoading(true);
    try {
      setEntities(await listEntities());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  async function handleExport() {
    try {
      const csv = await exportEntitiesCsv();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toLocaleDateString("en-CA");
      a.download = `entities-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  function openEdit(e: Entity) {
    setEditTarget(e);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(undefined);
  }

  async function confirmAction() {
    if (!pending) return;
    // Synchronous guard against double-click: setPending(null) only fires after the
    // React commit, so a second click in the same tick would re-enter updateEntity
    // and double the writes (2 updates + 2 audit rows).
    if (confirmActionRef.current) return;
    const entity = pending;
    confirmActionRef.current = true;
    setPending(null);
    try {
      await updateEntity(entity.id, { is_active: false });
      toast({ title: "Entity deactivated", description: entity.name, variant: "success" });
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to deactivate",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      confirmActionRef.current = false;
    }
  }

  async function confirmBulkAction() {
    if (!bulkAction) return;
    // Synchronous guard against double-click: setBulkAction(null) only fires after the
    // React commit, so a second click in the same tick would re-enter Promise.all and
    // double the writes (2N updateEntity calls + 2N audit rows).
    if (bulkActionRef.current) return;
    const ids = Array.from(selected);
    const isRetire = bulkAction === "retire";
    bulkActionRef.current = true;
    setBulkAction(null);
    try {
      await Promise.all(
        ids.map((id) => updateEntity(id, { is_active: !isRetire }))
      );
      setSelected(new Set());
      await load();
      toast({
        title: `${ids.length} ${ids.length === 1 ? "entity" : "entities"} ${isRetire ? "retired" : "activated"}`,
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: `Bulk ${bulkAction} failed`, description: err?.message, variant: "destructive" });
    } finally {
      bulkActionRef.current = false;
    }
  }

  const filtered = categoryFilter === "all"
    ? entities
    : entities.filter((e) => e.category === categoryFilter);

  const selectedEntities = filtered.filter((e) => selected.has(e.id));
  const anyActiveSelected = selectedEntities.some((e) => e.is_active);
  const anyInactiveSelected = selectedEntities.some((e) => !e.is_active);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const someFilteredSelected = filtered.some((e) => selected.has(e.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((e) => e.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Directory</p>
          <h1 className="text-2xl font-semibold">Entities</h1>
        </div>
        {canDecideRequests && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              New entity
            </Button>
          </div>
        )}
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="field">Field</SelectItem>
            <SelectItem value="storage">Storage</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk toolbar — desktop only, shown when >= 1 selected */}
      {selected.size >= 1 && (
        <div className="hidden md:flex items-center gap-3 rounded-lg border bg-slate-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-muted-foreground">{selected.size} selected</span>
          {canDecideRequests && anyActiveSelected && (
            <Button size="sm" variant="destructive" onClick={() => setBulkAction("retire")}>
              Retire
            </Button>
          )}
          {canDecideRequests && anyInactiveSelected && (
            <Button size="sm" variant="outline" onClick={() => setBulkAction("activate")}>
              Activate
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">No entities.</p>
          )}

          {/* Mobile card list — no checkboxes */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border bg-card px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                  onClick={() => navigate(`/entities/${e.id}`)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-sm">{e.name}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={e.category === "storage" ? "default" : "outline"} className="text-xs">
                        {e.category === "storage" ? "Storage" : "Field"}
                      </Badge>
                      <Badge variant={e.is_active ? "success" : "gray"}>{e.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                  </div>
                  {e.description && <p className="text-xs text-muted-foreground mb-2">{e.description}</p>}
                  {canDecideRequests && (
                    <div className="flex gap-2 mt-2" onClick={(ev) => ev.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => openEdit(e)}>Edit</Button>
                      {e.is_active && (
                        <Button variant="destructive" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => setPending(e)}>
                          Deactivate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                          onChange={toggleSelectAll}
                          aria-label="Select all"
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Description</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Active</th>
                      {canDecideRequests && <th className="p-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/entities/${e.id}`)}>
                        <td className="p-3" onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggleOne(e.id)}
                            aria-label={`Select ${e.name}`}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="p-3 font-medium">{e.name}</td>
                        <td className="p-3">
                          <Badge variant={e.category === "storage" ? "default" : "outline"} className="text-xs">
                            {e.category === "storage" ? "Storage" : "Field"}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{e.description ?? "—"}</td>
                        <td className="p-3">
                          <Badge variant={e.is_active ? "success" : "gray"}>
                            {e.is_active ? "Yes" : "No"}
                          </Badge>
                        </td>
                        {canDecideRequests && (
                          <td className="p-3">
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>Edit</Button>
                              {e.is_active && (
                                <Button variant="destructive" size="sm" onClick={(ev) => { ev.stopPropagation(); setPending(e); }}>
                                  Deactivate
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <EntityFormDialog
        entity={editTarget}
        open={showForm}
        onClose={closeForm}
        onSaved={load}
      />

      <ImportEntitiesDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={load}
      />

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate "{pending?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Inactive entities are hidden from new transactions but historical records remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmAction}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkAction !== null} onOpenChange={(o) => !o && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "retire" ? "Retire" : "Activate"} {selected.size} {selected.size === 1 ? "entity" : "entities"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === "retire"
                ? "Retired entities are hidden from new transactions but historical records remain."
                : "Selected entities will be marked active and appear in entity lists."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={bulkAction === "retire" ? "destructive" : "default"}
              onClick={confirmBulkAction}
            >
              {bulkAction === "retire" ? "Retire" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
