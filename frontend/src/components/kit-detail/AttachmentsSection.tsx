import { useEffect, startTransition } from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { AttachmentList } from "../AttachmentList";
import { getKit, uploadKitAttachment, deleteKitAttachment } from "../../services/kits";
import { toast } from "../ui/use-toast";
import type { Kit } from "../../types";

interface AttachmentsSectionProps {
  kitId: string;
  isAdmin: boolean;
}

export function AttachmentsSection({ kitId, isAdmin }: AttachmentsSectionProps) {
  const [kit, setKit] = useState<Kit | null>(null);

  async function loadAttachments() {
    try {
      const k = await getKit(kitId);
      setKit(k);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => loadAttachments()); }, [kitId]);

  if (!kit) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <AttachmentList
          kit={kit}
          canEdit={isAdmin}
          onUpload={isAdmin ? async (file) => {
            try {
              const updated = await uploadKitAttachment(kit.id, file);
              setKit(updated);
              toast({ title: "File uploaded", description: file.name, variant: "success" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
            }
          } : undefined}
          onDelete={isAdmin ? async (filename) => {
            try {
              const updated = await deleteKitAttachment(kit.id, filename);
              setKit(updated);
              toast({ title: "Attachment deleted", description: filename, variant: "success" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
            }
          } : undefined}
        />
      </CardContent>
    </Card>
  );
}
