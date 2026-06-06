import { pb } from "../../../lib/pocketbase";
import { getLatestTransaction, parseTags, getKitHistory, getKitBySerial, listActiveKitSerials, listKits } from "../../../services/kits";
import { listEntities, findEntitiesByName } from "../../../services/entities";
import { listProducts, listComponentsForProduct, findProductsByName } from "../../../services/products";
import { listComponentsInKit, getLatestForComponent, listTransactionsForComponent } from "../../../services/componentTransactions";
import { listRequests, createRequest, updateRequestStatus } from "../../../services/requests";
import { listAllActiveSchedules } from "../../../services/maintenance";
import { getCurrentOnCallUsers } from "../../../services/oncall";
import { listTransactionsByToEntity, createTransaction } from "../../../services/transactions";
import { getComponentBySerial } from "../../../services/components";
import { formatDateOnly, maintenanceStatus } from "../../../lib/utils";
import { maintenanceTypeLabel } from "../../../lib/maintenance-types";
import type { Kit, Entity, Component, Transaction } from "../../../types";

type SlashResult = { ok: true; text: string } | { ok: false; error: string };

// ─── /kit <serial> ────────────────────────────────────────────────────────────

export async function handleKit(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) return { ok: false, error: "Usage: `/kit <serial>`" };

  let kit: Kit;
  try {
    kit = await getKitBySerial(serial);
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
    const todayLocal = new Date().toLocaleDateString("en-CA");
    const today = new Date(todayLocal + "T00:00:00").getTime();
    const items = openMaint.slice(0, 5).map((s) => {
      const due = new Date(s.next_due_at.slice(0, 10) + "T00:00:00").getTime();
      const days = Math.round((due - today) / 86400000);
      const label = days < 0 ? `${Math.abs(days)}d overdue` : `due in ${days}d`;
      return `- ${s.type ? maintenanceTypeLabel(s.type) : s.description} (${label})`;
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
    comp = await getComponentBySerial(serial);
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

  let products;
  try {
    products = await findProductsByName(productName);
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
    kit = await getKitBySerial(serial);
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

  let entities: Entity[];
  try {
    entities = await findEntitiesByName(entityName);
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
    candidateTxs = await listTransactionsByToEntity(entity.id, 200);
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
  const today = new Date().toLocaleDateString("en-CA");
  const limit = new Date(in30.getFullYear(), in30.getMonth(), in30.getDate()).toLocaleDateString("en-CA");

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
  const limit = new Date(in7.getFullYear(), in7.getMonth(), in7.getDate()).toLocaleDateString("en-CA");

  const schedules = await listAllActiveSchedules().catch(() => []);
  const due = schedules.filter((s) => {
    const status = maintenanceStatus(s.next_due_at, 7);
    return status === "due-soon" || status === "overdue";
  }).sort((a, b) => a.next_due_at.localeCompare(b.next_due_at));

  void limit; // limit computed for context; maintenanceStatus handles the window

  if (due.length === 0) {
    return { ok: true, text: "No maintenance due in the next 7 days." };
  }

  const today = new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00").getTime();
  const shown = due.slice(0, 5);
  const rest = due.length - shown.length;
  const items = shown.map((s) => {
    const kitSerial = s.expand?.kit?.serial ?? s.kit;
    const dueDate = s.next_due_at.slice(0, 10);
    const days = Math.round((new Date(dueDate + "T00:00:00").getTime() - today) / 86400000);
    const label = days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`;
    return `- \`${kitSerial}\` — ${s.type ? maintenanceTypeLabel(s.type) : s.description} (${label}) due ${dueDate}`;
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
  const today = new Date().toLocaleDateString("en-CA");

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
    kit = await getKitBySerial(serial);
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

// ─── /find <text> ────────────────────────────────────────────────────────────

export async function handleFind(args: string[]): Promise<SlashResult> {
  const query = args.join(" ").trim().toLowerCase();
  if (!query) return { ok: false, error: "Usage: `/find <text>`" };

  const [kits, entities] = await Promise.all([
    listKits(false).catch(() => [] as Kit[]),
    listEntities(false).catch(() => [] as Entity[]),
  ]);

  const matchedKits = kits.filter((k: Kit) => {
    return (
      k.serial.toLowerCase().includes(query) ||
      (k.notes ?? "").toLowerCase().includes(query)
    );
  });

  const matchedEntities = entities.filter((e: Entity) =>
    e.name.toLowerCase().includes(query)
  );

  if (matchedKits.length === 0 && matchedEntities.length === 0) {
    return { ok: true, text: `No kits or entities match \`${query}\`.` };
  }

  const lines: string[] = [];
  if (matchedKits.length > 0) {
    lines.push(`**Kits** (${matchedKits.length}):`);
    const shown = matchedKits.slice(0, 10);
    const rest = matchedKits.length - shown.length;
    shown.forEach((k: Kit) => lines.push(`- \`${k.serial}\`${k.notes ? ` — ${k.notes}` : ""}`));
    if (rest > 0) lines.push(`- +${rest} more`);
  }
  if (matchedEntities.length > 0) {
    lines.push(`**Entities** (${matchedEntities.length}):`);
    const shown = matchedEntities.slice(0, 10);
    const rest = matchedEntities.length - shown.length;
    shown.forEach((e: Entity) => lines.push(`- ${e.name}`));
    if (rest > 0) lines.push(`- +${rest} more`);
  }

  return { ok: true, text: lines.join("\n") };
}

// ─── /move <kit-serial> <entity-name> ────────────────────────────────────────

export async function handleMove(args: string[]): Promise<SlashResult> {
  const [serial, ...entityParts] = args;
  const entityName = entityParts.join(" ").trim();

  if (!serial || !entityName) {
    return { ok: false, error: "Usage: `/move <kit-serial> <entity-name>`" };
  }

  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial} && is_active = true", { serial }),
      { requestKey: `slash-move-kit-${serial}` }
    );
  } catch {
    return { ok: false, error: `No active kit with serial '${serial}'.` };
  }

  let entities: Entity[];
  try {
    entities = await findEntitiesByName(entityName);
  } catch {
    return { ok: false, error: "Failed to search entities." };
  }

  if (entities.length === 0) return { ok: false, error: `No entity named '${entityName}'.` };

  // Require an exact case-insensitive name match — no silent substring auto-apply on writes.
  const exactMatch = entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase());
  if (!exactMatch) {
    const suggestions = entities.slice(0, 3).map((e) => e.name).join(", ");
    return {
      ok: false,
      error: `No entity named exactly "${entityName}". Did you mean: ${suggestions}? Use the exact name.`,
    };
  }
  const entity = exactMatch;

  const latest = await getLatestTransaction(kit.id).catch(() => null);
  const fromEntityId = latest?.to_entity ?? undefined;

  try {
    await createTransaction({
      kitId: kit.id,
      fromEntityId,
      toEntityId: entity.id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Transaction failed.";
    return { ok: false, error: `Move failed: ${msg}` };
  }

  return { ok: true, text: `Moved \`${kit.serial}\` → **${entity.name}**.` };
}

// ─── /request <kit-serial> <entity-name> [YYYY-MM-DD] ───────────────────────

export async function handleRequest(args: string[]): Promise<SlashResult> {
  if (args.length < 2) {
    return { ok: false, error: "Usage: `/request <kit-serial> <entity-name> [YYYY-MM-DD]`" };
  }

  const serial = args[0];

  // Last arg may be a date (YYYY-MM-DD); if so, entity name is middle args
  const lastArg = args[args.length - 1];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  let entityParts: string[];
  let deliveryDate: string;

  if (args.length >= 3 && dateRe.test(lastArg)) {
    entityParts = args.slice(1, args.length - 1);
    deliveryDate = lastArg;
  } else {
    entityParts = args.slice(1);
    deliveryDate = new Date().toLocaleDateString("en-CA");
  }

  const entityName = entityParts.join(" ").trim();
  if (!entityName) {
    return { ok: false, error: "Usage: `/request <kit-serial> <entity-name> [YYYY-MM-DD]`" };
  }

  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial} && is_active = true", { serial }),
      { requestKey: `slash-request-kit-${serial}` }
    );
  } catch {
    return { ok: false, error: `No active kit with serial '${serial}'.` };
  }

  let entities: Entity[];
  try {
    entities = await findEntitiesByName(entityName);
  } catch {
    return { ok: false, error: "Failed to search entities." };
  }

  if (entities.length === 0) return { ok: false, error: `No entity named '${entityName}'.` };

  // Require an exact case-insensitive name match — no silent substring auto-apply on writes.
  const exactMatch = entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase());
  if (!exactMatch) {
    const suggestions = entities.slice(0, 3).map((e) => e.name).join(", ");
    return {
      ok: false,
      error: `No entity named exactly "${entityName}". Did you mean: ${suggestions}? Use the exact name.`,
    };
  }
  const entity = exactMatch;

  try {
    const req = await createRequest({
      designated_kit: kit.id,
      target_entity: entity.id,
      delivery_date: deliveryDate,
    });
    return {
      ok: true,
      text: `Request created (\`${req.id}\`) — kit \`${kit.serial}\` → **${entity.name}**, delivery ${deliveryDate}.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Request failed.";
    return { ok: false, error: `Create request failed: ${msg}` };
  }
}

// ─── /approve <handle> [notes] ───────────────────────────────────────────────

export async function handleApprove(args: string[]): Promise<SlashResult> {
  if (args.length === 0) {
    return { ok: false, error: "Usage: `/approve <request-id> [notes]`" };
  }

  const handle = args[0];
  const notes = args.slice(1).join(" ").trim() || undefined;

  const resolved = await resolveRequestHandle(handle, "open");
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const reqId = resolved.id;

  try {
    await updateRequestStatus(reqId, "approved", { decision_notes: notes });
    return { ok: true, text: `Request \`${reqId}\` approved.${notes ? ` Notes: ${notes}` : ""}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed.";
    return { ok: false, error: `Approve failed: ${msg}` };
  }
}

// ─── /reject <handle> [notes] ────────────────────────────────────────────────

export async function handleReject(args: string[]): Promise<SlashResult> {
  if (args.length === 0) {
    return { ok: false, error: "Usage: `/reject <request-id> [notes]`" };
  }

  const handle = args[0];
  const notes = args.slice(1).join(" ").trim() || undefined;

  const resolved = await resolveRequestHandle(handle, "open");
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const reqId = resolved.id;

  try {
    await updateRequestStatus(reqId, "rejected", { decision_notes: notes });
    return { ok: true, text: `Request \`${reqId}\` rejected.${notes ? ` Notes: ${notes}` : ""}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed.";
    return { ok: false, error: `Reject failed: ${msg}` };
  }
}

// ─── Request handle resolver ──────────────────────────────────────────────────
// Accepts full ID or a suffix; resolves among open requests only.

async function resolveRequestHandle(
  handle: string,
  statusFilter: "open"
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const requests = await listRequests(statusFilter).catch(() => []);
  const lower = handle.toLowerCase();

  // Exact match first
  const exact = requests.find((r) => r.id === handle);
  if (exact) return { ok: true, id: exact.id };

  // Suffix match
  const matches = requests.filter((r) => r.id.toLowerCase().endsWith(lower));
  if (matches.length === 1) return { ok: true, id: matches[0].id };
  if (matches.length > 1) {
    const ids = matches.slice(0, 5).map((r) => r.id).join(", ");
    return { ok: false, error: `Ambiguous suffix '${handle}' matches: ${ids}. Use more characters.` };
  }

  return { ok: false, error: `No open request found matching '${handle}'.` };
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
  return cached("kit-serials", () => listActiveKitSerials());
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
