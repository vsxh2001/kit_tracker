import { useEffect, useState, startTransition } from "react";
import { User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { getUser, updateUserProfile } from "../services/users";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";

export function ProfilePage() {
  const { user: currentUser } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const u = await getUser(currentUser.id);
      setName(u.name ?? "");
      setPhone(u.phone ?? "");
      setTitle(u.title ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
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

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Account</p>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <User className="h-6 w-6" />
          Profile
        </h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
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
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      )}
    </div>
  );
}
