import React, { createContext, useContext, useEffect, useState } from "react";
import { pb } from "../lib/pocketbase";
import type { PBUser } from "../types";

interface AuthContextValue {
  user: PBUser | null;
  isAdmin: boolean;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAdmin: false,
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
    sync();
    const unsub = pb.authStore.onChange(() => sync());
    return () => unsub();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAdmin: user?.role === "admin", loading, refresh: sync }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
