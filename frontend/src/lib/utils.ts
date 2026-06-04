import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map entity name keywords to semantic Tailwind bg color classes for KitTimeline.
// Entity type field doesn't exist in the schema, so we derive from name keywords.
export function entityTimelineColor(name: string): string {
  const lower = name.toLowerCase();
  if (/(storage|warehouse|depot|store)/.test(lower)) return "bg-indigo-400";
  if (/(maintenance|repair|service|workshop)/.test(lower)) return "bg-amber-400";
  if (/(customer|client|end.?user)/.test(lower)) return "bg-emerald-400";
  // fallback: hash into a small curated palette (better hues than before)
  const PALETTE = ["bg-indigo-300", "bg-emerald-300", "bg-amber-300", "bg-sky-300", "bg-violet-300", "bg-rose-300"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

export const REQUEST_STATUS_VARIANTS = {
  open: "secondary",
  approved: "success",
  rejected: "destructive",
  fulfilled: "purple",
  cancelled: "gray",
} as const;

/** Strip non-[+\d] characters from a phone string for safe tel: href use. */
export function formatTelHref(phone: string): string {
  return phone.replace(/[^+\d]/g, "");
}

export function formatDateOnly(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-CA"); // YYYY-MM-DD
}

export type MaintStatus = "ok" | "due-soon" | "overdue";
export function maintenanceStatus(nextDueAt: string, daysWindow = 7): MaintStatus {
  if (!nextDueAt) return "ok";
  const due = new Date(nextDueAt.slice(0, 10) + "T00:00:00").getTime();
  const today = new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00").getTime();
  const days = (due - today) / 86400000;
  if (days < 0) return "overdue";
  if (days <= daysWindow) return "due-soon";
  return "ok";
}

export type ExpiryStatus = "ok" | "expiring-soon" | "expired" | "none";
export function expiryStatus(expiresAt: string, daysWindow = 30): ExpiryStatus {
  if (!expiresAt) return "none";
  const exp = new Date(expiresAt.slice(0, 10) + "T00:00:00").getTime();
  const today = new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00").getTime();
  const days = (exp - today) / 86400000;
  if (days < 0) return "expired";
  if (days <= daysWindow) return "expiring-soon";
  return "ok";
}
export function daysUntilExpiry(expiresAt: string): number {
  const exp = new Date(expiresAt.slice(0, 10) + "T00:00:00").getTime();
  const today = new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00").getTime();
  return Math.floor((exp - today) / 86400000);
}
