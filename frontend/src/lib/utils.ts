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
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const REQUEST_STATUS_VARIANTS = {
  open: "secondary",
  approved: "success",
  rejected: "destructive",
  fulfilled: "purple",
  cancelled: "gray",
} as const;

export function formatDateOnly(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
