import type { Transaction, ComponentTransaction, KitMaintenanceSchedule } from "../types";

export function endOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day, 23, 59, 59, 999);
  return d.toISOString();
}

export function holderAt(txs: Transaction[], atIso: string): Transaction | null {
  // txs sorted -timestamp,-created; find last tx whose timestamp <= atIso
  for (const tx of txs) {
    if (tx.timestamp <= atIso) return tx;
  }
  return null;
}

export function componentsAt(
  compTxs: ComponentTransaction[],
  kitId: string,
  atIso: string
): ComponentTransaction[] {
  // Keep only events at or before atIso
  const eligible = compTxs.filter((tx) => tx.timestamp <= atIso);
  // Group by component; keep latest per component (txs should be sorted -timestamp already)
  const latest = new Map<string, ComponentTransaction>();
  for (const tx of eligible) {
    if (!latest.has(tx.component)) latest.set(tx.component, tx);
  }
  // Return those where the component was in this kit at that moment
  return Array.from(latest.values()).filter((tx) => tx.to_kit === kitId);
}

export function schedulesAt(
  scheds: KitMaintenanceSchedule[],
  atIso: string
): KitMaintenanceSchedule[] {
  return scheds.filter(
    (s) => s.created <= atIso && s.next_due_at <= atIso
  );
}
