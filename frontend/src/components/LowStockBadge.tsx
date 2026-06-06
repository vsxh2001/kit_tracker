import { Badge } from "./ui/badge";

export function LowStockBadge({
  reorderPoint,
  onHand,
}: {
  reorderPoint?: number | null;
  onHand: number;
}) {
  if (reorderPoint == null || onHand >= reorderPoint) return null;
  return <Badge variant="destructive" className="text-xs">Low stock</Badge>;
}
