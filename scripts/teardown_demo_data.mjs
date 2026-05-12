#!/usr/bin/env node
/**
 * Puppet show / demo data teardown.
 * Deletes (or deactivates for soft-delete collections) all DEMO- prefixed records.
 *
 * Usage:
 *   PB_URL=http://127.0.0.1:8090 \
 *   PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... \
 *   node scripts/teardown_demo_data.mjs
 */
import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";
const ADMIN_EMAIL = process.env.PB_SUPERUSER_EMAIL;
const ADMIN_PASSWORD = process.env.PB_SUPERUSER_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("ERROR: PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD must be set");
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

/**
 * Authenticate as PB superuser. PB v0.22 uses /api/admins/auth-with-password;
 * newer versions expose /api/collections/_superusers/auth-with-password.
 */
async function authSuperuser() {
  const body = JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.ok) {
    const data = await res.json();
    pb.authStore.save(data.token, data.admin);
    return;
  }
  const res2 = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res2.ok) {
    const data2 = await res2.json();
    pb.authStore.save(data2.token, data2.record);
    return;
  }
  throw new Error("Superuser auth failed on both endpoints");
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function collectionExists(name) {
  try {
    await pb.collections.getOne(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch all pages matching a filter.
 */
async function fetchAll(collection, filter) {
  const results = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const res = await pb.collection(collection).getList(page, perPage, { filter });
    results.push(...res.items);
    if (results.length >= res.totalItems) break;
    page++;
  }
  return results;
}

/**
 * Hard-delete all DEMO- records in a collection.
 */
async function deleteAll(collection, filter) {
  if (!(await collectionExists(collection))) {
    console.log(`  WARN: ${collection} not found — skipping`);
    return 0;
  }
  const records = await fetchAll(collection, filter);
  let deleted = 0;
  for (const rec of records) {
    try {
      await pb.collection(collection).delete(rec.id);
      deleted++;
    } catch (err) {
      console.warn(`  WARN: could not delete ${collection}/${rec.id}: ${err?.message}`);
    }
  }
  return deleted;
}

/**
 * Soft-delete (deactivate) all DEMO- records via PATCH is_active=false.
 */
async function deactivateAll(collection, filter) {
  if (!(await collectionExists(collection))) {
    console.log(`  WARN: ${collection} not found — skipping`);
    return 0;
  }
  const records = await fetchAll(collection, filter);
  let updated = 0;
  for (const rec of records) {
    if (!rec.is_active) {
      // already inactive — delete record itself (PB has no deleteRule so we just
      // skip, and the record stays soft-deleted)
      updated++;
      continue;
    }
    try {
      await pb.collection(collection).update(rec.id, { is_active: false });
      updated++;
    } catch (err) {
      console.warn(`  WARN: could not deactivate ${collection}/${rec.id}: ${err?.message}`);
    }
  }
  return updated;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function teardown() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  await authSuperuser();
  console.log("Authenticated as superuser.");

  // Deletion order: leaf collections first, then parent collections.

  // Append-only — no deleteRule, so we use a superuser bypass.
  // Superuser token lets us skip collection rules.
  console.log("→ component_transactions...");
  const ctxnCount = await deleteAll(
    "component_transactions",
    'notes ~ "DEMO"'
  );
  console.log(`   removed ${ctxnCount} component_transactions`);

  console.log("→ transactions...");
  const txnCount = await deleteAll("transactions", 'notes ~ "DEMO"');
  console.log(`   removed ${txnCount} transactions`);

  console.log("→ requests...");
  const reqCount = await deleteAll("requests", 'notes ~ "DEMO"');
  console.log(`   removed ${reqCount} requests`);

  // Components: no deleteRule, superuser bypass
  console.log("→ components...");
  const compCount = await deleteAll("components", 'serial ~ "DEMO-" || notes ~ "DEMO"');
  console.log(`   removed ${compCount} components`);

  // kits / entities: soft-delete (no deleteRule by design)
  console.log("→ kits...");
  const kitsCount = await deactivateAll("kits", 'serial ~ "DEMO-"');
  console.log(`   deactivated ${kitsCount} kits`);

  console.log("→ entities...");
  const entCount = await deactivateAll("entities", 'name ~ "DEMO-"');
  console.log(`   deactivated ${entCount} entities`);

  // Optional collections
  if (await collectionExists("kit_maintenance_schedules")) {
    console.log("→ kit_maintenance_schedules...");
    const msCount = await deleteAll("kit_maintenance_schedules", 'notes ~ "DEMO"');
    console.log(`   removed ${msCount} kit_maintenance_schedules`);
  }

  if (await collectionExists("on_call_shifts")) {
    console.log("→ on_call_shifts...");
    const shiftCount = await deleteAll("on_call_shifts", 'notes ~ "DEMO"');
    console.log(`   removed ${shiftCount} on_call_shifts`);
  }

  // Users last (other records reference them)
  console.log("→ users...");
  const userCount = await deleteAll("users", 'email ~ "demo-"');
  console.log(`   removed ${userCount} users`);

  console.log("\nTeardown complete.");
}

teardown().catch((e) => {
  console.error(e);
  process.exit(1);
});
