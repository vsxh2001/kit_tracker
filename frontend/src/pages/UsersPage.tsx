import { useEffect, useRef, useState, startTransition } from "react";
import { UserCog, Pencil, Link2 } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  listUsers,
  updateUserRole,
  updateUserDenial,
  restoreUser,
  updateUserProfile,
} from "../services/users";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
import type { PBUser, UserRole } from "../types";
import { formatDate } from "../lib/utils";
import { InviteDialog } from "../components/InviteDialog";

const ROLE_OPTIONS: { value: UserRole | "none"; label: string }[] = [
  { value: "none", label: "Not assigned" },
  { value: "admin", label: "Admin" },
  { value: "technician", label: "Technician" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
  { value: "denied", label: "Denied" },
];

export function UsersPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const [users, setUsers] = useState<PBUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Denial modal state
  const [denialTarget, setDenialTarget] = useState<PBUser | null>(null);
  const [denialNotes, setDenialNotes] = useState("");
  const [denialSaving, setDenialSaving] = useState(false);
  const denialSavingRef = useRef(false);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);

  // Edit profile dialog (phone/title/telegram_chat_id)
  const [editTarget, setEditTarget] = useState<PBUser | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTelegramChatId, setEditTelegramChatId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);

  // Per-user in-flight role change. Keyed by user id so admins can update
  // multiple rows concurrently, but the same row cannot race itself.
  const [roleSavingIds, setRoleSavingIds] = useState<Set<string>>(new Set());
  const roleSavingIdsRef = useRef<Set<string>>(new Set());


  async function load() {
    setLoading(true);
    try {
      setUsers(await listUsers());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  async function handleRoleChange(u: PBUser, newValue: string) {
    if (newValue === "denied") {
      // Open denial modal, don't change role yet
      setDenialTarget(u);
      setDenialNotes("");
      return;
    }

    // Synchronous guard against rapid Select changes on the same row:
    // setRoleSavingIds is async so disabled={roleSavingIds.has(u.id)} doesn't
    // propagate before a second pick in the same tick. Without this, two parallel
    // PB writes could land in any order and leave the role at the FIRST pick instead
    // of the second. The restoreUser-vs-updateUserRole branch on prevRole would also
    // see the optimistic value on the second call, taking the wrong service path
    // when rapidly clicking "denied → X → Y" before the first response.
    if (roleSavingIdsRef.current.has(u.id)) return;
    roleSavingIdsRef.current.add(u.id);
    setRoleSavingIds(new Set(roleSavingIdsRef.current));

    const newRole: UserRole | "" = newValue === "none" ? "" : (newValue as UserRole);
    const prevRole = u.role;
    const prevDenialNotes = u.denial_notes;

    // Optimistic update
    setUsers((prev) =>
      prev.map((x) =>
        x.id === u.id ? { ...x, role: newRole as UserRole, denial_notes: "" } : x
      )
    );

    try {
      if (prevRole === "denied") {
        await restoreUser(u.id, newRole);
      } else {
        await updateUserRole(u.id, newRole);
      }
      toast({
        title: "Role updated",
        description: `Role updated for ${u.email}`,
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      // Revert
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id ? { ...x, role: prevRole, denial_notes: prevDenialNotes } : x
        )
      );
      toast({
        title: "Failed to update role",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      roleSavingIdsRef.current.delete(u.id);
      setRoleSavingIds(new Set(roleSavingIdsRef.current));
    }
  }

  async function handleDenialConfirm() {
    if (!denialTarget || !denialNotes.trim()) return;

    // Synchronous guard against double-click: setDenialSaving is async so disabled={denialSaving}
    // doesn't propagate before a second click in the same tick. The dialog is closed optimistically
    // (setDenialTarget(null) below) but denialTarget is also async — a same-tick second click sees
    // the stale non-null target and would PATCH updateUserDenial twice.
    if (denialSavingRef.current) return;

    denialSavingRef.current = true;
    setDenialSaving(true);
    const prevRole = denialTarget.role;
    const prevDenialNotes = denialTarget.denial_notes;

    // Optimistic update
    setUsers((prev) =>
      prev.map((x) =>
        x.id === denialTarget.id
          ? { ...x, role: "denied" as UserRole, denial_notes: denialNotes.trim() }
          : x
      )
    );
    setDenialTarget(null);

    try {
      await updateUserDenial(denialTarget.id, denialNotes.trim());
      toast({
        title: "User denied",
        description: `${denialTarget.email} has been denied access.`,
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setUsers((prev) =>
        prev.map((x) =>
          x.id === denialTarget.id
            ? { ...x, role: prevRole, denial_notes: prevDenialNotes }
            : x
        )
      );
      toast({
        title: "Failed to deny user",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      denialSavingRef.current = false;
      setDenialSaving(false);
    }
  }

  function handleDenialCancel() {
    setDenialTarget(null);
    setDenialNotes("");
  }

  function openEditDialog(u: PBUser) {
    setEditTarget(u);
    setEditPhone(u.phone ?? "");
    setEditTitle(u.title ?? "");
    setEditTelegramChatId(u.telegram_chat_id ?? "");
  }

  async function handleEditSave() {
    if (!editTarget) return;

    // Synchronous guard against double-click: setEditSaving is async so disabled={editSaving}
    // doesn't propagate before a second click in the same tick. A double-click on "Save" would
    // PATCH updateUserProfile twice — same payload, two audit rows.
    if (editSavingRef.current) return;

    editSavingRef.current = true;
    setEditSaving(true);
    const prevPhone = editTarget.phone;
    const prevTitle = editTarget.title;
    const prevTelegramChatId = editTarget.telegram_chat_id;

    // Optimistic update
    setUsers((prev) =>
      prev.map((x) =>
        x.id === editTarget.id
          ? { ...x, phone: editPhone.trim(), title: editTitle.trim(), telegram_chat_id: editTelegramChatId.trim() }
          : x
      )
    );
    setEditTarget(null);

    try {
      await updateUserProfile(editTarget.id, {
        phone: editPhone.trim(),
        title: editTitle.trim(),
        telegram_chat_id: editTelegramChatId.trim(),
      });
      toast({
        title: "Profile updated",
        description: `Updated contact info for ${editTarget.email}`,
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setUsers((prev) =>
        prev.map((x) =>
          x.id === editTarget.id
            ? { ...x, phone: prevPhone, title: prevTitle, telegram_chat_id: prevTelegramChatId }
            : x
        )
      );
      toast({
        title: "Failed to update profile",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      editSavingRef.current = false;
      setEditSaving(false);
    }
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Administration</p>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserCog className="h-6 w-6" />
            Users
          </h1>
        </div>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)} variant="outline" size="sm" className="flex items-center gap-1.5">
            <Link2 className="h-4 w-4" />
            Invite user
          </Button>
        )}
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <input
        type="text"
        placeholder="Search by email or name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">No users found.</p>
          )}

          {/* Mobile card list */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-2">
              {filtered.map((u) => {
                const isSelf = u.id === currentUser?.id;
                const selectValue = u.role || "none";
                return (
                  <div
                    key={u.id}
                    className={`rounded-lg border bg-card px-4 py-3 ${isSelf ? "ring-1 ring-amber-400" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {u.email ?? "—"}
                          {isSelf && <span className="ml-1.5 text-xs text-amber-600 font-normal">(you)</span>}
                        </p>
                        {u.name && <p className="text-xs text-muted-foreground">{u.name}</p>}
                        {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
                        {u.title && <p className="text-xs text-muted-foreground">{u.title}</p>}
                        {u.telegram_chat_id && <p className="text-xs text-muted-foreground">TG: {u.telegram_chat_id}</p>}
                        {u.role === "denied" && u.denial_notes && (
                          <p className="text-xs italic text-red-500 mt-0.5">{u.denial_notes}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(u.created)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <button
                          onClick={() => openEditDialog(u)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${u.email}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <Select
                      value={selectValue}
                      onValueChange={(v) => handleRoleChange(u, v)}
                      disabled={roleSavingIds.has(u.id)}
                    >
                      <SelectTrigger className="w-36 h-11 md:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Telegram ID</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Title</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                      <th className="text-left p-3 font-medium text-muted-foreground"></th>
                      {isAdmin && <th className="text-left p-3 font-medium text-muted-foreground"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      const selectValue = u.role || "none";
                      return (
                        <tr
                          key={u.id}
                          className={`border-b last:border-0 hover:bg-slate-50 ${isSelf ? "ring-1 ring-inset ring-amber-400" : ""}`}
                        >
                          <td className="p-3 font-medium">
                            <div>
                              {u.email ?? "—"}
                              {isSelf && <span className="ml-1.5 text-xs text-amber-600 font-normal">(you)</span>}
                              {u.role === "denied" && u.denial_notes && (
                                <p className="text-xs italic text-red-500 mt-0.5">{u.denial_notes}</p>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">{u.name ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{u.phone ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{u.telegram_chat_id ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{u.title ?? "—"}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Select
                                value={selectValue}
                                onValueChange={(v) => handleRoleChange(u, v)}
                                disabled={roleSavingIds.has(u.id)}
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">{formatDate(u.created)}</td>
                          <td className="p-3">
                            <button
                              onClick={() => openEditDialog(u)}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${u.email}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Denial notes modal */}
      <Dialog open={!!denialTarget} onOpenChange={(o) => { if (!o) handleDenialCancel(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny user access</DialogTitle>
            <DialogDescription>
              Provide a reason for denying <strong>{denialTarget?.email}</strong>. This message will be stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Label htmlFor="denial-notes">Reason (required)</Label>
            <textarea
              id="denial-notes"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px]"
              placeholder="Enter reason for denial…"
              value={denialNotes}
              onChange={(e) => setDenialNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleDenialCancel} disabled={denialSaving}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDenialConfirm}
                disabled={denialSaving || !denialNotes.trim()}
              >
                {denialSaving ? "Saving…" : "Deny user"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit phone/title/telegram_chat_id dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit contact info</DialogTitle>
            <DialogDescription>
              Update phone, title and Telegram chat ID for <strong>{editTarget?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="e.g. Field Technician"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-telegram-chat-id">Telegram Chat ID</Label>
              <Input
                id="edit-telegram-chat-id"
                type="text"
                value={editTelegramChatId}
                onChange={(e) => setEditTelegramChatId(e.target.value)}
                placeholder="e.g. 123456789"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
                Cancel
              </Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
