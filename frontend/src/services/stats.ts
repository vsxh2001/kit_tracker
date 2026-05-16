import { pb } from "../lib/pocketbase";
import type { Kit, Entity, Transaction, KitRequest, RequestStatus } from "../types";

export interface DailyCount { date: string; count: number; }

function buildLast7DaysBuckets(): Map<string, number> {
  const buckets = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  return buckets;
}

export async function kitsTransactionsLast7Days(): Promise<DailyCount[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const items = await pb.collection("transactions").getFullList<Transaction>({
    filter: pb.filter("timestamp >= {:since}", { since: sevenDaysAgo }),
    requestKey: "sparkline-tx-7d",
  });
  const buckets = buildLast7DaysBuckets();
  for (const tx of items) {
    const day = tx.timestamp.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

export async function requestsCreatedLast7Days(): Promise<DailyCount[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const items = await pb.collection("requests").getFullList<KitRequest>({
    filter: pb.filter("created >= {:since}", { since: sevenDaysAgo }),
    requestKey: "sparkline-requests-7d",
  });
  const buckets = buildLast7DaysBuckets();
  for (const req of items) {
    const day = req.created.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

export interface UtilizationStats {
  totalKits: number;
  kitsAssigned: number;
  kitsUnassigned: number;
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
  // "Assigned" = latest transaction exists AND points to an ACTIVE entity.
  // "Unassigned" = no transactions, OR latest tx points to a deactivated entity.
  //
  // We don't use entity.type to classify storage vs non-storage because
  // services/entities.ts:createEntity hardcodes type="storage" for every
  // record, making the previous regex check meaningless.
  const latestTxByKit = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (!latestTxByKit.has(tx.kit)) {
      latestTxByKit.set(tx.kit, tx);
    }
  }

  let kitsAssigned = 0;
  let kitsUnassigned = 0;
  for (const kit of kits) {
    const latestTx = latestTxByKit.get(kit.id);
    if (!latestTx) {
      kitsUnassigned++;
      continue;
    }
    const toEntity = entityMap.get(latestTx.to_entity);
    if (toEntity && toEntity.is_active) {
      kitsAssigned++;
    } else {
      kitsUnassigned++;
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
    kitsAssigned,
    kitsUnassigned,
    topRequesters,
    topMovedKits,
    statusBreakdown,
    overdueCount,
    avgFulfillmentDays,
  };
}
