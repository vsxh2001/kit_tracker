import { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { pb } from "../lib/pocketbase";
import { previewInvite, acceptInvite } from "../services/invites";
import type { InvitePreview } from "../services/invites";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "../components/ui/use-toast";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  technician: "Technician",
  user: "User",
  viewer: "Viewer",
};

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function loadPreview() {
    if (!token) { setPreviewError("Missing token."); setLoadingPreview(false); return; }
    setLoadingPreview(true);
    try {
      const data = await previewInvite(token);
      setPreview(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setPreviewError(err?.message ?? "Invalid invite link.");
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => { startTransition(() => loadPreview()); }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!email.trim() || !email.includes("@")) {
      setSubmitError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setSubmitError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await acceptInvite({ token: token!, email, name, password });
      // Store auth in PB client
      pb.authStore.save(result.token, result.record as Parameters<typeof pb.authStore.save>[1]);
      toast({ title: "Welcome!", description: `You're signed in as ${result.record.email}.`, variant: "success" });
      navigate("/dashboard", { replace: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setSubmitError(err?.message ?? "Failed to accept invite.");
      if (err?.status === 409) {
        // Already has account — point to login
        setSubmitError("You already have an account. Please log in instead.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingPreview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking invite…</p>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 text-center px-4">
          <h1 className="text-2xl font-semibold">Invite unavailable</h1>
          <p className="text-muted-foreground">{previewError}</p>
          <Link to="/login" className="text-sm underline text-primary">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">You're invited</h1>
          <p className="text-muted-foreground text-sm">
            You've been invited to Kit Tracker as{" "}
            <span className="font-medium text-foreground">
              {ROLE_LABEL[preview!.role] ?? preview!.role}
            </span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-name">
              Name <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="invite-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-confirm">Confirm password</Label>
            <Input
              id="invite-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              required
            />
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}
          {submitError?.includes("already have an account") && (
            <p className="text-sm">
              <Link to="/login" className="underline text-primary">Log in here</Link>
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="underline text-primary">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
