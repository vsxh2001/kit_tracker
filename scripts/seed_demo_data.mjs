#!/usr/bin/env node
/**
 * Puppet show / demo data seeder.
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
  // type select: person, team, lab, storage, customer, maintenance, other
  const types = [
    "storage", "storage", "storage",
    "customer", "customer", "customer",
    "maintenance", "maintenance",
    "lab", "lab",
  ];
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const rec = await pb.collection("entities").create({
      name: `DEMO-Entity-${pad(i + 1)}`,
      type: types[i],
      description: `Demo ${types[i]} entity ${pad(i + 1)}`,
      is_active: true,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} entities`);
  return ids;
}

async function seedUsers() {
  console.log("→ Users...");
  const defs = [
    { role: "admin", email: "demo-admin-1@kit.local", name: "Demo Admin" },
    { role: "technician", email: "demo-technician-1@kit.local", name: "Demo Tech 1" },
    { role: "technician", email: "demo-technician-2@kit.local", name: "Demo Tech 2" },
    { role: "user", email: "demo-user-1@kit.local", name: "Demo User 1" },
    { role: "user", email: "demo-user-2@kit.local", name: "Demo User 2" },
    { role: "viewer", email: "demo-viewer-1@kit.local", name: "Demo Viewer" },
  ];
  const ids = [];
  for (const d of defs) {
    try {
      const rec = await pb.collection("users").create({
        email: d.email,
        password: "Pass1234!",
        passwordConfirm: "Pass1234!",
        name: d.name,
        role: d.role,
        emailVisibility: true,
        verified: true,
      });
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
  const tagPool = ["laptop", "ssd", "monitor", "cable", "battery", "camera"];
  const ids = [];
  for (let i = 1; i <= 30; i++) {
    const isActive = i <= 25; // last 5 retired
    const tags = [pick(tagPool), pick(tagPool)].filter((v, idx, self) => self.indexOf(v) === idx);
    const rec = await pb.collection("kits").create({
      serial: `DEMO-KIT-${pad(i)}`,
      notes: `Demo kit ${pad(i)} — ${tags.join(", ")}`,
      is_active: isActive,
      tags: tags.join(","),
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} kits`);
  return ids;
}

async function seedTransactions(kitIds, entityIds, userIds) {
  console.log("→ Transactions...");
  const adminUserId = userIds[0]; // demo-admin-1 is first
  const ids = [];
  for (let i = 0; i < 50; i++) {
    const kitId = pick(kitIds);
    const toEntityId = pick(entityIds);
    const fromEntityId = pick(entityIds.filter((e) => e !== toEntityId));
    const daysBack = randInt(1, 90);
    const rec = await pb.collection("transactions").create({
      kit: kitId,
      from_entity: fromEntityId,
      to_entity: toEntityId,
      timestamp: daysAgo(daysBack),
      notes: `Demo transfer ${pad(i + 1)}`,
      created_by: adminUserId,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} transactions`);
  return ids;
}

async function seedRequests(kitIds, entityIds, userIds) {
  console.log("→ Requests...");
  // distribution: 5 open, 4 approved, 6 fulfilled, 3 rejected, 2 cancelled
  const statuses = [
    ...Array(5).fill("open"),
    ...Array(4).fill("approved"),
    ...Array(6).fill("fulfilled"),
    ...Array(3).fill("rejected"),
    ...Array(2).fill("cancelled"),
  ];
  // requester pool: admin + technicians + users (not viewer)
  const requesterPool = userIds.slice(0, 5);
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const status = statuses[i];
    const requesterId = pick(requesterPool);
    const deliveryDate = daysFromNow(randInt(3, 30));
    const rec = await pb.collection("requests").create({
      requester: requesterId,
      date: daysAgo(randInt(1, 60)),
      delivery_date: deliveryDate,
      status,
      designated_kit: status !== "open" ? pick(kitIds) : undefined,
      target_entity: pick(entityIds),
      notes: `Demo request ${pad(i + 1)} — ${status}`,
      decision_notes: ["approved", "rejected", "fulfilled", "cancelled"].includes(status)
        ? `Decision for demo request ${pad(i + 1)}`
        : undefined,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} requests`);
  return ids;
}

async function seedComponents(kitIds, entityIds) {
  console.log("→ Components...");
  const types = ["Card", "SSD", "Battery", "Cable", "Lens"];
  const ids = [];
  for (let i = 1; i <= 40; i++) {
    const isBulk = i > 30; // last 10 are bulk
    const inKit = !isBulk && i <= 20; // first 20 serialized go into kits
    const rec = await pb.collection("components").create({
      serial: isBulk ? "" : `DEMO-COMP-${pad(i)}`,
      type: pick(types),
      notes: `Demo component ${pad(i)}`,
      is_active: true,
      is_bulk: isBulk,
      quantity: isBulk ? randInt(2, 10) : 1,
    });
    ids.push({ id: rec.id, kitId: inKit ? pick(kitIds) : null, entityId: !inKit ? pick(entityIds) : null });
  }
  console.log(`   created ${ids.length} components`);
  return ids;
}

async function seedComponentTransactions(components, userIds) {
  console.log("→ Component transactions...");
  const adminUserId = userIds[0];
  const ids = [];
  // place first 20 components (initial placement)
  for (let i = 0; i < 20 && i < components.length; i++) {
    const comp = components[i];
    const rec = await pb.collection("component_transactions").create({
      component: comp.id,
      to_kit: comp.kitId || undefined,
      to_entity: comp.entityId || undefined,
      quantity: 1,
      timestamp: daysAgo(randInt(10, 90)),
      notes: `Initial placement DEMO-COMP-${pad(i + 1)}`,
      created_by: adminUserId,
    });
    ids.push(rec.id);
  }
  console.log(`   created ${ids.length} component transactions`);
  return ids;
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
      next_due: daysFromNow(randInt(1, 180)),
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
  const shifts = [
    {
      user: tech1Id,
      start: daysAgo(1),
      end: daysFromNow(1),
      notes: "DEMO current shift",
    },
    {
      user: tech2Id,
      start: daysAgo(10),
      end: daysAgo(7),
      notes: "DEMO past shift",
    },
    {
      user: adminId,
      start: daysFromNow(7),
      end: daysFromNow(14),
      notes: "DEMO future shift",
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
    console.log("DEMO- records already exist. Run teardown_demo_data.mjs first to re-seed.");
    process.exit(0);
  }

  const entityIds = await seedEntities();
  const userIds = await seedUsers();
  const kitIds = await seedKits();
  await seedTransactions(kitIds, entityIds, userIds);
  await seedRequests(kitIds, entityIds, userIds);
  const components = await seedComponents(kitIds, entityIds);
  await seedComponentTransactions(components, userIds);
  await seedMaintenanceSchedules(kitIds);
  await seedOnCallShifts(userIds);

  console.log("\nDone. Puppet show demo data seeded.");
  console.log(
    `  ${entityIds.length} entities | ${userIds.length} users | ${kitIds.length} kits`
  );
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
