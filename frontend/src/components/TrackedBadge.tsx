import { Badge } from "./ui/badge";

export function TrackedBadge({ tracked, size = "xs" }: { tracked?: boolean; size?: "xs" | "md" }) {
  if (!tracked) return null;
  return <Badge variant="secondary" className={size === "xs" ? "text-xs" : undefined}>Tracked</Badge>;
}
