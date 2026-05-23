import { useEffect, useState, startTransition } from "react";
import { Navigate, Link } from "react-router-dom";
import { MessageCircle, Check, X, Copy, Radio, MessagesSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "../components/ui/use-toast";
import { getWhatsAppStatus } from "../services/whatsapp";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/utils";
import type { WhatsAppStatus } from "../services/whatsapp";

function qualityBadgeVariant(rating: string): "success" | "warning" | "destructive" | "gray" {
  if (rating === "HIGH") return "success";
  if (rating === "MEDIUM") return "warning";
  if (rating === "LOW") return "destructive";
  return "gray";
}

export function WhatsAppSettingsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setStatus(await getWhatsAppStatus());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Failed to load WhatsApp status",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <MessageCircle className="h-6 w-6 text-emerald-500 shrink-0" />
          <h1 className="text-xl font-semibold tracking-tight">WhatsApp</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/settings/whatsapp/conversations"
            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            <MessagesSquare className="h-4 w-4" />
            View conversations
          </Link>
          <Link
            to="/settings/whatsapp/broadcast"
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500 transition-colors"
          >
            <Radio className="h-4 w-4" />
            Broadcast
          </Link>
        </div>
      </div>

      {/* Phone number */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Phone Number</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-24" />
            </div>
          ) : !status?.phoneNumber ? (
            <p className="text-sm text-muted-foreground">Phone number info unavailable — check WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN secrets.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-mono font-medium">{status.phoneNumber.display}</p>
              <p className="text-sm text-muted-foreground">{status.phoneNumber.verified_name}</p>
              <Badge variant={qualityBadgeVariant(status.phoneNumber.quality_rating)}>
                {status.phoneNumber.quality_rating}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">ID: {status.phoneNumber.id}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Access token */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Access Token</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-1.5 mt-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          ) : !status?.token ? (
            <p className="text-sm text-muted-foreground">Token info unavailable — check WHATSAPP_TOKEN secret.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Type</p>
                  <p className="text-sm font-medium">{status.token.type}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Valid</p>
                  <p className="text-sm font-medium">{status.token.is_valid ? "Yes" : "No"}</p>
                </div>
              </div>
              {status.token.expires_at === 0 ? (
                <p className="text-sm text-emerald-600 font-medium">Never expires</p>
              ) : (
                <>
                  <p className="text-sm">
                    Expires in{" "}
                    <span className={status.token.days_remaining < 14 ? "text-red-600 font-semibold" : "font-medium"}>
                      {status.token.days_remaining} day{status.token.days_remaining !== 1 ? "s" : ""}
                    </span>
                  </p>
                  {status.token.days_remaining < 14 && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                      Token expires soon — renew before access is lost.
                    </div>
                  )}
                </>
              )}
              {status.token.scopes.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Scopes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {status.token.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Webhook</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-80" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : !status?.webhook ? (
            <p className="text-sm text-muted-foreground">Webhook info unavailable.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono break-all flex-1">{status.webhook.url}</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(status.webhook.url).then(() => {
                      toast({ title: "Copied to clipboard", variant: "success" });
                    }).catch(() => {
                      toast({ title: "Copy failed", variant: "destructive" });
                    });
                  }}
                  className="shrink-0 p-1.5 rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy URL"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {status.webhook.verify_token_set ? (
                  <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <X className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <span>Verify token {status.webhook.verify_token_set ? "configured" : "not configured"}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Last inbound:{" "}
                {status.webhook.last_inbound_at
                  ? <span className="text-foreground">{formatDate(status.webhook.last_inbound_at)}</span>
                  : "never"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WABA subscriptions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">WABA Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : !status?.waba ? (
            <p className="text-sm text-muted-foreground">WABA info unavailable — check WHATSAPP_WABA_ID secret.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">WABA ID: {status.waba.id}</p>
              {status.waba.subscribed_apps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subscribed apps.</p>
              ) : (
                <ul className="space-y-1">
                  {status.waba.subscribed_apps.map((app) => (
                    <li key={app.id} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium">{app.name}</span>
                      <span className="text-muted-foreground text-xs">{app.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && !status && (
        <div className="flex justify-center">
          <button
            onClick={() => startTransition(() => load())}
            className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
