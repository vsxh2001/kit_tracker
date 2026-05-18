import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { KitQR } from "../KitQR";
import { formatDate } from "../../lib/utils";
import type { Kit, Entity, Transaction } from "../../types";

interface DetailsCardProps {
  kit: Kit;
  currentHolder: Entity | null;
  latestTransaction: Transaction | null;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</p>
      <p className={`text-sm text-right break-all ${mono ? "font-mono text-xs tracking-wide text-indigo-700" : ""}`}>{value}</p>
    </div>
  );
}

export function DetailsCard({ kit, currentHolder, latestTransaction }: DetailsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Details</CardTitle>
          <div title="Scan to open this kit">
            <KitQR kitId={kit.id} size={96} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-0 text-sm pt-0">
        <Row label="Serial" value={kit.serial} mono />
        <Row label="Notes" value={kit.notes ?? "—"} />
        <Row label="Current location" value={currentHolder?.name ?? "Unknown"} />
        {latestTransaction && <Row label="Last moved" value={formatDate(latestTransaction.timestamp)} />}
      </CardContent>
    </Card>
  );
}
