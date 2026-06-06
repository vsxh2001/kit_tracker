import { Badge } from "./ui/badge";

export function InactiveBadge({
  isActive,
  size = "xs",
  showActiveLabel = false,
}: {
  isActive?: boolean;
  size?: "xs" | "md";
  showActiveLabel?: boolean;
}) {
  if (isActive) {
    if (!showActiveLabel) return null;
    return <Badge variant="outline" className={size === "xs" ? "text-xs" : undefined}>Active</Badge>;
  }
  return <Badge variant="destructive" className={size === "xs" ? "text-xs" : undefined}>Inactive</Badge>;
}
