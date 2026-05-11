import { useEffect, useState, startTransition } from "react";
import { UserCog } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { listUsers, updateUserRole } from "../services/users";
import { useAuth } from "../context/AuthContext";
import { toast } from "../components/ui/use-toast";
import type { PBUser, UserRole } from "../types";
import { formatDate } from "../lib/utils";

const ROLE_OPTIONS: { value: UserRole | "none"; label: string }[] = [
  { value: "none", label: "Not assigned" },
  { value: "admin", label: "Admin" },
  { value: "technician", label: "Technician" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<PBUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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
    const newRole: UserRole | "" = newValue === "none" ? "" : (newValue as UserRole);
    const prevRole = u.role;

    // Optimistic update
    setUsers((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, role: newRole as UserRole } : x))
    );

    try {
      await updateUserRole(u.id, newRole);
      toast({
        title: "Role updated",
        description: `Role updated for ${u.email}`,
        variant: "success",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      // Revert
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, role: prevRole } : x))
      );
      toast({
        title: "Failed to update role",
        description: err?.message,
        variant: "destructive",
      });
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Administration</p>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserCog className="h-6 w-6" />
            Users
          </h1>
        </div>
      </div>

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
                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(u.created)}</p>
                      </div>
                    </div>
                    <Select value={selectValue} onValueChange={(v) => handleRoleChange(u, v)}>
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
                      <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
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
                            {u.email ?? "—"}
                            {isSelf && <span className="ml-1.5 text-xs text-amber-600 font-normal">(you)</span>}
                          </td>
                          <td className="p-3 text-muted-foreground">{u.name ?? "—"}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Select
                                value={selectValue}
                                onValueChange={(v) => handleRoleChange(u, v)}
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
    </div>
  );
}
