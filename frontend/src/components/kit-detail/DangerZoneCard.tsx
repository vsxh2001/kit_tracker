import { useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { CascadeDeleteDialog } from "../CascadeDeleteDialog";
import { toast } from "../ui/use-toast";
import type { Kit } from "../../types";

interface DangerZoneCardProps {
  kit: Kit;
  isAdmin: boolean;
  onDeleted: () => void;
}

export function DangerZoneCard({ kit, isAdmin, onDeleted }: DangerZoneCardProps) {
  const [showCascadeDelete, setShowCascadeDelete] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
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
