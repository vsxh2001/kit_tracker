#!/usr/bin/env node
/**
 * Puppet show / demo data seeder — field-service pilot flavor.
 * Creates realistic DEMO- prefixed records across all core collections.
 *
 * Usage:
 *   PB_URL=http://127.0.0.1:8090 \
 *   PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... \
 *   node scripts/seed_demo_data.mjs
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
 * Try v0.22 first, fall back to newer endpoint.
 */
async function authSuperuser() {
  const body = JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  // Try PB v0.22 admin endpoint
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
  // Fall back to newer endpoint
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

// ── helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

async function collectionExists(name) {
  try {
    await pb.collections.getOne(name);
    return true;
  } catch {
    return false;
  }
}

// ── idempotency guard ─────────────────────────────────────────────────────────

async function alreadySeeded() {
  try {
    const res = await pb.collection("entities").getList(1, 1, {
      filter: 'name ~ "DEMO-"',
    });
    return res.totalItems > 0;
  } catch {
    return false;
  }
}

// ── seeders ───────────────────────────────────────────────────────────────────

async function seedEntities() {
  console.log("→ Entities...");
  // type: required legacy field; category: new field added by migration
  const defs = [
    { name: "DEMO-Warehouse",         type: "storage",  category: "storage" },
    { name: "DEMO-Customer-Alpha",    type: "customer", category: "field" },
    { name: "DEMO-Customer-Bravo",    type: "customer", category: "field" },
    { name: "DEMO-Customer-Charlie",  type: "customer", category: "field" },
  ];
  const records = [];
  for (const d of defs) {
    const rec = await pb.collection("entities").create({
      name: d.name,
      type: d.type,
      category: d.category,
      is_active: true,
    });
    records.push(rec);
  }
  console.log(`   created ${records.length} entities`);
  return records;
}

async function seedUsers() {
  console.log("→ Users...");
  const defs = [
    { role: "admin",      email: "demo-admin-1@kit.local",       name: "Demo Admin",      phone: "+972500000010" },
    { role: "technician", email: "demo-technician-1@kit.local",  name: "Demo Tech 1",     phone: "+972500000001" },
    { role: "technician", email: "demo-technician-2@kit.local",  name: "Demo Tech 2",     phone: "+972500000002" },
    { role: "technician", email: "demo-technician-3@kit.local",  name: "Demo Tech 3",     phone: "+972500000003" },
    { role: "technician", email: "demo-technician-4@kit.local",  name: "Demo Tech 4",     phone: "+972500000004" },
    { role: "technician", email: "demo-technician-5@kit.local",  name: "Demo Tech 5",     phone: "+972500000005" },
    { role: "user",       email: "demo-user-1@kit.local",        name: "Demo User 1",     phone: "" },
    { role: "viewer",     email: "demo-viewer-1@kit.local",      name: "Demo Viewer",     phone: "" },
  ];
  const ids = [];
  for (const d of defs) {
    try {
      const payload = {
        email: d.email,
        password: "Pass1234!",
        passwordConfirm: "Pass1234!",
        name: d.name,
        role: d.role,
        emailVisibility: true,
        verified: true,
      };
      if (d.phone) payload.phone = d.phone;
      const rec = await pb.collection("users").create(payload);
      ids.push(rec.id);
    } catch (err) {
      // Likely already exists — fetch it
      if (err?.status === 400) {
        const existing = await pb.collection("users").getFirstListItem(
          `email = "${d.email}"`
        );
        ids.push(existing.id);
        console.log(`   user ${d.email} already exists, reusing`);
      } else {
        throw err;
      }
    }
  }
  console.log(`   created/found ${ids.length} users`);
  return ids;
}

async function seedKits() {
  console.log("→ Kits...");
  const ids = [];
  for (let i = 1; i <= 20; i++) {
    // kits 19-20 are retired (is_active=false)
    const isActive = i <= 18;
    const rec = await pb.collection("kits").create({
      serial: `DEMO-KIT-${pad(i)}`,
      notes: `Demo field-service kit ${pad(i)}`,
      is_active: isActive,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} kits (18 active, 2 retired)`);
  return ids;
}

/**
 * Build realistic lifecycle transactions for each kit.
 *
 * Layout:
 *   kits 1-5  (indices 0-4):   5 at Warehouse  — intake only
 *   kits 6-9  (indices 5-8):   4 at Alpha       — warehouse → customer
 *   kits 10-12 (indices 9-11): 3 at Bravo       — warehouse → customer
 *   kits 13-15 (indices 12-14):3 at Charlie      — warehouse → customer
 *   kits 16-18 (indices 15-17):3 mid-return      — warehouse → customer, last tx notes "RETURN PENDING"
 *   kits 19-20 (indices 18-19):2 retired         — warehouse → customer (history), then deactivated in seedKits
 */
async function seedTransactions(kitIds, entityRecords, userIds) {
  console.log("→ Transactions...");

  const warehouseId = entityRecords[0].id;  // DEMO-Warehouse
  const alphaId     = entityRecords[1].id;  // DEMO-Customer-Alpha
  const bravoId     = entityRecords[2].id;  // DEMO-Customer-Bravo
  const charlieId   = entityRecords[3].id;  // DEMO-Customer-Charlie

  const adminId  = userIds[0];
  const tech1Id  = userIds[1];
  const tech2Id  = userIds[2];
  const tech3Id  = userIds[3];
  const techIds  = [tech1Id, tech2Id, tech3Id];

  const txIds = [];

  // Helper: create a transaction
  async function tx({ kit, from_entity, to_entity, notes, daysBack, createdBy }) {
    const rec = await pb.collection("transactions").create({
      kit,
      from_entity: from_entity || undefined,
      to_entity,
      timestamp: daysAgo(daysBack),
      notes,
      created_by: createdBy,
    });
    txIds.push(rec.id);
  }

  // kits 1-5 — warehouse intake only (2 transactions each: initial receipt + shelf move)
  for (let i = 0; i < 5; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const createdBy = i % 2 === 0 ? adminId : pick(techIds);
    await tx({ kit: kitId, from_entity: null,       to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,             daysBack: randInt(25, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId, to_entity: warehouseId, notes: `DEMO shelf assignment DEMO-KIT-${kitNum}`,   daysBack: randInt(20, 24), createdBy });
  }

  // kits 6-9 — Alpha customer (4 kits)
  for (let i = 5; i < 9; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const createdBy = pick(techIds);
    await tx({ kit: kitId, from_entity: null,        to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,                       daysBack: randInt(28, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: alphaId,    notes: `DEMO deployed to Alpha DEMO-KIT-${kitNum}`,              daysBack: randInt(18, 27), createdBy });
    if (i === 6 || i === 7) {
      // two extra kits have an intermediate move
      await tx({ kit: kitId, from_entity: alphaId,   to_entity: warehouseId, notes: `DEMO temporary recall DEMO-KIT-${kitNum}`,               daysBack: randInt(10, 17), createdBy: adminId });
      await tx({ kit: kitId, from_entity: warehouseId, to_entity: alphaId,   notes: `DEMO re-deployed to Alpha DEMO-KIT-${kitNum}`,            daysBack: randInt(3, 9),  createdBy });
    }
  }

  // kits 10-12 — Bravo customer (3 kits)
  for (let i = 9; i < 12; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const createdBy = pick(techIds);
    await tx({ kit: kitId, from_entity: null,        to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,           daysBack: randInt(28, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: bravoId,    notes: `DEMO deployed to Bravo DEMO-KIT-${kitNum}`, daysBack: randInt(10, 25), createdBy });
  }

  // kits 13-15 — Charlie customer (3 kits)
  for (let i = 12; i < 15; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const createdBy = pick(techIds);
    await tx({ kit: kitId, from_entity: null,        to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,              daysBack: randInt(28, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: charlieId,  notes: `DEMO deployed to Charlie DEMO-KIT-${kitNum}`, daysBack: randInt(10, 25), createdBy });
  }

  // kits 16-18 — mid-return (at customer, last tx has RETURN PENDING)
  const returnCustomers = [alphaId, bravoId, charlieId];
  for (let i = 15; i < 18; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const custId = returnCustomers[i - 15];
    const createdBy = pick(techIds);
    await tx({ kit: kitId, from_entity: null,        to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,                         daysBack: randInt(28, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: custId,     notes: `DEMO deployed DEMO-KIT-${kitNum}`,                        daysBack: randInt(15, 25), createdBy });
    // The critical last transaction — "RETURN PENDING" signals mid-return state
    await tx({ kit: kitId, from_entity: custId,       to_entity: custId,     notes: `DEMO-KIT-${kitNum} RETURN PENDING — customer confirmed`, daysBack: randInt(1, 5),   createdBy: adminId });
  }

  // kits 19-20 — retired, have historical transactions
  for (let i = 18; i < 20; i++) {
    const kitId = kitIds[i];
    const kitNum = pad(i + 1);
    const custId = pick([alphaId, bravoId, charlieId]);
    await tx({ kit: kitId, from_entity: null,        to_entity: warehouseId, notes: `DEMO intake DEMO-KIT-${kitNum}`,              daysBack: randInt(28, 30), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: custId,     notes: `DEMO deployed DEMO-KIT-${kitNum}`,             daysBack: randInt(20, 27), createdBy: pick(techIds) });
    await tx({ kit: kitId, from_entity: custId,       to_entity: warehouseId, notes: `DEMO returned DEMO-KIT-${kitNum}`,            daysBack: randInt(10, 19), createdBy: adminId });
    await tx({ kit: kitId, from_entity: warehouseId,  to_entity: warehouseId, notes: `DEMO retired DEMO-KIT-${kitNum} — end of life`, daysBack: randInt(1, 9),  createdBy: adminId });
  }

  console.log(`   created ${txIds.length} transactions`);
  return txIds;
}

async function seedProducts() {
  console.log("→ Products (required FK for components)...");
  const catalog = [
    { name: "DEMO-PROD-Card",    category: "Card",    manufacturer: "DemoCo", model: "C-100" },
    { name: "DEMO-PROD-SSD",     category: "SSD",     manufacturer: "DemoCo", model: "S-200" },
    { name: "DEMO-PROD-Battery", category: "Battery", manufacturer: "DemoCo", model: "B-300" },
    { name: "DEMO-PROD-Cable",   category: "Cable",   manufacturer: "DemoCo", model: "K-400" },
    { name: "DEMO-PROD-Lens",    category: "Lens",    manufacturer: "DemoCo", model: "L-500" },
  ];
  const products = [];
  for (const p of catalog) {
    try {
      const rec = await pb.collection("products").create({
        name: p.name,
        category: p.category,
        manufacturer: p.manufacturer,
        model: p.model,
        description: `Demo product ${p.name}`,
        specs: "{}",
        is_active: true,
      });
      products.push(rec);
    } catch (err) {
      if (err?.status === 400) {
        // products may not exist in all environments
        console.log(`   WARN: could not create product ${p.name}: ${err?.message}`);
      } else {
        throw err;
      }
    }
  }
  console.log(`   created ${products.length} products`);
  return products;
}

async function seedMaintenanceSchedules(kitIds) {
  console.log("→ Kit maintenance schedules...");
  if (!(await collectionExists("kit_maintenance_schedules"))) {
    console.log("   WARN: kit_maintenance_schedules collection not found — skipping");
    return [];
  }
  const types = ["calibration", "service", "inspection"];
  const intervals = [30, 90, 365];
  const ids = [];
  for (let i = 0; i < 15; i++) {
    const rec = await pb.collection("kit_maintenance_schedules").create({
      kit: pick(kitIds),
      type: pick(types),
      interval_days: pick(intervals),
      next_due_at: daysFromNow(randInt(1, 180)),
      notes: `Demo maintenance schedule ${pad(i + 1)}`,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} maintenance schedules`);
  return ids;
}

async function seedOnCallShifts(userIds) {
  console.log("→ On-call shifts...");
  if (!(await collectionExists("on_call_shifts"))) {
    console.log("   WARN: on_call_shifts collection not found — skipping");
    return [];
  }
  const adminId = userIds[0];
  const tech1Id = userIds[1];
  const tech2Id = userIds[2];
  const tech3Id = userIds[3];
  const shifts = [
    {
      user: tech1Id,
      start_at: daysAgo(1),
      end_at: daysFromNow(1),
      notes: "DEMO current shift",
      created_by: adminId,
    },
    {
      user: tech2Id,
      start_at: daysAgo(10),
      end_at: daysAgo(7),
      notes: "DEMO past shift",
      created_by: adminId,
    },
    {
      user: tech3Id,
      start_at: daysFromNow(7),
      end_at: daysFromNow(14),
      notes: "DEMO future shift",
      created_by: adminId,
    },
  ];
  const ids = [];
  for (const s of shifts) {
    const rec = await pb.collection("on_call_shifts").create(s);
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} on-call shifts`);
  return ids;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  await authSuperuser();
  console.log("Authenticated as superuser.");

  if (await alreadySeeded()) {
    console.log("Already seeded. Run teardown_demo_data.mjs first to re-seed.");
    process.exit(0);
  }

  const entityRecords = await seedEntities();
  const userIds       = await seedUsers();
  const kitIds        = await seedKits();
  await seedTransactions(kitIds, entityRecords, userIds);
  await seedProducts();
  await seedMaintenanceSchedules(kitIds);
  await seedOnCallShifts(userIds);

  const warehouseId = entityRecords[0].id;

  console.log("\nDone. Field-service pilot demo data seeded.");
  console.log(
    `  ${entityRecords.length} entities | ${userIds.length} users | ${kitIds.length} kits`
  );
  console.log(`  Layout: 5 at Warehouse | 4 at Alpha | 3 at Bravo | 3 at Charlie | 3 mid-return | 2 retired`);
  console.log(`\nDEMO-Warehouse entity ID: ${warehouseId}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
