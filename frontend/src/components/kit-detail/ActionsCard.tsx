import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, ArrowRight, Download } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { MoveKitDialog } from "../MoveKitDialog";
import { KitFormDialog } from "../KitFormDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { softDeleteKit, exportKitTimelineCsv } from "../../services/kits";
import { useAuth } from "../../context/AuthContext";
import { toast } from "../ui/use-toast";
import type { Kit } from "../../types";

interface ActionsCardProps {
  kit: Kit;
  isAdmin: boolean;
  currentEntityId?: string;
  currentEntityName?: string;
  onChange: () => void;
}

export function ActionsCard({ kit, isAdmin, currentEntityId, currentEntityName, onChange }: ActionsCardProps) {
  const navigate = useNavigate();
  const { canTransferKits, canDecideRequests } = useAuth();
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const deactivatingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);

  async function handleDelete() {
    // Synchronous guard against double-click: the dialog stays open until navigate
    // fires, so a second click in the same tick would call softDeleteKit twice.
    if (deactivatingRef.current) return;
    deactivatingRef.current = true;
    try {
      await softDeleteKit(kit.id);
      toast({ title: "Kit deactivated", description: kit.serial, variant: "success" });
      navigate("/kits");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to deactivate kit", description: err?.message, variant: "destructive" });
    } finally {
      deactivatingRef.current = false;
    }
  }

  async function handleExport() {
    // Synchronous guard against double-click: setExporting is async so disabled={exporting}
    // doesn't propagate before a second click in the same tick. exportKitTimelineCsv() runs
    // a transactions getFullList + an audit_log query, both with shared requestKeys
    // ("export-kit-timeline-<id>" and the via-tag lookup). Two parallel runs would let the
    // SDK auto-cancellation kill the first call, so the user gets no download.
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      await exportKitTimelineCsv(kit.id, kit.serial);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        toast({ title: "Failed to export timeline", description: err?.message, variant: "destructive" });
      }
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          {canTransferKits && (
            <Button size="sm" onClick={() => setIsMoveOpen(true)}>
              <ArrowRight className="h-4 w-4" />
              Move kit
            </Button>
          )}
          {canDecideRequests && (
            <Button size="sm" variant="outline" onClick={() => setIsEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export timeline"}
          </Button>
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={() => setIsDeactivateOpen(true)}>
              Deactivate
            </Button>
          )}
        </CardContent>
      </Card>

      <MoveKitDialog
        kit={kit}
        currentEntityId={currentEntityId}
        currentEntityName={currentEntityName}
        open={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        onMoved={onChange}
      />
      <KitFormDialog
        kit={kit}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onSaved={onChange}
      />

      <AlertDialog open={isDeactivateOpen} onOpenChange={setIsDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate kit?</AlertDialogTitle>
            <AlertDialogDescription>
              Kit <strong>{kit.serial}</strong> will be hidden from the catalog. Historical transactions remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
