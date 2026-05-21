import { pb } from "../../../lib/pocketbase";
import { getLatestTransaction, parseTags, getKitHistory } from "../../../services/kits";
import { listEntities } from "../../../services/entities";
import { listProducts, listComponentsForProduct } from "../../../services/products";
import { listComponentsInKit, getLatestForComponent, listTransactionsForComponent } from "../../../services/componentTransactions";
import { listRequests } from "../../../services/requests";
import { listAllActiveSchedules } from "../../../services/maintenance";
import { getCurrentOnCallUsers } from "../../../services/oncall";
import { formatDateOnly, maintenanceStatus } from "../../../lib/utils";
import type { Kit, Entity, Component, Transaction } from "../../../types";

type SlashResult = { ok: true; text: string } | { ok: false; error: string };

// ─── /kit <serial> ────────────────────────────────────────────────────────────

export async function handleKit(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) return { ok: false, error: "Usage: `/kit <serial>`" };

  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial}", { serial }),
      { requestKey: `slash-kit-${serial}` }
    );
  } catch {
    return { ok: false, error: `No kit with serial '${serial}'.` };
  }

  const [latestTx, allTx, compsInKit, schedules] = await Promise.all([
    getLatestTransaction(kit.id).catch(() => null),
    getKitHistory(kit.id).catch(() => [] as Transaction[]),
    listComponentsInKit(kit.id).catch(() => [] as Component[]),
    listAllActiveSchedules({ filter: pb.filter("kit = {:kit}", { kit: kit.id }) }).catch(() => []),
  ]);

  const holder = latestTx?.expand?.to_entity?.name ?? latestTx?.to_entity ?? "Unknown";
  const since = latestTx ? formatDateOnly(latestTx.timestamp) : "—";

  const tags = parseTags(kit.tags);
  const tagStr = tags.length ? `\n**Tags:** ${tags.join(", ")}` : "";

  // Components
  let compLines;
  if (compsInKit.length === 0) {
    compLines = "\n**Components in kit:** 0";
  } else {
    const shown = compsInKit.slice(0, 5);
    const rest = compsInKit.length - shown.length;
    const items = shown.map((c: Component) => {
      const prodName = c.expand?.product?.name ?? "";
      const suffix = prodName ? ` (${prodName})` : "";
      return `- \`${c.serial || c.id}\`${suffix}`;
    });
    if (rest > 0) items.push(`- +${rest} more`);
    compLines = `\n**Components in kit:** ${compsInKit.length}\n${items.join("\n")}`;
  }

  // Maintenance
  const openMaint = schedules.filter((s) => maintenanceStatus(s.next_due_at) !== "ok");
  let maintLines = "";
  if (openMaint.length > 0) {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
    const items = openMaint.slice(0, 5).map((s) => {
      const due = new Date(s.next_due_at.slice(0, 10) + "T00:00:00").getTime();
      const days = Math.round((due - today) / 86400000);
      const label = days < 0 ? `${Math.abs(days)}d overdue` : `due in ${days}d`;
      return `- ${s.type || s.description} (${label})`;
    });
    maintLines = `\n**Open maintenance:** ${openMaint.length}\n${items.join("\n")}`;
  }

  // Last 5 moves
  const moves = allTx.slice(0, 5);
  let moveLines = "";
  if (moves.length > 0) {
    const items = moves.map((tx: Transaction) => {
      const to = tx.expand?.to_entity?.name ?? tx.to_entity;
      const by = tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? "?";
      return `- ${formatDateOnly(tx.timestamp)} → ${to} (${by})`;
    });
    const rest = allTx.length - moves.length;
    if (rest > 0) items.push(`- +${rest} more on /kits/${kit.id}`);
    moveLines = `\n**Last 5 moves:**\n${items.join("\n")}`;
  }

  const text = `**Kit \`${kit.serial}\`** at **${holder}** (since ${since})${tagStr}${compLines}${maintLines}${moveLines}`;
  return { ok: true, text };
}

// ─── /comp <serial> ───────────────────────────────────────────────────────────

export async function handleComp(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) return { ok: false, error: "Usage: `/comp <serial>`" };

  let comp: Component;
  try {
    comp = await pb.collection("components").getFirstListItem<Component>(
      pb.filter("serial = {:serial}", { serial }),
      { expand: "product", requestKey: `slash-comp-${serial}` }
    );
  } catch {
    return { ok: false, error: `No component with serial '${serial}'.` };
  }

  const [latestTx, txHistory] = await Promise.all([
    getLatestForComponent(comp.id).catch(() => null),
    listTransactionsForComponent(comp.id).catch(() => []),
  ]);

  const prodName = comp.expand?.product?.name ?? "—";
  let location = "Unknown";
  if (latestTx) {
    const kitName = latestTx.expand?.to_kit?.serial;
    const entName = latestTx.expand?.to_entity?.name;
    if (kitName) location = `Kit \`${kitName}\``;
    else if (entName) location = entName;
    else location = latestTx.to_kit || latestTx.to_entity || "Unknown";
  }

  const last3 = txHistory.slice(0, 3);
  let txLines = "";
  if (last3.length > 0) {
    const items = last3.map((tx) => {
      const toKit = tx.expand?.to_kit?.serial;
      const toEnt = tx.expand?.to_entity?.name;
      const dest = toKit ? `Kit \`${toKit}\`` : (toEnt ?? tx.to_entity ?? "—");
      return `- ${formatDateOnly(tx.timestamp)} → ${dest}`;
    });
    txLines = `\n**Last 3 moves:**\n${items.join("\n")}`;
  }

  const text = `**Component \`${comp.serial}\`**\n**Product:** ${prodName}\n**Location:** ${location}${txLines}`;
  return { ok: true, text };
}

// ─── /comps <product-name> ────────────────────────────────────────────────────

export async function handleComps(args: string[]): Promise<SlashResult> {
  const productName = args.join(" ").trim();
  if (!productName) return { ok: false, error: "Usage: `/comps <product-name>`" };

  // Try exact match first, fall back to substring
  let products;
  try {
    const exact = await pb.collection("products").getFullList({
      filter: pb.filter("name = {:n}", { n: productName }),
      requestKey: `slash-comps-exact-${productName}`,
    });
    if (exact.length > 0) {
      products = exact;
    } else {
      products = await pb.collection("products").getFullList({
        filter: pb.filter("name ~ {:n}", { n: productName }),
        requestKey: `slash-comps-lookup-${productName}`,
      });
    }
  } catch {
    return { ok: false, error: "Failed to search products." };
  }

  if (products.length === 0) return { ok: false, error: `No product matching '${productName}'.` };
  if (products.length >= 2) {
    const names = products.slice(0, 5).map((p) => p.name).join(", ");
    return { ok: false, error: `Multiple matches for "${productName}": ${names}. Be more specific.` };
  }
  const product = products[0];

  const components = await listComponentsForProduct(product.id).catch(() => [] as Component[]);
  if (components.length === 0) {
    return { ok: true, text: `**${product.name}** — no components found.` };
  }

  const shown = components.slice(0, 5);
  const rest = components.length - shown.length;

  const items = await Promise.all(
    shown.map(async (c: Component) => {
      const tx = await getLatestForComponent(c.id).catch(() => null);
      let loc = "untracked";
      if (tx) {
        const toKit = tx.expand?.to_kit?.serial;
        const toEnt = tx.expand?.to_entity?.name;
        loc = toKit ? `Kit \`${toKit}\`` : (toEnt ?? tx.to_entity ?? "untracked");
      }
      return `- \`${c.serial || c.id}\` — ${loc}`;
    })
  );
  if (rest > 0) items.push(`- +${rest} more`);

  const text = `**${product.name}** components (${components.length}):\n${items.join("\n")}`;
  return { ok: true, text };
}

// ─── /inkit <kit-serial> ──────────────────────────────────────────────────────

export async function handleInKit(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) return { ok: false, error: "Usage: `/inkit <kit-serial>`" };

  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial}", { serial }),
      { requestKey: `slash-inkit-${serial}` }
    );
  } catch {
    return { ok: false, error: `No kit with serial '${serial}'.` };
  }

  const comps = await listComponentsInKit(kit.id).catch(() => [] as Component[]);
  if (comps.length === 0) {
    return { ok: true, text: `Kit \`${kit.serial}\` has no components.` };
  }

  const shown = comps.slice(0, 5);
  const rest = comps.length - shown.length;
  const items = shown.map((c: Component) => {
    const prodName = c.expand?.product?.name ?? "";
    const suffix = prodName ? ` (${prodName})` : "";
    return `- \`${c.serial || c.id}\`${suffix}`;
  });
  if (rest > 0) items.push(`- +${rest} more on /kits/${kit.id}`);

  return { ok: true, text: `**Components in kit \`${kit.serial}\`** (${comps.length}):\n${items.join("\n")}` };
}

// ─── /at <entity-name> ────────────────────────────────────────────────────────

export async function handleAt(args: string[]): Promise<SlashResult> {
  const entityName = args.join(" ").trim();
  if (!entityName) return { ok: false, error: "Usage: `/at <entity-name>`" };

  // Resolve entity — exact match first, then substring
  let entities: Entity[];
  try {
    const exact = await pb.collection("entities").getFullList<Entity>({
      filter: pb.filter("name = {:n}", { n: entityName }),
      requestKey: `slash-at-exact-${entityName}`,
    });
    if (exact.length > 0) {
      entities = exact;
    } else {
      entities = await pb.collection("entities").getFullList<Entity>({
        filter: pb.filter("name ~ {:n}", { n: entityName }),
        requestKey: `slash-at-lookup-${entityName}`,
      });
    }
  } catch {
    return { ok: false, error: "Failed to search entities." };
  }

  if (entities.length === 0) return { ok: false, error: `No entity matching '${entityName}'.` };
  if (entities.length >= 2) {
    const names = entities.slice(0, 5).map((e) => e.name).join(", ");
    return { ok: false, error: `Multiple matches for "${entityName}": ${names}. Be more specific.` };
  }
  const entity = entities[0];

  // Query transactions landing at this entity — dedupe by kit (keep first = latest per sort)
  // Hard-cap at 200 rows via getList (getFullList paginates internally, ignores perPage as hard cap)
  let candidateTxs: Transaction[];
  try {
    const txPage = await pb.collection("transactions").getList<Transaction>(1, 200, {
      filter: pb.filter("to_entity = {:eid}", { eid: entity.id }),
      sort: "-timestamp,-created",
      expand: "kit",
      requestKey: `slash-at-txs-${entity.id}`,
    });
    candidateTxs = txPage.items;
  } catch {
    return { ok: false, error: "Failed to query transactions." };
  }

  // Dedupe: first occurrence per kit.id is the most-recent tx to this entity
  const seenKit = new Set<string>();
  const candidates: Array<{ kitId: string; kitSerial: string; txId: string; timestamp: string }> = [];
  for (const tx of candidateTxs) {
    if (!tx.kit || seenKit.has(tx.kit)) continue;
    seenKit.add(tx.kit);
    const serial = (tx.expand?.kit as Kit | undefined)?.serial ?? tx.kit;
    candidates.push({ kitId: tx.kit, kitSerial: serial, txId: tx.id, timestamp: tx.timestamp });
  }

  // Cap candidates before Promise.all — output is already ≤50, pre-cap avoids N-50 wasted requests
  const cappedCandidates = candidates.slice(0, 50);

  // Verify each candidate: confirm its absolute latest tx is still to this entity
  const verified = await Promise.all(
    cappedCandidates.map(async (c) => {
      const latest = await getLatestTransaction(c.kitId).catch(() => null);
      if (!latest || latest.to_entity !== entity.id) return null;
      return { serial: c.kitSerial, since: formatDateOnly(latest.timestamp) };
    })
  );

  const results = verified.filter((r): r is { serial: string; since: string } => r !== null);

  if (results.length === 0) {
    return { ok: true, text: `No kits currently at **${entity.name}**.` };
  }

  const shown = results.slice(0, 50);
  const rest = results.length - shown.length;
  const items = shown.map(({ serial, since }) => `- \`${serial}\` (since ${since})`);
  if (rest > 0) items.push(`- +${rest} more`);

  return { ok: true, text: `**Kits at ${entity.name}** (${results.length}):\n${items.join("\n")}` };
}

// ─── /upcoming ────────────────────────────────────────────────────────────────

export async function handleUpcoming(): Promise<SlashResult> {
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const today = new Date().toISOString().slice(0, 10);
  const limit = in30.toISOString().slice(0, 10);

  const requests = await listRequests().catch(() => []);
  const filtered = requests
    .filter((r) => (r.status === "approved" || r.status === "open") && r.delivery_date >= today && r.delivery_date <= limit)
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));

  if (filtered.length === 0) {
    return { ok: true, text: "No approved/open requests with delivery in the next 30 days." };
  }

  const shown = filtered.slice(0, 5);
  const rest = filtered.length - shown.length;
  const items = shown.map((r) => {
    const kit = r.expand?.designated_kit?.serial ?? "—";
    const entity = r.expand?.target_entity?.name ?? "—";
    return `- ${r.delivery_date} — kit \`${kit}\` → ${entity} [${r.status}]`;
  });
  if (rest > 0) items.push(`- +${rest} more`);

  return { ok: true, text: `**Upcoming deliveries (next 30 days)** (${filtered.length}):\n${items.join("\n")}` };
}

// ─── /due ─────────────────────────────────────────────────────────────────────

export async function handleDue(): Promise<SlashResult> {
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const limit = in7.toISOString().slice(0, 10);

  const schedules = await listAllActiveSchedules().catch(() => []);
  const due = schedules.filter((s) => {
    const status = maintenanceStatus(s.next_due_at, 7);
    return status === "due-soon" || status === "overdue";
  }).sort((a, b) => a.next_due_at.localeCompare(b.next_due_at));

  void limit; // limit computed for context; maintenanceStatus handles the window

  if (due.length === 0) {
    return { ok: true, text: "No maintenance due in the next 7 days." };
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  const shown = due.slice(0, 5);
  const rest = due.length - shown.length;
  const items = shown.map((s) => {
    const kitSerial = s.expand?.kit?.serial ?? s.kit;
    const dueDate = s.next_due_at.slice(0, 10);
    const days = Math.round((new Date(dueDate + "T00:00:00").getTime() - today) / 86400000);
    const label = days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`;
    return `- \`${kitSerial}\` — ${s.type || s.description} (${label}) due ${dueDate}`;
  });
  if (rest > 0) items.push(`- +${rest} more`);

  return { ok: true, text: `**Maintenance due in next 7 days** (${due.length}):\n${items.join("\n")}` };
}

// ─── /me ──────────────────────────────────────────────────────────────────────

export async function handleMe(): Promise<SlashResult> {
  const me = pb.authStore.model;
  if (!me) return { ok: false, error: "Not authenticated." };

  const [allRequests, onCallUsers] = await Promise.all([
    listRequests("open").catch(() => []),
    getCurrentOnCallUsers().catch(() => []),
  ]);

  const myOpenReqs = allRequests.filter((r) => r.requester === me.id);
  const amOnCall = onCallUsers.some((u) => u.id === me.id);

  const lines = [
    `**${me.name ?? me.email}**`,
    `**Role:** ${me.role ?? "—"}`,
    `**Open requests:** ${myOpenReqs.length}`,
    `**On call now:** ${amOnCall ? "Yes" : "No"}`,
  ];

  return { ok: true, text: lines.join("\n") };
}

// ─── /today ───────────────────────────────────────────────────────────────────

export async function handleToday(): Promise<SlashResult> {
  const today = new Date().toISOString().slice(0, 10);

  const [openRequests, onCallUsers, schedules] = await Promise.all([
    listRequests("open").catch(() => []),
    getCurrentOnCallUsers().catch(() => []),
    listAllActiveSchedules().catch(() => []),
  ]);

  const deliveriesToday = await listRequests("approved")
    .then((reqs) => reqs.filter((r) => r.delivery_date === today))
    .catch(() => []);

  const overdueMaint = schedules.filter((s) => maintenanceStatus(s.next_due_at) === "overdue");
  const oncallNames = onCallUsers.map((u) => u.name ?? u.email).join(", ") || "Nobody";

  const lines = [
    `**Daily standup — ${today}**`,
    `**Open requests:** ${openRequests.length}`,
    `**Deliveries today:** ${deliveriesToday.length}`,
    `**On call:** ${oncallNames}`,
    `**Overdue maintenance:** ${overdueMaint.length}`,
  ];

  return { ok: true, text: lines.join("\n") };
}

// ─── /history <kit-serial> ────────────────────────────────────────────────────

export async function handleHistory(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) return { ok: false, error: "Usage: `/history <kit-serial>`" };

  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial}", { serial }),
      { requestKey: `slash-history-${serial}` }
    );
  } catch {
    return { ok: false, error: `No kit with serial '${serial}'.` };
  }

  const allTx = await getKitHistory(kit.id).catch(() => [] as Transaction[]);
  if (allTx.length === 0) {
    return { ok: true, text: `Kit \`${kit.serial}\` has no recorded transactions.` };
  }

  const shown = allTx.slice(0, 10);
  const rest = allTx.length - shown.length;
  const items = shown.map((tx: Transaction) => {
    const from = tx.expand?.from_entity?.name ?? (tx.from_entity ? tx.from_entity : "—");
    const to = tx.expand?.to_entity?.name ?? tx.to_entity;
    const by = tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? "?";
    return `- ${formatDateOnly(tx.timestamp)} ${from} → **${to}** (${by})`;
  });
  if (rest > 0) items.push(`- +${rest} more on /kits/${kit.id}`);

  return { ok: true, text: `**Timeline for kit \`${kit.serial}\`** (${allTx.length} moves):\n${items.join("\n")}` };
}

// ─── Field autocomplete resource fetchers ────────────────────────────────────
// Cache per session — Map<cacheKey, { promise, fetchedAt }> so concurrent
// keystroke events reuse the same in-flight promise. Invalidated on
// 'kit-tracker:data-changed' events (dispatched by create/update dialogs).

const _CACHE_TTL_MS = 60_000;

interface CacheEntry {
  promise: Promise<string[]>;
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry>();

export function clearAcCache(): void {
  _cache.clear();
}

// Invalidate when the user creates/updates data in the same session
if (typeof window !== "undefined") {
  window.addEventListener("kit-tracker:data-changed", () => _cache.clear());
}

function cached(key: string, fn: () => Promise<string[]>): Promise<string[]> {
  const entry = _cache.get(key);
  const now = Date.now();
  if (entry && now - entry.fetchedAt < _CACHE_TTL_MS) {
    return entry.promise;
  }
  const promise = fn();
  _cache.set(key, { promise, fetchedAt: now });
  return promise;
}

export function fetchKitSerials(): Promise<string[]> {
  return cached("kit-serials", async () => {
    const kits = await pb.collection("kits").getFullList<Kit>({
      filter: "is_active = true",
      sort: "serial",
      requestKey: "ac-kit-serials",
    });
    return kits.map((k: Kit) => k.serial);
  });
}

export function fetchEntityNames(): Promise<string[]> {
  return cached("entity-names", async () => {
    const ents = await listEntities(false);
    return ents.map((e: Entity) => e.name);
  });
}

export function fetchProductNames(): Promise<string[]> {
  return cached("product-names", async () => {
    const prods = await listProducts();
    return prods.map((p) => p.name);
  });
}
