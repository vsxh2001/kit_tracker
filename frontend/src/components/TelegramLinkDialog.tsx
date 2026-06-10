import { useRef, useState, useEffect, startTransition } from "react";
import { Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { mintTelegramLinkCode } from "../services/telegram";
import type { TelegramLinkCodeResponse } from "../services/telegram";

interface Props {
  open: boolean;
  onClose: () => void;
}

function expiryLabel(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const mins = Math.ceil(diff / 60_000);
  return `~${mins} min`;
}

export function TelegramLinkDialog({ open, onClose }: Props) {
  const [result, setResult] = useState<TelegramLinkCodeResponse | null>(null);
  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    // Synchronous guard against double-click: setLoading is async so disabled={loading}
    // doesn't propagate before a second click in the same tick. A double-click on
    // "Generate new code" would POST /api/tg/link/code twice — the second call
    // invalidates the first (per the link-code hook), wasting the code the user
    // may have already started copying.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await mintTelegramLinkCode();
      setResult(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        setError(err?.message ?? "Failed to generate code");
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setResult(null);
        setError(null);
        void mint();
      });
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Link Telegram
          </DialogTitle>
          <DialogDescription>
            Connect your Telegram account to receive notifications via the bot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {loading && (
            <p className="text-sm text-muted-foreground">Generating code…</p>
          )}

          {error && !loading && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {result && !loading && (
            <div className="space-y-3">
              {result.deep_link ? (
                <a
                  href={result.deep_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" />
                  Open Telegram &amp; link
                </a>
              ) : null}

              <div className="rounded-md border bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {result.instructions}
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono bg-white border rounded px-2 py-1 break-all select-all">
                    /start {result.code}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground">
                  Expires in {expiryLabel(result.expires_at)}. Single use.
                </p>
              </div>
            </div>
          )}

          {!loading && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => startTransition(() => void mint())}
              disabled={loading}
            >
              Generate new code
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
