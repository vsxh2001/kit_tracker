import { useState, useEffect, startTransition } from "react";
import { CalendarClock } from "lucide-react";
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
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "./ui/use-toast";
import {
  createScheduledBroadcast,
  updateScheduledBroadcast,
} from "../services/scheduledBroadcasts";
import type { ScheduledBroadcast } from "../types";

const ROLES = ["admin", "technician", "user", "viewer"] as const;
type Role = typeof ROLES[number];

const KNOWN_TEMPLATES = [
  { name: "hello_world", language: "en_US", label: "hello_world (en_US)" },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: ScheduledBroadcast | null;
  currentUserId?: string;
}

type FilterType = "role" | "phones";
type MsgType = "text" | "template";

export function ScheduledBroadcastDialog({
  open,
  onClose,
  onSaved,
  initial,
  currentUserId,
}: Props) {
  const isEdit = Boolean(initial);

  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [enabled, setEnabled] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("role");
  const [selectedRole, setSelectedRole] = useState<Role>("admin");
  const [phoneListText, setPhoneListText] = useState("");
  const [msgType, setMsgType] = useState<MsgType>("text");
  const [freeText, setFreeText] = useState("");
  const [templateName, setTemplateName] = useState<string>(KNOWN_TEMPLATES[0].name);
  const [templateLanguage, setTemplateLanguage] = useState<string>(KNOWN_TEMPLATES[0].language);
  const [saving, setSaving] = useState(false);

  // Populate from initial when editing
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      if (initial) {
        setName(initial.name);
        setCronExpr(initial.cron_expression);
        setEnabled(initial.enabled);

        try {
          const rf = JSON.parse(initial.recipient_filter || "{}");
          if (rf.type === "phones") {
            setFilterType("phones");
            const phones: string[] = Array.isArray(rf.value) ? rf.value : [];
            setPhoneListText(phones.join("\n"));
            setSelectedRole("admin");
          } else {
            setFilterType("role");
            setSelectedRole((rf.value as Role) || "admin");
            setPhoneListText("");
          }
        } catch {
          setFilterType("role");
          setSelectedRole("admin");
          setPhoneListText("");
        }

        try {
          const msg = JSON.parse(initial.message || "{}");
          if (msg.type === "template") {
            setMsgType("template");
            setTemplateName(msg.template?.name || KNOWN_TEMPLATES[0].name);
            setTemplateLanguage(msg.template?.language || KNOWN_TEMPLATES[0].language);
            setFreeText("");
          } else {
            setMsgType("text");
            setFreeText(msg.text || "");
          }
        } catch {
          setMsgType("text");
          setFreeText("");
        }
      } else {
        // Reset for create
        setName("");
        setCronExpr("0 9 * * 1");
        setEnabled(true);
        setFilterType("role");
        setSelectedRole("admin");
        setPhoneListText("");
        setMsgType("text");
        setFreeText("");
        setTemplateName(KNOWN_TEMPLATES[0].name);
        setTemplateLanguage(KNOWN_TEMPLATES[0].language);
      }
    });
  }, [open, initial]);

  function buildRecipientFilter(): string {
    if (filterType === "role") {
      return JSON.stringify({ type: "role", value: selectedRole });
    }
    const phones = phoneListText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return JSON.stringify({ type: "phones", value: phones });
  }

  function buildMessage(): string {
    if (msgType === "text") {
      return JSON.stringify({ type: "text", text: freeText.trim() });
    }
    return JSON.stringify({
      type: "template",
      template: { name: templateName, language: templateLanguage },
    });
  }

  function isValid(): boolean {
    if (!name.trim()) return false;
    if (!cronExpr.trim()) return false;
    if (filterType === "phones") {
      const phones = phoneListText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (phones.length === 0) return false;
    }
    if (msgType === "text" && !freeText.trim()) return false;
    if (msgType === "template" && !templateName) return false;
    return true;
  }

  async function handleSave() {
    if (!isValid()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        cron_expression: cronExpr.trim(),
        enabled,
        recipient_filter: buildRecipientFilter(),
        message: buildMessage(),
      };

      if (isEdit && initial) {
        await updateScheduledBroadcast(initial.id, payload);
        toast({ title: "Schedule updated", variant: "success" });
      } else {
        await createScheduledBroadcast({
          ...payload,
          ...(currentUserId ? { created_by: currentUserId } : {}),
        });
        toast({ title: "Schedule created", variant: "success" });
      }
      onSaved();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: isEdit ? "Failed to update schedule" : "Failed to create schedule",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            {isEdit ? "Edit schedule" : "New scheduled broadcast"}
          </DialogTitle>
          <DialogDescription>
            Configure a recurring WhatsApp broadcast. The cron expression runs in UTC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Name</Label>
            <Input
              id="sched-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly admin digest"
            />
          </div>

          {/* Cron expression */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-cron">Cron expression</Label>
            <Input
              id="sched-cron"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 9 * * 1"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              5-field cron (UTC). Examples: <span className="font-mono">0 9 * * 1</span> = Monday 9am,{" "}
              <span className="font-mono">0 8 * * *</span> = daily 8am,{" "}
              <span className="font-mono">0 9 * * 0,6</span> = weekends 9am
            </p>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <input
              id="sched-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            <Label htmlFor="sched-enabled" className="cursor-pointer">
              Enabled
            </Label>
          </div>

          {/* Recipient filter */}
          <div className="space-y-3">
            <Label>Recipients</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="sched-filter-type"
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
                  name="sched-filter-type"
                  value="phones"
                  checked={filterType === "phones"}
                  onChange={() => setFilterType("phones")}
                  className="accent-indigo-600"
                />
                By phone list
              </label>
            </div>

            {filterType === "role" && (
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
            )}

            {filterType === "phones" && (
              <Textarea
                placeholder={"972527799932\n972501234567\n..."}
                value={phoneListText}
                onChange={(e) => setPhoneListText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
            )}
          </div>

          {/* Message */}
          <div className="space-y-3">
            <Label>Message</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="sched-msg-type"
                  value="text"
                  checked={msgType === "text"}
                  onChange={() => setMsgType("text")}
                  className="accent-indigo-600"
                />
                Free-form text
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="sched-msg-type"
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
                rows={3}
              />
            )}

            {msgType === "template" && (
              <div className="space-y-2">
                <Select
                  value={templateName}
                  onValueChange={(v) => {
                    const tmpl = KNOWN_TEMPLATES.find((t) => t.name === v);
                    setTemplateName(v);
                    if (tmpl) setTemplateLanguage(tmpl.language);
                  }}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KNOWN_TEMPLATES.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Template: <span className="font-mono">{templateName}</span> / lang:{" "}
                  <span className="font-mono">{templateLanguage}</span>
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !isValid()}>
              {saving ? "Saving..." : isEdit ? "Save changes" : "Create schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
