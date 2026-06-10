import { useEffect, useRef, useState, startTransition } from "react";
import { User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { getUser, updateUserProfile, updateNotificationPrefs } from "../services/users";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
import { TelegramLinkDialog } from "../components/TelegramLinkDialog";
import type { NotificationPrefs } from "../types";

const DEFAULT_PREFS: NotificationPrefs = {
  channels: ["email"],
  events: {
    request_fulfilled: true,
    kit_moved: true,
    maintenance_digest: true,
    overdue_return: true,
    request_pending: true,
    request_escalation: true,
  },
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: "Asia/Jerusalem",
  },
};

const TZ_OPTIONS: string[] = (function() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    return [
      "Asia/Jerusalem",
      "UTC",
      "Europe/Berlin",
      "Europe/London",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Asia/Dubai",
      "Australia/Sydney",
    ];
  }
})();

export function ProfilePage() {
  const { user: currentUser } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Telegram linking state
  const [telegramChatId, setTelegramChatId] = useState<string>("");
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const unlinkingTelegramRef = useRef(false);
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);

  async function load() {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const u = await getUser(currentUser.id);
      setName(u.name ?? "");
      setPhone(u.phone ?? "");
      setTitle(u.title ?? "");
      setTelegramChatId(u.telegram_chat_id ?? "");
      // Parse notification_prefs JSON; fall back to defaults if missing/malformed
      if (u.notification_prefs) {
        try {
          const parsed = JSON.parse(u.notification_prefs) as NotificationPrefs;
          setNotifPrefs({
            channels: Array.isArray(parsed.channels)
              ? parsed.channels.filter((c): c is "email" | "telegram" => c === "email" || c === "telegram")
              : DEFAULT_PREFS.channels,
            events: {
              request_fulfilled: typeof parsed.events?.request_fulfilled === "boolean" ? parsed.events.request_fulfilled : DEFAULT_PREFS.events.request_fulfilled,
              kit_moved: typeof parsed.events?.kit_moved === "boolean" ? parsed.events.kit_moved : DEFAULT_PREFS.events.kit_moved,
              maintenance_digest: typeof parsed.events?.maintenance_digest === "boolean" ? parsed.events.maintenance_digest : DEFAULT_PREFS.events.maintenance_digest,
              overdue_return: typeof parsed.events?.overdue_return === "boolean" ? parsed.events.overdue_return : DEFAULT_PREFS.events.overdue_return,
              request_pending: typeof parsed.events?.request_pending === "boolean" ? parsed.events.request_pending : DEFAULT_PREFS.events.request_pending,
              request_escalation: typeof parsed.events?.request_escalation === "boolean" ? parsed.events.request_escalation : DEFAULT_PREFS.events.request_escalation,
            },
            quiet_hours: parsed.quiet_hours
              ? {
                  enabled: typeof parsed.quiet_hours.enabled === "boolean" ? parsed.quiet_hours.enabled : false,
                  start: parsed.quiet_hours.start || DEFAULT_PREFS.quiet_hours!.start,
                  end: parsed.quiet_hours.end || DEFAULT_PREFS.quiet_hours!.end,
                  timezone: parsed.quiet_hours.timezone || DEFAULT_PREFS.quiet_hours!.timezone,
                }
              : DEFAULT_PREFS.quiet_hours,
          });
        } catch {
          setNotifPrefs(DEFAULT_PREFS);
        }
      } else {
        setNotifPrefs(DEFAULT_PREFS);
      }
      setLoadError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        setLoadError(err?.message ?? "Failed to load profile");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    startTransition(() => load());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser?.id) return;

    // Synchronous guard against double-click: setSaving is async so disabled={saving}
    // doesn't propagate before a second click in the same tick. A double-click on
    // "Save" would PATCH updateUserProfile twice (same payload, but two audit rows).
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    try {
      await updateUserProfile(currentUser.id, {
        name: name.trim(),
        phone: phone.trim(),
        title: title.trim(),
      });
      toast({
        title: "Profile saved",
        description: "Your profile has been updated.",
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to save profile",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function toggleChannel(ch: "email" | "telegram") {
    setNotifPrefs((prev) => {
      const has = prev.channels.includes(ch);
      return {
        ...prev,
        channels: has ? prev.channels.filter((c) => c !== ch) : [...prev.channels, ch],
      };
    });
  }

  function toggleEvent(ev: keyof NotificationPrefs["events"]) {
    setNotifPrefs((prev) => ({
      ...prev,
      events: { ...prev.events, [ev]: !prev.events[ev] },
    }));
  }

  async function handleSavePrefs(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser?.id) return;
    setSavingPrefs(true);
    try {
      await updateNotificationPrefs(currentUser.id, notifPrefs);
      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to save preferences",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleUnlinkTelegram() {
    if (!currentUser?.id) return;

    // Synchronous guard against double-click: setUnlinkingTelegram is async so
    // disabled={unlinkingTelegram} doesn't propagate before a second click in the same
    // tick. A double-click on "Unlink" would PATCH updateUserProfile twice (same payload,
    // two audit rows).
    if (unlinkingTelegramRef.current) return;

    unlinkingTelegramRef.current = true;
    setUnlinkingTelegram(true);
    try {
      await updateUserProfile(currentUser.id, { telegram_chat_id: "" });
      setTelegramChatId("");
      toast({
        title: "Telegram unlinked",
        description: "Your Telegram account has been disconnected.",
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Failed to unlink Telegram",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      unlinkingTelegramRef.current = false;
      setUnlinkingTelegram(false);
    }
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Account</p>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <User className="h-6 w-6" />
          Profile
        </h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {loadError && (
            <p className="text-destructive text-sm">{loadError}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              value={currentUser?.email ?? ""}
              readOnly
              className="bg-muted cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-title">Title</Label>
            <Input
              id="profile-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Field Technician"
            />
          </div>
          <Button type="submit" disabled={!!loadError || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      )}

      {!loading && (
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Notifications</p>
            <h2 className="text-lg font-semibold">Notification Preferences</h2>
          </div>
          <form onSubmit={handleSavePrefs} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Channels</Label>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.channels.includes("email")}
                    onChange={() => toggleChannel("email")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Email</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.channels.includes("telegram")}
                    onChange={() => toggleChannel("telegram")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Telegram</span>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Events</Label>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.events.request_fulfilled}
                    onChange={() => toggleEvent("request_fulfilled")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Request fulfilled</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.events.kit_moved}
                    onChange={() => toggleEvent("kit_moved")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Kit moved</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.events.maintenance_digest}
                    onChange={() => toggleEvent("maintenance_digest")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Maintenance digest</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.events.overdue_return}
                    onChange={() => toggleEvent("overdue_return")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Overdue return</span>
                </label>
                {currentUser?.role === "admin" && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifPrefs.events.request_pending}
                      onChange={() => toggleEvent("request_pending")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Approval requests (admin)</span>
                  </label>
                )}
                {currentUser?.role === "admin" && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifPrefs.events.request_escalation}
                      onChange={() => toggleEvent("request_escalation")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Escalation alerts — unanswered approval requests (admin)</span>
                  </label>
                )}
              </div>
            </div>
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <Label className="text-sm font-medium">Quiet hours</Label>
              <p className="text-xs text-muted-foreground">Suppress notifications during these hours.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifPrefs.quiet_hours?.enabled ?? false}
                  onChange={() =>
                    setNotifPrefs((prev) => ({
                      ...prev,
                      quiet_hours: {
                        ...DEFAULT_PREFS.quiet_hours!,
                        ...prev.quiet_hours,
                        enabled: !(prev.quiet_hours?.enabled ?? false),
                      },
                    }))
                  }
                  className="h-4 w-4"
                />
                <span className="text-sm">Enabled</span>
              </label>
              {notifPrefs.quiet_hours?.enabled && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="qh-start" className="text-xs">Start</Label>
                      <Input
                        id="qh-start"
                        type="time"
                        value={notifPrefs.quiet_hours?.start ?? "22:00"}
                        onChange={(e) =>
                          setNotifPrefs((prev) => ({
                            ...prev,
                            quiet_hours: {
                              ...DEFAULT_PREFS.quiet_hours!,
                              ...prev.quiet_hours,
                              start: e.target.value,
                            },
                          }))
                        }
                        className="w-32"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="qh-end" className="text-xs">End</Label>
                      <Input
                        id="qh-end"
                        type="time"
                        value={notifPrefs.quiet_hours?.end ?? "08:00"}
                        onChange={(e) =>
                          setNotifPrefs((prev) => ({
                            ...prev,
                            quiet_hours: {
                              ...DEFAULT_PREFS.quiet_hours!,
                              ...prev.quiet_hours,
                              end: e.target.value,
                            },
                          }))
                        }
                        className="w-32"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="qh-tz" className="text-xs">Timezone</Label>
                    <select
                      id="qh-tz"
                      value={notifPrefs.quiet_hours?.timezone ?? "Asia/Jerusalem"}
                      onChange={(e) =>
                        setNotifPrefs((prev) => ({
                          ...prev,
                          quiet_hours: {
                            ...DEFAULT_PREFS.quiet_hours!,
                            ...prev.quiet_hours,
                            timezone: e.target.value,
                          },
                        }))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    >
                      {TZ_OPTIONS.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <Button type="submit" disabled={savingPrefs}>
              {savingPrefs ? "Saving…" : "Save preferences"}
            </Button>
          </form>
        </div>
      )}

      {!loading && (
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Integrations</p>
            <h2 className="text-lg font-semibold">Telegram</h2>
          </div>
          {telegramChatId ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-green-700 font-medium">Connected ✓</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnlinkTelegram}
                disabled={unlinkingTelegram}
              >
                {unlinkingTelegram ? "Unlinking…" : "Unlink"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Link your Telegram account to receive notifications via the bot.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTelegramDialogOpen(true)}
              >
                Link Telegram
              </Button>
            </div>
          )}
        </div>
      )}

      <TelegramLinkDialog
        open={telegramDialogOpen}
        onClose={() => {
          setTelegramDialogOpen(false);
          // Refresh to pick up any new telegram_chat_id set by the bot
          startTransition(() => load());
        }}
      />
    </div>
  );
}
