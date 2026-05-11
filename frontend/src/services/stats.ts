import { pb } from "../lib/pocketbase";
import type { Kit, Entity, Transaction, KitRequest, RequestStatus } from "../types";

export interface UtilizationStats {
  totalKits: number;
  kitsOut: number;
  kitsInStorage: number;
  topRequesters: { email: string; count: number }[];
  topMovedKits: { serial: string; count: number }[];
  statusBreakdown: Record<RequestStatus, number>;
  overdueCount: number;
  avgFulfillmentDays: number | null;
}

export async function computeStats(): Promise<UtilizationStats> {
  const [kits, entities, transactions, requests] = await Promise.all([
    pb.collection("kits").getFullList<Kit>({
      filter: "is_active = true",
      requestKey: "stats-kits",
    }),
    pb.collection("entities").getFullList<Entity>({
      requestKey: "stats-entities",
    }),
    pb.collection("transactions").getFullList<Transaction>({
      sort: "-timestamp,-created",
      requestKey: "stats-transactions",
    }),
    pb.collection("requests").getFullList<KitRequest>({
      expand: "requester",
      requestKey: "stats-requests",
    }),
  ]);

  // Build entity map
  const entityMap = new Map<string, Entity>();
  for (const e of entities) {
    entityMap.set(e.id, e);
  }

  // Build kit map for serial lookup
  const kitMap = new Map<string, Kit>();
  for (const k of kits) {
    kitMap.set(k.id, k);
  }

  // --- Card 1: Fleet utilization ---
  // For each active kit, find its latest transaction
  const latestTxByKit = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (!latestTxByKit.has(tx.kit)) {
      latestTxByKit.set(tx.kit, tx);
    }
  }

  let kitsOut = 0;
  let kitsInStorage = 0;
  for (const kit of kits) {
    const latestTx = latestTxByKit.get(kit.id);
    if (!latestTx) {
      // No transactions — consider in storage
      kitsInStorage++;
      continue;
    }
    const toEntity = entityMap.get(latestTx.to_entity) as (Entity & { type?: string }) | undefined;
    const isStorage = !toEntity || /(storage|warehouse|depot|store)/i.test(toEntity.type ?? "");
    if (isStorage) {
      kitsInStorage++;
    } else {
      kitsOut++;
    }
  }

  // --- Card 2: Top 5 requesters (past 30 days) ---
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const requesterCounts = new Map<string, { email: string; count: number }>();
  for (const req of requests) {
    const reqDate = new Date(req.date);
    if (reqDate < thirtyDaysAgo) continue;
    const requesterEmail = req.expand?.requester?.email ?? req.requester;
    const existing = requesterCounts.get(req.requester);
    if (existing) {
      existing.count++;
    } else {
      requesterCounts.set(req.requester, { email: requesterEmail, count: 1 });
    }
  }
  const topRequesters = Array.from(requesterCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // --- Card 3: Top 5 most-moved kits (past 30 days) ---
  const kitMoveCounts = new Map<string, number>();
  for (const tx of transactions) {
    const txDate = new Date(tx.timestamp);
    if (txDate < thirtyDaysAgo) continue;
    kitMoveCounts.set(tx.kit, (kitMoveCounts.get(tx.kit) ?? 0) + 1);
  }
  const topMovedKits = Array.from(kitMoveCounts.entries())
    .map(([kitId, count]) => ({
      serial: kitMap.get(kitId)?.serial ?? kitId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // --- Card 4: Request status breakdown (all-time) ---
  const statusBreakdown: Record<RequestStatus, number> = {
    open: 0,
    approved: 0,
    rejected: 0,
    fulfilled: 0,
    cancelled: 0,
  };
  for (const req of requests) {
    if (req.status in statusBreakdown) {
      statusBreakdown[req.status]++;
    }
  }

  // --- Card 5: Overdue returns ---
  const now = new Date();
  let overdueCount = 0;
  for (const req of requests) {
    if (req.status === "fulfilled" && req.expected_return) {
      if (new Date(req.expected_return) < now) {
        overdueCount++;
      }
    }
  }

  // --- Card 6: Avg fulfillment time (past 30 days) ---
  // Use updated timestamp as proxy for fulfillment time vs created for when it was submitted
  // For fulfilled requests: updated - created as proxy for approval→fulfillment time
  // Since no audit log, skip if insufficient data
  const fulfilledRecent = requests.filter((req) => {
    if (req.status !== "fulfilled") return false;
    const reqDate = new Date(req.date);
    return reqDate >= thirtyDaysAgo;
  });

  let avgFulfillmentDays: number | null = null;
  if (fulfilledRecent.length > 0) {
    const totalMs = fulfilledRecent.reduce((sum, req) => {
      const created = new Date(req.created).getTime();
      const updated = new Date(req.updated).getTime();
      return sum + (updated - created);
    }, 0);
    avgFulfillmentDays = totalMs / fulfilledRecent.length / (1000 * 60 * 60 * 24);
  }

  return {
    totalKits: kits.length,
    kitsOut,
    kitsInStorage,
    topRequesters,
    topMovedKits,
    statusBreakdown,
    overdueCount,
    avgFulfillmentDays,
  };
}
