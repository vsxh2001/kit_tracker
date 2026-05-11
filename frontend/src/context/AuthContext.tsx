import React, { createContext, useContext, useEffect, useState, startTransition } from "react";
import { pb } from "../lib/pocketbase";
import type { PBUser } from "../types";

interface AuthContextValue {
  user: PBUser | null;
  isAdmin: boolean;
  isTechnician: boolean;
  canTransferKits: boolean;
  canDecideRequests: boolean;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAdmin: false,
  isTechnician: false,
  canTransferKits: false,
  canDecideRequests: false,
  loading: true,
  refresh: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PBUser | null>(null);
  const [loading, setLoading] = useState(true);

  function sync() {
    if (pb.authStore.isValid && pb.authStore.model) {
      setUser(pb.authStore.model as unknown as PBUser);
    } else {
      setUser(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    startTransition(() => sync());
    const unsub = pb.authStore.onChange(() => sync());
    return () => unsub();
  }, []);

  const role = user?.role;
  const isAdmin = role === "admin";
  const isTechnician = role === "technician";
  const canTransferKits = isAdmin || isTechnician;
  const canDecideRequests = isAdmin || isTechnician;

  return (
    <AuthContext.Provider
      value={{ user, isAdmin, isTechnician, canTransferKits, canDecideRequests, loading, refresh: sync }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
