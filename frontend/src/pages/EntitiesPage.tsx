import { useEffect, useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { EntityFormDialog } from "../components/EntityFormDialog";
import { listEntities, updateEntity, deleteEntity } from "../services/entities";
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

type ConfirmKind = "deactivate" | "delete";
interface PendingConfirm { kind: ConfirmKind; entity: Entity; }

export function EntitiesPage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Entity | undefined>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  async function load() {
    setLoading(true);
    try {
      setEntities(await listEntities(true));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

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
    const { kind, entity } = pending;
    setPending(null);
    try {
      if (kind === "deactivate") {
        await updateEntity(entity.id, { is_active: false });
        toast({ title: "Entity deactivated", description: entity.name, variant: "success" });
      } else {
        await deleteEntity(entity.id);
        toast({ title: "Entity deleted", description: entity.name, variant: "success" });
      }
      load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: kind === "deactivate" ? "Failed to deactivate" : "Failed to delete",
        description: err?.message,
        variant: "destructive",
      });
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
                  <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/entities/${e.id}`)}>
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
                          <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>Edit</Button>
                          {e.is_active && (
                            <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); setPending({ kind: "deactivate", entity: e }); }}>
                              Deactivate
                            </Button>
                          )}
                          <Button variant="destructive" size="sm" onClick={(ev) => { ev.stopPropagation(); setPending({ kind: "delete", entity: e }); }}>
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

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "deactivate"
                ? `Deactivate "${pending?.entity.name}"?`
                : `Delete "${pending?.entity.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "deactivate"
                ? "Inactive entities are hidden from new transactions but historical records remain."
                : "This permanently removes the entity. Cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.kind === "delete" ? "destructive" : "default"}
              onClick={confirmAction}
            >
              {pending?.kind === "deactivate" ? "Deactivate" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
