import { pb } from "../lib/pocketbase";
import type { Kit, Transaction } from "../types";

/**
 * Returns the kits this entity held at the given ISO timestamp.
 *
 * Algorithm:
 *  1. Fetch all transactions with timestamp <= atISO sorted -timestamp,-created
 *     (capped at 1000 per page, paged until exhausted).
 *  2. Group by kit; keep only the first (latest) transaction per kit.
 *  3. If that transaction's to_entity === entityId → kit was here at atISO.
 */
export async function getEntityHoldingsAt(
  entityId: string,
  atISO: string
): Promise<Kit[]> {
  const PAGE_SIZE = 200;
  const latestByKit = new Map<string, Transaction>();
  let page = 1;
  let fetched = 0;
  const MAX_RECORDS = 1000;

  while (fetched < MAX_RECORDS) {
    const remaining = MAX_RECORDS - fetched;
    const size = Math.min(PAGE_SIZE, remaining);

    const result = await pb
      .collection("transactions")
      .getList<Transaction>(page, size, {
        filter: pb.filter(
          "(from_entity = {:eid} || to_entity = {:eid}) && timestamp <= {:at}",
          { eid: entityId, at: atISO }
        ),
        sort: "-timestamp,-created",
        expand: "kit",
        requestKey: `entity-holdings-at-${entityId}-p${page}`,
      });

    for (const tx of result.items) {
      if (!latestByKit.has(tx.kit)) {
        latestByKit.set(tx.kit, tx);
      }
    }

    fetched += result.items.length;
    if (result.items.length < size) break; // last page
    page++;
  }

  const kits: Kit[] = [];
  for (const [, tx] of latestByKit) {
    if (tx.to_entity === entityId && tx.expand?.kit) {
      kits.push(tx.expand.kit);
    }
  }
  return kits;
}
