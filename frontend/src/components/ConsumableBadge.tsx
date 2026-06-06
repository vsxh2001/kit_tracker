import { Badge } from "./ui/badge";

export function ConsumableBadge({ isConsumable, size = "xs" }: { isConsumable?: boolean; size?: "xs" | "md" }) {
  if (!isConsumable) return null;
  return <Badge variant="outline" className={size === "xs" ? "text-xs" : undefined}>Consumable</Badge>;
}
