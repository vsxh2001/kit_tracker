/**
 * Direct PocketBase API helpers for seeding and teardown.
 * All operations use the admin user token (logistics@kit.local).
 * No UI involved — these are strictly for test data management.
 */

// Honors PB_URL env var so agents in port-assigned worktrees can target their
// own PB instance. Defaults to :8090 when unset (matches main worktree + CI).
const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

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
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/entities/records/${id}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
  if (!res.ok && res.status !== 404) {
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
