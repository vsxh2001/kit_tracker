import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { CascadeDeleteDialog } from "../CascadeDeleteDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { toast } from "../ui/use-toast";
import { softDeleteKit } from "../../services/kits";
import type { Kit } from "../../types";

interface DangerZoneCardProps {
  kit: Kit;
  isAdmin: boolean;
  onDeleted: () => void;
}

export function DangerZoneCard({ kit, isAdmin, onDeleted }: DangerZoneCardProps) {
  const [showCascadeDelete, setShowCascadeDelete] = useState(false);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const deactivatingRef = useRef(false);

  if (!isAdmin) return null;

  async function handleDeactivate() {
    // Synchronous guard against double-click: setConfirmDeactivateOpen(false) only fires after
    // the React commit, so a second click in the same tick would re-enter softDeleteKit.
    if (deactivatingRef.current) return;
    deactivatingRef.current = true;
    try {
      await softDeleteKit(kit.id);
      toast({ title: "Kit deactivated", description: kit.serial, variant: "success" });
      onDeleted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate", description: err?.message, variant: "destructive" });
    } finally {
      deactivatingRef.current = false;
    }
  }

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {kit.is_active && (
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                Mark this kit inactive. It will be hidden from the default list but its history is preserved. Reversible.
              </p>
              <AlertDialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="min-h-[44px]">
                    Deactivate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Deactivate this kit?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The kit will be hidden from the default kits list and selectors. Transaction history is preserved. You can reactivate later from the Kits page by switching the status filter to Retired and using the bulk Activate action.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDeactivate}>Deactivate</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          <div>
            <p className="text-sm text-muted-foreground mb-3">
              Hard-delete this kit and all dependent rows. Last-resort tool to fix history.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowCascadeDelete(true)}
            >
              Cascade Hard Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <CascadeDeleteDialog
        open={showCascadeDelete}
        onOpenChange={setShowCascadeDelete}
        collection="kits"
        recordId={kit.id}
        onDeleted={() => {
          toast({ title: "Kit deleted with cascade", variant: "success" });
          onDeleted();
        }}
      />
    </>
  );
}
