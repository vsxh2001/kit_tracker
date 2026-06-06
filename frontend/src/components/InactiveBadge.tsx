import { Badge } from "./ui/badge";

export function InactiveBadge({ isActive, size = "xs" }: { isActive?: boolean; size?: "xs" | "md" }) {
  if (isActive) return null;
  return <Badge variant="destructive" className={size === "xs" ? "text-xs" : undefined}>Inactive</Badge>;
}
