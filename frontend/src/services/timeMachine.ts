import { pb } from "../lib/pocketbase";
import type { Kit, Transaction } from "../types";

export interface KitHolding {
  kit: Kit;
  lastTxAt: string;
}

/**
 * Returns the kits this entity held at the given ISO timestamp.
 *
 * Correct two-phase algorithm:
 *
 * Phase 1 — "receipts": fetch all transactions where to_entity = entityId AND
 *   timestamp <= atISO, sorted -timestamp,-created. This gives us every kit
 *   the entity ever received up to atISO. We deduplicate by kitId to get the
 *   latest receipt per kit (candidate set). getFullList auto-paginates with
 *   no hard cap — safe because receipt history per entity is naturally bounded.
 *
 * Phase 2 — "absolute latest": for each candidate kit, fetch its SINGLE
 *   globally-latest tx at or before atISO (kit = kitId && timestamp <= atISO).
 *   Only keep the kit if THAT tx's to_entity === entityId.
 *
 *   This correctly handles the scenario where kit M was received by entity E,
 *   then later moved away (from=E, to=X). Phase 1 would still surface M because
 *   the receive tx is in the set, but Phase 2 sees the move-away tx as the
 *   absolute latest and correctly excludes M.
 *
 * Deleted kits: if a kit was hard-deleted, the separate batch fetch below
 *   will not return it; those kits are rendered as "(deleted kit)" markers.
 */
export async function getEntityHoldingsAt(
  entityId: string,
  atISO: string
): Promise<KitHolding[]> {
  // Phase 1: collect unique kit IDs that were ever received by this entity up to atISO.
  // getFullList auto-paginates (batch=200 per page) — no artificial cap.
  const receiptTxs = await pb
    .collection("transactions")
    .getFullList<Transaction>({
      filter: pb.filter(
        "to_entity = {:eid} && timestamp <= {:at}",
        { eid: entityId, at: atISO }
      ),
      sort: "-timestamp,-created",
      fields: "id,kit,to_entity,timestamp",
      batch: 200,
      requestKey: `entity-receipts-${entityId}-${atISO}`,
    });

  // Deduplicate by kit to get the latest receipt per kit (Phase 1 result is
  // already sorted -timestamp so first occurrence = latest).
  const candidateKitIds = new Set<string>();
  for (const tx of receiptTxs) {
    candidateKitIds.add(tx.kit);
  }

  if (candidateKitIds.size === 0) return [];

  // Phase 2: for each candidate, fetch the absolute latest tx ≤ atISO globally.
  // Run in parallel; each call uses a unique requestKey to avoid SDK auto-cancel.
  const absoluteLatestResults = await Promise.all(
    Array.from(candidateKitIds).map((kitId) =>
      pb
        .collection("transactions")
        .getList<Transaction>(1, 1, {
          filter: pb.filter(
            "kit = {:kid} && timestamp <= {:at}",
            { kid: kitId, at: atISO }
          ),
          sort: "-timestamp,-created",
          fields: "id,kit,to_entity,timestamp",
          requestKey: `abs-latest-tx-${kitId}-${atISO}`,
        })
        .then((r) => ({ kitId, tx: r.items[0] ?? null }))
    )
  );

  // Keep kit IDs where absolute latest tx points to our entity.
  const heldKitIds = absoluteLatestResults
    .filter(({ tx }) => tx?.to_entity === entityId)
    .map(({ kitId }) => kitId);

  if (heldKitIds.length === 0) return [];

  // Fetch Kit records in one batch. Missing kits (hard-deleted) are synthesised
  // as "(deleted kit)" placeholder rows — they must not be silently dropped.
  const kitRecordMap = new Map<string, Kit>();
  if (heldKitIds.length > 0) {
    // PB filter uses ~ for "contains" — join ids with | for OR-contains match.
    const idFilter = heldKitIds.join("|");
    const kitRecords = await pb.collection("kits").getFullList<Kit>({
      filter: pb.filter("id ~ {:ids}", { ids: idFilter }),
      batch: 200,
      requestKey: `kit-batch-${entityId}-${atISO}`,
    });
    for (const k of kitRecords) kitRecordMap.set(k.id, k);
  }

  // Build result: matched kits get real record; missing (deleted) get placeholder.
  // Carry lastTxAt from Phase 2 absolute-latest tx timestamp.
  const lastTxByKit = new Map<string, string>();
  for (const { kitId, tx } of absoluteLatestResults) {
    if (tx && heldKitIds.includes(kitId)) {
      lastTxByKit.set(kitId, tx.timestamp);
    }
  }

  return heldKitIds.map((kitId) => {
    const kit: Kit = kitRecordMap.get(kitId) ?? {
      id: kitId,
      serial: "(deleted kit)",
      notes: undefined,
      is_active: false,
      created: "",
      updated: "",
    };
    return {
      kit,
      lastTxAt: lastTxByKit.get(kitId) ?? "",
    };
  });
}
