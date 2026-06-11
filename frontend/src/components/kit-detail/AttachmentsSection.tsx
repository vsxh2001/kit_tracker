import { useEffect, useRef, startTransition } from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { AttachmentList } from "../AttachmentList";
import { getKit, uploadKitAttachment, deleteKitAttachment, getAttachmentToken } from "../../services/kits";
import { toast } from "../ui/use-toast";
import type { Kit } from "../../types";

interface AttachmentsSectionProps {
  kitId: string;
  isAdmin: boolean;
}

export function AttachmentsSection({ kitId, isAdmin }: AttachmentsSectionProps) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [fileToken, setFileToken] = useState<string>("");
  const deletingRef = useRef(false);

  async function loadKit() {
    try {
      setKit(await getKit(kitId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  async function refreshFileToken() {
    try {
      setFileToken(await getAttachmentToken());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => loadKit()); }, [kitId]);

  // PB file tokens default to a 120s TTL — refresh ahead of expiry so links
  // stay valid on long-lived detail views.
  useEffect(() => {
    startTransition(() => refreshFileToken());
    const id = setInterval(() => startTransition(() => refreshFileToken()), 90_000);
    return () => clearInterval(id);
  }, []);

  if (!kit) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <AttachmentList
          kit={kit}
          fileToken={fileToken}
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
            // Synchronous guard against double-click: the AlertDialog closes on action click,
            // but a second click in the same tick (before React commits) would re-enter and
            // PATCH a second time, causing a 404 toast or deleting a sibling attachment if the
            // filename list shifts.
            if (deletingRef.current) return;
            deletingRef.current = true;
            try {
              const updated = await deleteKitAttachment(kit.id, filename);
              setKit(updated);
              toast({ title: "Attachment deleted", description: filename, variant: "success" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
              toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
            } finally {
              deletingRef.current = false;
            }
          } : undefined}
        />
      </CardContent>
    </Card>
  );
}
