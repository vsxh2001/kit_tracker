import { useEffect, useState, startTransition } from "react";
import { Navigate, Link } from "react-router-dom";
import { Radio, Send, AlertCircle, Check, X, ChevronLeft } from "lucide-react";
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
import { broadcastWhatsApp, getRolePhoneCount, listTemplates } from "../services/whatsapp";
import { useAuth } from "../context/AuthContext";
import type { BroadcastResult, WhatsAppTemplate } from "../services/whatsapp";

const ROLES = ["admin", "technician", "user", "viewer"] as const;
type Role = typeof ROLES[number];

export function WhatsAppBroadcastPage() {
  const { isAdmin, loading: authLoading } = useAuth();

  // Recipient filter state
  const [filterType, setFilterType] = useState<"role" | "phones">("role");
  const [selectedRole, setSelectedRole] = useState<Role>("user");
  const [phoneListText, setPhoneListText] = useState("");
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [roleCountLoading, setRoleCountLoading] = useState(false);

  // Template list from Meta API
  const [approvedTemplates, setApprovedTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Message state
  const [msgType, setMsgType] = useState<"text" | "template">("text");
  const [freeText, setFreeText] = useState("");
  const [templateName, setTemplateName] = useState<string>("");
  const [templateLanguage, setTemplateLanguage] = useState<string>("en_US");

  // Send state
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  // Load approved templates from Meta API
  async function loadTemplates() {
    setTemplatesLoading(true);
    try {
      const all = await listTemplates();
      const approved = all.filter((t) => t.status === "APPROVED");
      setApprovedTemplates(approved);
      if (approved.length > 0 && !templateName) {
        setTemplateName(approved[0].name);
        setTemplateLanguage(approved[0].language);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setTemplatesLoading(false);
    }
  }

  useEffect(() => {
    startTransition(() => loadTemplates());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load role phone counts when role filter active
  async function loadRoleCount(role: Role) {
    setRoleCountLoading(true);
    try {
      const data = await getRolePhoneCount(role);
      setRoleCounts((prev) => ({ ...prev, [role]: data.count }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setRoleCountLoading(false);
    }
  }

  useEffect(() => {
    if (filterType === "role") {
      startTransition(() => loadRoleCount(selectedRole));
    }
  }, [filterType, selectedRole]);

  // Compute recipient count for preview
  function recipientCount(): number {
    if (filterType === "role") {
      return roleCounts[selectedRole] ?? 0;
    }
    return phoneListText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0).length;
  }

  function isValid(): boolean {
    if (recipientCount() === 0) return false;
    if (msgType === "text" && !freeText.trim()) return false;
    if (msgType === "template" && !templateName) return false;
    return true;
  }

  function handleSendClick() {
    if (!isValid()) return;
    // Show AlertDialog confirmation for N >= 10
    if (recipientCount() >= 10) {
      setConfirmOpen(true);
    } else {
      startTransition(() => doSend());
    }
  }

  async function doSend() {
    setSending(true);
    setResult(null);
    try {
      const phones =
        filterType === "phones"
          ? phoneListText
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.length > 0)
          : undefined;

      const res = await broadcastWhatsApp({
        recipientFilter:
          filterType === "role"
            ? { type: "role", value: selectedRole }
            : { type: "phones", value: phones! },
        message:
          msgType === "text"
            ? { type: "text", text: freeText.trim() }
            : { type: "template", template: { name: templateName, language: templateLanguage } },
      });

      setResult(res);

      if (res.successCount === res.totalRecipients) {
        toast({
          title: "Broadcast sent",
          description: `${res.successCount} of ${res.totalRecipients} messages delivered.`,
          variant: "success",
        });
      } else if (res.successCount > 0) {
        toast({
          title: "Broadcast partially sent",
          description: `${res.successCount} of ${res.totalRecipients} delivered. ${res.failed.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Broadcast failed",
          description: `All ${res.totalRecipients} sends failed.`,
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

  async function handleRetry(phone: string) {
    setSending(true);
    try {
      const res = await broadcastWhatsApp({
        recipientFilter: { type: "phones", value: [phone] },
        message:
          msgType === "text"
            ? { type: "text", text: freeText.trim() }
            : { type: "template", template: { name: templateName, language: templateLanguage } },
      });

      if (res.successCount === 1) {
        toast({ title: "Retry succeeded", description: `Sent to ${phone}`, variant: "success" });
        // Remove from failed list
        setResult((prev) =>
          prev
            ? {
                ...prev,
                successCount: prev.successCount + 1,
                failed: prev.failed.filter((f) => f.phone !== phone),
              }
            : prev
        );
      } else {
        toast({
          title: "Retry failed",
          description: res.failed[0]?.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        toast({
          title: "Retry error",
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
          to="/settings/whatsapp"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to WhatsApp settings"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <Radio className="h-6 w-6 text-emerald-500 shrink-0" />
        <h1 className="text-xl font-semibold tracking-tight">Broadcast</h1>
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
                value="phones"
                checked={filterType === "phones"}
                onChange={() => setFilterType("phones")}
                className="accent-indigo-600"
              />
              By phone list
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
            </div>
          )}

          {filterType === "phones" && (
            <Textarea
              placeholder={"972527799932\n972501234567\n..."}
              value={phoneListText}
              onChange={(e) => setPhoneListText(e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
          )}

          {/* Preview count */}
          <p className="text-sm text-muted-foreground">
            {filterType === "role" && roleCountLoading ? (
              "Counting..."
            ) : (
              <>
                <span className="font-semibold text-foreground">{count}</span>{" "}
                recipient{count !== 1 ? "s" : ""} will receive this message
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* Message composer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Message type toggle */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="msgType"
                value="text"
                checked={msgType === "text"}
                onChange={() => setMsgType("text")}
                className="accent-indigo-600"
              />
              Free-form text
              <span className="text-xs text-muted-foreground">(24h window only)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="msgType"
                value="template"
                checked={msgType === "template"}
                onChange={() => setMsgType("template")}
                className="accent-indigo-600"
              />
              Approved template
            </label>
          </div>

          {msgType === "text" && (
            <Textarea
              placeholder="Type your message..."
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={4}
            />
          )}

          {msgType === "template" && (
            <div className="space-y-2">
              {templatesLoading ? (
                <p className="text-sm text-muted-foreground">Loading templates...</p>
              ) : approvedTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved templates found.{" "}
                  <a
                    href="/settings/whatsapp/templates"
                    className="text-indigo-600 hover:text-indigo-500 underline"
                  >
                    View templates
                  </a>{" "}
                  or submit one for Meta approval.
                </p>
              ) : (
                <>
                  <Select
                    value={templateName}
                    onValueChange={(v) => {
                      const tmpl = approvedTemplates.find((t) => t.name === v);
                      setTemplateName(v);
                      if (tmpl) setTemplateLanguage(tmpl.language);
                    }}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Select template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {approvedTemplates.map((t) => (
                        <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                          {t.name} ({t.language})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Template: <span className="font-mono">{templateName}</span> / lang:{" "}
                    <span className="font-mono">{templateLanguage}</span>
                  </p>
                </>
              )}
            </div>
          )}
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
          {sending ? "Sending..." : `Send to ${count} recipient${count !== 1 ? "s" : ""}`}
        </Button>
      </div>

      {/* Result card */}
      {result !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {result.successCount === result.totalRecipients ? (
                <Check className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500" />
              )}
              Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="font-semibold text-lg">{result.totalRecipients}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sent</p>
                <p className="font-semibold text-lg text-emerald-600">{result.successCount}</p>
              </div>
              {result.failed.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Failed</p>
                  <p className="font-semibold text-lg text-red-600">{result.failed.length}</p>
                </div>
              )}
            </div>

            {result.message && (
              <p className="text-sm text-muted-foreground">{result.message}</p>
            )}

            {result.failed.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Failed recipients
                </p>
                <div className="space-y-1.5">
                  {result.failed.map((f) => (
                    <div
                      key={f.phone}
                      className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2"
                    >
                      <X className="h-4 w-4 text-red-500 shrink-0" />
                      <span className="font-mono text-sm flex-1">{f.phone}</span>
                      <span className="text-xs text-red-600 flex-1 text-right truncate" title={f.error}>
                        {f.error}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sending}
                        onClick={() => startTransition(() => handleRetry(f.phone))}
                      >
                        Retry
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog for N >= 10 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {count} recipients?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a WhatsApp message to{" "}
              <span className="font-semibold">{count} recipients</span>.{" "}
              {msgType === "text"
                ? "Free-form messages can only be sent within a 24-hour conversation window."
                : `Template: ${templateName}.`}{" "}
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
