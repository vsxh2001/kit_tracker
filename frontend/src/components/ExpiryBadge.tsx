import { Badge } from "./ui/badge";
import { expiryStatus, daysUntilExpiry } from "../lib/utils";

export function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const status = expiryStatus(expiresAt);
  if (status === "none" || status === "ok") return null;
  const days = daysUntilExpiry(expiresAt);
  if (status === "expired") {
    return <Badge variant="destructive" className="text-xs">Expired {Math.abs(days)}d ago</Badge>;
  }
  return <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-100">Expires in {days}d</Badge>;
}
