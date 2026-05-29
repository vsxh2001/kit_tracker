import { useState, startTransition } from "react";
import { Navigate, Link } from "react-router-dom";
import { Radio, Send, ChevronLeft, Check, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { toast } from "../components/ui/use-toast";
import { broadcastTelegram } from "../services/telegram";
import { useAuth } from "../context/AuthContext";
import type { TelegramBroadcastResult } from "../services/telegram";

const ROLES = ["admin", "technician", "user", "viewer"] as const;
type Role = typeof ROLES[number];

export function TelegramBroadcastPage() {
  const { isAdmin, loading: authLoading } = useAuth();

  // Recipient filter state
  const [filterType, setFilterType] = useState<"role" | "chat_ids">("role");
  const [selectedRole, setSelectedRole] = useState<Role>("user");
  const [chatIdsText, setChatIdsText] = useState("");

  // Message state
  const [text, setText] = useState("");

  // Send state
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<TelegramBroadcastResult | null>(null);

  function recipientCount(): number {
    if (filterType === "role") return 0; // unknown until server resolves
    return chatIdsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0).length;
  }

  function isValid(): boolean {
    if (!text.trim()) return false;
    if (filterType === "chat_ids" && recipientCount() === 0) return false;
    return true;
  }

  function handleSendClick() {
    if (!isValid()) return;
    const count = recipientCount();
    if (filterType === "chat_ids" && count >= 10) {
      setConfirmOpen(true);
    } else {
      startTransition(() => doSend());
    }
  }

  async function doSend() {
    setSending(true);
    setResult(null);
    try {
      const chatIds =
        filterType === "chat_ids"
          ? chatIdsText
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.length > 0)
          : undefined;

      const res = await broadcastTelegram(
        filterType === "role"
          ? { type: "role", value: selectedRole }
          : { type: "chat_ids", value: chatIds! },
        text.trim()
      );

      setResult(res);

      if (res.total === 0) {
        toast({
          title: "No recipients",
          description: "No linked users found for the selected filter.",
          variant: "destructive",
        });
      } else if (res.sent === res.total) {
        toast({
          title: "Broadcast sent",
          description: `${res.sent} of ${res.total} messages delivered.`,
          variant: "success",
        });
      } else if (res.sent > 0) {
        toast({
          title: "Broadcast partially sent",
          description: `${res.sent} of ${res.total} delivered. ${res.failed} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Broadcast failed",
          description: `All ${res.total} sends failed.`,
          variant: "destructive",
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Broadcast error",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setSending(false);
    }
  }

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const count = recipientCount();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Link
          to="/settings/telegram"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to Telegram settings"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <Radio className="h-6 w-6 text-sky-500 shrink-0" />
        <h1 className="text-xl font-semibold tracking-tight">Telegram Broadcast</h1>
      </div>

      {/* Recipient selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recipients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter type radio */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="filterType"
                value="role"
                checked={filterType === "role"}
                onChange={() => setFilterType("role")}
                className="accent-indigo-600"
              />
              By role
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="filterType"
                value="chat_ids"
                checked={filterType === "chat_ids"}
                onChange={() => setFilterType("chat_ids")}
                className="accent-indigo-600"
              />
              By chat ID list
            </label>
          </div>

          {filterType === "role" && (
            <div className="space-y-2">
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as Role)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Sends to all users with this role who have Telegram linked.
              </p>
            </div>
          )}

          {filterType === "chat_ids" && (
            <div className="space-y-2">
              <Textarea
                placeholder={"123456789\n-1001234567890\n..."}
                value={chatIdsText}
                onChange={(e) => setChatIdsText(e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{count}</span>{" "}
                chat ID{count !== 1 ? "s" : ""} entered
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Message composer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Type your message... (HTML supported)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            Telegram supports basic HTML: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, &lt;a href&gt;
          </p>
        </CardContent>
      </Card>

      {/* Send button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSendClick}
          disabled={sending || !isValid()}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          {sending ? "Sending..." : "Send broadcast"}
        </Button>
      </div>

      {/* Result card */}
      {result !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {result.failed === 0 && result.total > 0 ? (
                <Check className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500" />
              )}
              Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="font-semibold text-lg">{result.total}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sent</p>
                <p className="font-semibold text-lg text-emerald-600">{result.sent}</p>
              </div>
              {result.failed > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Failed</p>
                  <p className="font-semibold text-lg text-red-600">{result.failed}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog for N >= 10 chat_ids */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {count} recipients?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a Telegram message to{" "}
              <span className="font-semibold">{count} chat IDs</span>.{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                startTransition(() => doSend());
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
