import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { EntityFormDialog } from "../components/EntityFormDialog";
import { listEntities, updateEntity, deleteEntity } from "../services/entities";
import { useAuth } from "../context/AuthContext";
import type { Entity } from "../types";

export function EntitiesPage() {
  const { isAdmin } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Entity | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setEntities(await listEntities(true));
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openEdit(e: Entity) {
    setEditTarget(e);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(undefined);
  }

  async function handleDeactivate(e: Entity) {
    if (!confirm(`Deactivate "${e.name}"?`)) return;
    await updateEntity(e.id, { is_active: false });
    load();
  }

  async function handleDelete(e: Entity) {
    if (!confirm(`Delete "${e.name}"? This cannot be undone.`)) return;
    try {
      await deleteEntity(e.id);
      setError(null);
      load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete entity.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Entities</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            New entity
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Active</th>
                  {isAdmin && <th className="p-3" />}
                </tr>
              </thead>
              <tbody>
                {entities.length === 0 && (
                  <tr><td colSpan={isAdmin ? 4 : 3} className="p-4 text-center text-muted-foreground">No entities.</td></tr>
                )}
                {entities.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 font-medium">{e.name}</td>
                    <td className="p-3 text-muted-foreground">{e.description ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant={e.is_active ? "success" : "gray"}>
                        {e.is_active ? "Yes" : "No"}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="p-3">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>Edit</Button>
                          {e.is_active && (
                            <Button variant="ghost" size="sm" onClick={() => handleDeactivate(e)}>
                              Deactivate
                            </Button>
                          )}
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(e)}>
                            Delete
                          </Button>
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

      <EntityFormDialog
        entity={editTarget}
        open={showForm}
        onClose={closeForm}
        onSaved={load}
      />
    </div>
  );
}
