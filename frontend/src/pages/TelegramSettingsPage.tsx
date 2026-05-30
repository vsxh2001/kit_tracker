import { useEffect, useState, startTransition } from "react";
import { Navigate } from "react-router-dom";
import { Send, Check, X, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "../components/ui/use-toast";
import { getTelegramStatus } from "../services/telegram";
import { useAuth } from "../context/AuthContext";
import type { TelegramStatus } from "../services/telegram";

export function TelegramSettingsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setStatus(await getTelegramStatus());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Failed to load Telegram status",
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

  const configured = status && status.configured === true ? status : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Send className="h-6 w-6 text-sky-500 shrink-0" />
        <h1 className="text-xl font-semibold tracking-tight">Telegram</h1>
      </div>

      {/* Not configured */}
      {!loading && status && !status.configured && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Telegram not configured</p>
                <p className="text-sm text-muted-foreground">
                  Set the <code className="text-xs bg-muted px-1 py-0.5 rounded">TELEGRAM_BOT_TOKEN</code> Fly secret to enable Telegram integration.
                  Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-500 underline">@BotFather</a> and copy the token it returns.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bot identity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bot</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20" />
            </div>
          ) : !configured?.bot ? (
            <p className="text-sm text-muted-foreground">
              {status?.configured ? "Bot info unavailable — getMe call failed." : "Configure TELEGRAM_BOT_TOKEN to see bot info."}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono font-medium">@{configured.bot.username}</p>
                <Badge variant="success">
                  <Check className="h-3 w-3 mr-1" />
                  connected
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{configured.bot.first_name}</p>
              <p className="text-xs text-muted-foreground">ID: {configured.bot.id}</p>
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
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : !configured?.webhook ? (
            <p className="text-sm text-muted-foreground">
              {status?.configured ? "Webhook info unavailable — getWebhookInfo call failed." : "Configure TELEGRAM_BOT_TOKEN to see webhook info."}
            </p>
          ) : configured.webhook.url ? (
            <div className="space-y-3">
              <p className="text-sm font-mono break-all">{configured.webhook.url}</p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>Pending updates: <span className="text-foreground font-medium">{configured.webhook.pending_update_count}</span></span>
              </div>
              {configured.webhook.last_error_message && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">Last error</p>
                  <p className="mt-0.5">{configured.webhook.last_error_message}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <X className="h-4 w-4 text-red-500 shrink-0" />
              No webhook registered — run setWebhook to connect.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked users */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Linked Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-5 w-24" />
          ) : !configured ? (
            <p className="text-sm text-muted-foreground">Configure TELEGRAM_BOT_TOKEN to see linked user count.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-2xl font-semibold">{configured.linked_users_count}</p>
              <p className="text-sm text-muted-foreground">users with Telegram linked</p>
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
