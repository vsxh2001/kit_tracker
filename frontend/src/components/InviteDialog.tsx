import { useState, useEffect, startTransition } from "react";
import { Link2, Copy, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "./ui/use-toast";
import { createInvite, listInvites, revokeInvite } from "../services/invites";
import type { Invite } from "../services/invites";
import { formatDate } from "../lib/utils";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "technician", label: "Technician" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-red-100 text-red-700",
  technician: "bg-blue-100 text-blue-700",
  user: "bg-green-100 text-green-700",
  viewer: "bg-slate-100 text-slate-700",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteDialog({ open, onClose }: Props) {
  const [role, setRole] = useState("user");
  const [inviteEmail, setInviteEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function loadInvites() {
    setLoadingInvites(true);
    try {
      const all = await listInvites();
      // Show only pending (not used, not revoked, not expired)
      const now = new Date().toISOString();
      setInvites(
        all.filter(
          (inv) => !inv.used_at && !inv.revoked_at && inv.expires_at > now
        )
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoadingInvites(false);
    }
  }

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setGeneratedUrl(null);
        setCopied(false);
        setRole("user");
        setInviteEmail("");
        void loadInvites();
      });
    }
  }, [open]);

  async function handleGenerate() {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) {
      toast({ title: "Enter a valid email for the invite recipient.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const result = await createInvite(role, inviteEmail.trim());
      setGeneratedUrl(result.url);
      startTransition(() => loadInvites());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to generate invite",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy manually.", variant: "destructive" });
    }
  }

  async function handleRevoke(inv: Invite) {
    setRevoking(inv.id);
    try {
      await revokeInvite(inv.id);
      toast({ title: "Invite revoked", variant: "success" });
      startTransition(() => loadInvites());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({ title: "Failed to revoke", description: err?.message, variant: "destructive" });
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Invite user
          </DialogTitle>
          <DialogDescription>
            Generate a single-use invite link (7-day expiry). The recipient signs up via the link and is instantly assigned the chosen role.
          </DialogDescription>
        </DialogHeader>

        {/* Generator */}
        <div className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Recipient email</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="recipient@example.com"
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "Generating…" : "Generate link"}
            </Button>
          </div>

          {generatedUrl && (
            <div className="rounded-md border bg-slate-50 p-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Invite link (copy and share)</p>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1 text-slate-700">{generatedUrl}</code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Copy invite link"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Expires in 7 days. Single use.</p>
            </div>
          )}
        </div>

        {/* Pending invites list */}
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Pending invites {loadingInvites ? "(loading…)" : `(${invites.length})`}
          </p>
          {!loadingInvites && invites.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">No pending invites.</p>
          )}
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${ROLE_BADGE[inv.role] ?? "bg-slate-100 text-slate-700"}`}>
                  {inv.role}
                </span>
                {inv.email && (
                  <span className="text-xs text-foreground truncate font-medium">{inv.email}</span>
                )}
                <span className="text-xs text-muted-foreground truncate shrink-0">
                  Created {formatDate(inv.created)}
                </span>
              </div>
              <button
                onClick={() => handleRevoke(inv)}
                disabled={revoking === inv.id}
                className="shrink-0 text-muted-foreground hover:text-red-600 disabled:opacity-50"
                aria-label={`Revoke invite for role ${inv.role}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
