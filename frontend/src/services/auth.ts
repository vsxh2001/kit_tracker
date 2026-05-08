import { pb } from "../lib/pocketbase";
import type { PBUser } from "../types";

export async function login(email: string, password: string) {
  return pb.collection("users").authWithPassword(email, password);
}

export function logout() {
  pb.authStore.clear();
}

export function getCurrentUser(): PBUser | null {
  if (!pb.authStore.isValid) return null;
  return pb.authStore.model as unknown as PBUser;
}

export function isAdmin(): boolean {
  return getCurrentUser()?.role === "admin";
}
