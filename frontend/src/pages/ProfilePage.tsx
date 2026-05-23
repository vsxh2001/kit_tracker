import { useEffect, useState, startTransition } from "react";
import { User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { getUser, updateUserProfile, updateNotificationPrefs } from "../services/users";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
import type { NotificationPrefs } from "../types";

const DEFAULT_PREFS: NotificationPrefs = {
  channels: ["whatsapp", "email"],
  events: {
    request_fulfilled: true,
    kit_moved: true,
    maintenance_digest: true,
    overdue_return: true,
  },
};

export function ProfilePage() {
  const { user: currentUser } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);

  async function load() {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const u = await getUser(currentUser.id);
      setName(u.name ?? "");
      setPhone(u.phone ?? "");
      setTitle(u.title ?? "");
      // Parse notification_prefs JSON; fall back to defaults if missing/malformed
      if (u.notification_prefs) {
        try {
          const parsed = JSON.parse(u.notification_prefs) as NotificationPrefs;
          setNotifPrefs({
            channels: Array.isArray(parsed.channels) ? parsed.channels : DEFAULT_PREFS.channels,
            events: {
              request_fulfilled: typeof parsed.events?.request_fulfilled === "boolean" ? parsed.events.request_fulfilled : DEFAULT_PREFS.events.request_fulfilled,
              kit_moved: typeof parsed.events?.kit_moved === "boolean" ? parsed.events.kit_moved : DEFAULT_PREFS.events.kit_moved,
              maintenance_digest: typeof parsed.events?.maintenance_digest === "boolean" ? parsed.events.maintenance_digest : DEFAULT_PREFS.events.maintenance_digest,
              overdue_return: typeof parsed.events?.overdue_return === "boolean" ? parsed.events.overdue_return : DEFAULT_PREFS.events.overdue_return,
            },
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
      setSaving(false);
    }
  }

  function toggleChannel(ch: "whatsapp" | "email") {
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
                    checked={notifPrefs.channels.includes("whatsapp")}
                    onChange={() => toggleChannel("whatsapp")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">WhatsApp</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifPrefs.channels.includes("email")}
                    onChange={() => toggleChannel("email")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Email</span>
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
              </div>
            </div>
            <Button type="submit" disabled={savingPrefs}>
              {savingPrefs ? "Saving…" : "Save preferences"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
