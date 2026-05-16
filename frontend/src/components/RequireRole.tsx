import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Redirects pending users (role="") and denied users (role="denied") to /dashboard.
 * Use to gate routes that require any non-empty, non-denied role.
 * Backend enforces data-level; this is UX layer.
 */
export function RequireRole({ children }: Props) {
  const { user } = useAuth();
  if (!user?.role || user.role === "denied") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
