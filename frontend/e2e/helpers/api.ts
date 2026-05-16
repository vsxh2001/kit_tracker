/**
 * Direct PocketBase API helpers for seeding and teardown.
 * All operations use the admin user token (logistics@kit.local).
 * No UI involved — these are strictly for test data management.
 */

// Honors PB_URL env var so agents in port-assigned worktrees can target their
// own PB instance. Defaults to :8090 when unset (matches main worktree + CI).
const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// Note: Admin token is cached per test suite execution to avoid repeated auth calls.
// For test isolation, individual tests should not rely on this cache persisting across
// test suites, but within a single suite run it's safe and efficient.
let _adminToken: string | null = null;
let _adminUserId: string | null = null;

export async function getAdminToken(): Promise<string> {
  if (_adminToken) return _adminToken;

  const res = await fetch(
    `${PB_URL}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "logistics@kit.local",
        password: "Pass1234!",
      }),
    }
  );
  if (!res.ok) throw new Error(`Admin auth failed: ${res.status}`);
  const data = await res.json();
  _adminToken = data.token;
  _adminUserId = data.record.id;
  return _adminToken!;
}

export async function getAdminUserId(): Promise<string> {
  await getAdminToken();
  return _adminUserId!;
}

const TEST_PASSWORDS: Record<string, string> = {
  "logistics@kit.local": "Pass1234!",
  "requester@kit.local": "Pass1234!",
  "viewer@kit.local": "Pass1234!",
};

export async function getUserIdByEmail(email: string): Promise<string> {
  const password = TEST_PASSWORDS[email];
  if (!password) throw new Error(`No password known for ${email}`);
  const res = await fetch(
    `${PB_URL}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    }
  );
  if (!res.ok) throw new Error(`User not found: ${email}`);
  const data = await res.json();
  return data.record.id;
}

// --- Kits ---

export async function createTestKit(
  serial: string,
  notes = ""
): Promise<{ id: string; serial: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/kits/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ serial, notes, is_active: true }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(
      `createTestKit failed: ${JSON.stringify(body)}`
    );
  }
  return res.json();
}

export async function deleteKit(id: string): Promise<void> {
  // PocketBase delete rule is null — only admins can delete via admin API
  // Use the admin panel API endpoint instead of the collection endpoint
  // (collection deleteRule is null, meaning nobody can delete via collection API)
  // We'll soft-delete by marking inactive instead
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/kits/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false, serial: `_deleted_${Date.now()}` }),
  });
}

export async function getKitBySerial(serial: string): Promise<{ id: string; serial: string; is_active: boolean } | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/kits/records?filter=serial="${serial}"`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items?.[0] ?? null;
}

// --- Entities ---

export async function createTestEntity(
  name: string,
  description = "",
  type = "storage"
): Promise<{ id: string; name: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/entities/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, type, is_active: true }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestEntity failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function deactivateEntity(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/entities/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
}

export async function getEntityByName(
  name: string
): Promise<{ id: string; name: string; is_active: boolean } | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/entities/records?filter=name="${name}"`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items?.[0] ?? null;
}

export async function deleteEntityRecord(id: string): Promise<void> {
  // Soft-delete via is_active=false (delete rule is null)
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/entities/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
  if (!res.ok) {
    throw new Error(`deleteEntityRecord failed: ${res.status}`);
  }
}

// --- Transactions ---

export async function createTestTransaction(data: {
  kitId: string;
  fromEntityId?: string;
  toEntityId: string;
  notes?: string;
}): Promise<{ id: string }> {
  const token = await getAdminToken();
  const userId = await getAdminUserId();
  const res = await fetch(`${PB_URL}/api/collections/transactions/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: data.kitId,
      from_entity: data.fromEntityId ?? null,
      to_entity: data.toEntityId,
      timestamp: new Date().toISOString(),
      notes: data.notes ?? null,
      created_by: userId,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestTransaction failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

// --- Requests ---

export async function createTestRequest(data: {
  requesterId: string;
  notes?: string;
  designatedKitId?: string;
  targetEntityId?: string;
  status?: string;
  deliveryDate?: string;
}): Promise<{ id: string; status: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/requests/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      requester: data.requesterId,
      date: new Date().toISOString().split("T")[0],
      delivery_date:
        data.deliveryDate ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
      status: data.status ?? "open",
      notes: data.notes ?? null,
      designated_kit: data.designatedKitId ?? null,
      target_entity: data.targetEntityId ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestRequest failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function updateRequestStatus(
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/requests/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...extra }),
  });
}

export async function getRequest(
  id: string
): Promise<{ id: string; status: string; designated_kit: string; target_entity: string; notes?: string; expected_return?: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/requests/records/${id}`, {
    headers: { Authorization: token },
  });
  return res.json();
}

export async function countTransactionsForKit(kitId: string): Promise<number> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/transactions/records?filter=kit="${kitId}"&perPage=1`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.totalItems ?? 0;
}

export async function getLatestTransactionForKit(
  kitId: string
): Promise<{ id: string; to_entity: string } | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/transactions/records?filter=kit="${kitId}"&sort=-timestamp,-created&perPage=1`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items?.[0] ?? null;
}

// --- Components ---

export interface ComponentRecord {
  id: string;
  serial: string;
  is_bulk: boolean;
  quantity: number;
  is_active: boolean;
  product: string;
}

export interface ComponentTxRecord {
  id: string;
  component: string;
  from_kit: string;
  from_entity: string;
  to_kit: string;
  to_entity: string;
  quantity: number;
}

/**
 * Creates a component record via admin REST.
 * Also creates an initial component_transaction placing it at `initialEntity`
 * (required by hook: every transaction needs exactly one from_ and one to_).
 * For the initial placement, we use a "virtual origin" — the same entity as
 * the destination with a zero-second-earlier timestamp — matching the seeding
 * approach where a component "comes from" an origin entity to its initial home.
 *
 * If only `initialKit` is provided (no initialEntity), the initial transaction
 * places it from the same entity the kit currently lives in into the kit.
 * Caller must have already moved the kit to an entity before calling this.
 *
 * `productId` is now required (components must have a product).
 * If not provided, a temporary test product is auto-created and used.
 */
export async function createTestComponent(opts: {
  serial?: string;
  type?: string;
  isBulk?: boolean;
  quantity?: number;
  /** Product id to link. If omitted, a test product is auto-created. */
  productId?: string;
  /** Place at this entity (standalone). Creates entity→entity initial tx. */
  initialEntity?: string;
  /** Place into this kit. If provided, creates entity→kit initial tx (needs fromEntity). */
  initialKit?: string;
  /** Required when initialKit is provided — the from_entity for the initial tx. */
  fromEntity?: string;
}): Promise<ComponentRecord> {
  const token = await getAdminToken();
  const userId = await getAdminUserId();

  const isBulk = opts.isBulk ?? false;
  const qty = opts.quantity ?? 1;
  const type = opts.type ?? "TestComponent";
  const serial = opts.serial ?? (isBulk ? "" : `SN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  // Resolve product id — auto-create a test product if not provided
  let productId = opts.productId;
  if (!productId) {
    const prodRes = await fetch(`${PB_URL}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Test Product: ${type}`,
        category: type,
        is_active: true,
      }),
    });
    if (!prodRes.ok) {
      const body = await prodRes.json();
      throw new Error(`createTestComponent: auto-create product failed: ${JSON.stringify(body)}`);
    }
    const prod = await prodRes.json();
    productId = prod.id;
  }

  const compRes = await fetch(`${PB_URL}/api/collections/components/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      serial,
      notes: "",
      is_active: true,
      is_bulk: isBulk,
      quantity: qty,
      product: productId,
    }),
  });
  if (!compRes.ok) {
    const body = await compRes.json();
    throw new Error(`createTestComponent failed: ${JSON.stringify(body)}`);
  }
  const comp: ComponentRecord = await compRes.json();

  // Create initial placement transaction
  if (opts.initialEntity || opts.initialKit) {
    const txBody: Record<string, unknown> = {
      component: comp.id,
      quantity: qty,
      timestamp: new Date().toISOString(),
      notes: "initial placement",
      created_by: userId,
    };

    if (opts.initialKit) {
      if (!opts.fromEntity) {
        throw new Error("createTestComponent: fromEntity required when initialKit is provided");
      }
      txBody.from_entity = opts.fromEntity;
      txBody.to_kit = opts.initialKit;
    } else if (opts.initialEntity) {
      // Create a throwaway origin entity to satisfy the from_ XOR constraint
      const originRes = await fetch(`${PB_URL}/api/collections/entities/records`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `__origin_${Date.now()}`, type: "storage", is_active: false }),
      });
      const origin = await originRes.json();
      txBody.from_entity = origin.id;
      txBody.to_entity = opts.initialEntity;
    }

    const txRes = await fetch(`${PB_URL}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(txBody),
    });
    if (!txRes.ok) {
      const body = await txRes.json();
      throw new Error(`createTestComponent initial tx failed: ${JSON.stringify(body)}`);
    }
  }

  return comp;
}

export async function getLatestComponentTransaction(
  componentId: string
): Promise<ComponentTxRecord | null> {
  const token = await getAdminToken();
  const encoded = encodeURIComponent(`component="${componentId}"`);
  const res = await fetch(
    `${PB_URL}/api/collections/component_transactions/records?filter=${encoded}&sort=-timestamp,-created&perPage=1`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items?.[0] ?? null;
}

export async function createTestComponentTransaction(data: {
  componentId: string;
  fromKit?: string;
  fromEntity?: string;
  toKit?: string;
  toEntity?: string;
  quantity?: number;
  notes?: string;
}): Promise<ComponentTxRecord> {
  const token = await getAdminToken();
  const userId = await getAdminUserId();
  const res = await fetch(`${PB_URL}/api/collections/component_transactions/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      component: data.componentId,
      from_kit: data.fromKit ?? "",
      from_entity: data.fromEntity ?? "",
      to_kit: data.toKit ?? "",
      to_entity: data.toEntity ?? "",
      quantity: data.quantity ?? 1,
      timestamp: new Date().toISOString(),
      notes: data.notes ?? "",
      created_by: userId,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestComponentTransaction failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function getComponentById(
  componentId: string
): Promise<ComponentRecord | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/components/records/${componentId}`,
    { headers: { Authorization: token } }
  );
  if (!res.ok) return null;
  return res.json();
}

export async function listComponentTransactionsForComponent(
  componentId: string
): Promise<ComponentTxRecord[]> {
  const token = await getAdminToken();
  const encoded = encodeURIComponent(`component="${componentId}"`);
  const res = await fetch(
    `${PB_URL}/api/collections/component_transactions/records?filter=${encoded}&sort=-timestamp,-created&perPage=50`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items ?? [];
}

export async function deactivateComponent(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/components/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
}

// --- On-call shifts ---

export async function createOnCallShift(data: {
  userId: string;
  startAt: string;
  endAt: string;
  notes?: string;
}): Promise<{ id: string }> {
  const token = await getAdminToken();
  const adminId = await getAdminUserId();
  const res = await fetch(`${PB_URL}/api/collections/on_call_shifts/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      user: data.userId,
      start_at: data.startAt,
      end_at: data.endAt,
      notes: data.notes ?? "",
      created_by: adminId,
      is_active: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createOnCallShift failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function deleteOnCallShift(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/on_call_shifts/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
}

export async function getUserTokenByEmail(email: string, password: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed for ${email}: ${res.status}`);
  const data = await res.json();
  return { token: data.token, userId: data.record.id };
}

// --- Users (deny / profile) ---

export async function createTestUser(
  email: string,
  role: "" | "admin" | "user" | "viewer" | "technician" = ""
): Promise<{ id: string; email: string; role: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Pass1234!",
      passwordConfirm: "Pass1234!",
      role,
      emailVisibility: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestUser failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function deleteTestUser(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

export async function getUserById(id: string): Promise<{ id: string; email: string; role: string; denial_notes?: string; phone?: string; title?: string } | null> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function patchUser(id: string, data: Record<string, unknown>): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`patchUser failed: ${JSON.stringify(body)}`);
  }
}

// --- Products ---

export interface ProductRecord {
  id: string;
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  description?: string;
  specs?: string;
  is_active: boolean;
}

export async function createTestProduct(data: {
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  description?: string;
  specs?: string;
}): Promise<ProductRecord> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/products/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, is_active: true }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestProduct failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

export async function deleteTestProduct(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/products/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
}

export async function listProductsApi(): Promise<ProductRecord[]> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/products/records?sort=name&perPage=200`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  return data.items ?? [];
}

export async function linkComponentToProduct(componentId: string, productId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/components/records/${componentId}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ product: productId }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`linkComponentToProduct failed: ${JSON.stringify(body)}`);
  }
}
