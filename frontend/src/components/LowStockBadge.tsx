import { Badge } from "./ui/badge";
import { isLowStock } from "../lib/utils";

export function LowStockBadge({
  reorderPoint,
  onHand,
}: {
  reorderPoint?: number | null;
  onHand: number;
}) {
  if (!isLowStock(reorderPoint, onHand)) return null;
  return <Badge variant="destructive" className="text-xs">Low stock</Badge>;
}
