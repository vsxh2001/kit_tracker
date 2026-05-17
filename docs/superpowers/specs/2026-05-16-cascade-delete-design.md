# Admin Cascade Hard-Delete

Status: **APPROVED — ready for implementation**
Date: 2026-05-16
Owner: hadassi
Context: New feature added mid Pilot-Ready Sprint per user request.

---

## 1. Goal

Admin can hard-delete a kit, entity, component, or transaction with full cascade. This is a **last-resort tool to fix history** — e.g. a tech accidentally created 10 kits with a typo'd serial and only realised after generating dozens of transactions. The audit trail survives the delete by recording a snapshot row *before* the cascade fires.

Hard delete is irreversible. The UI must force the admin to type the record's identifier to confirm.

## 2. Scope

### In scope

- Cascade delete a **kit** + all rows that FK it: transactions, components (and their component_transactions), maintenance schedules + records.
- Cascade delete an **entity** *only if no transactions / requests / users reference it*. If references exist, refuse with a blockers list. Admin must fix data first.
- Cascade delete a **component** + all component_transactions that FK it.
- Single-row hard-delete a **transaction** from the kit timeline (transactions are leaf rows).
- Audit trail: every cascade writes an `audit_log` row with action=`"cascade_delete"` containing a full snapshot of the deleted record + cascade counts, written *before* the rows are removed.
- UI: Danger Zone section on kit / entity / component detail pages (admin-only). Per-row delete button on each transaction in kit timeline (admin-only).
- Confirm UX: modal with cascade preview + type-to-confirm input.

### Out of scope

- Two-admin approval (one admin is enough for v1).
- Undo or soft-revert of cascade (true hard delete; only the audit row remains).
- Bulk cascade (one record per click).
- File system cleanup beyond what PB's `deleteRecord` already handles.
- Cascading deletes triggered from any collection beyond kit / entity / component / transaction.
- Cascade from product (products are not in user's listed scope; deferred).
- Soft-undo: the audit row records the snapshot, but there is no API to recreate the deleted records.

## 3. Confirm UX

Modal opens on Danger Zone button click. Sections:

1. **Title:** "Hard delete &lt;type&gt; '&lt;identifier&gt;' with cascade?"
2. **Warning banner:** "This cannot be undone. The record + all dependent rows will be permanently removed. An audit log row will be written first."
3. **Preview block:** counts of rows to be deleted per collection. Loaded via the preview endpoint on dialog open. For blocked entities, shows the blockers instead with sample IDs.
4. **Type-to-confirm input:** "Type the &lt;identifier_field&gt; '`&lt;identifier_value&gt;`' to enable the Delete button." Button stays disabled until input value matches exactly.
5. **Delete button:** destructive variant. On click: POSTs to the cascade endpoint. On 200 → toast "Deleted" + redirect to list page (or refresh kit detail for tx delete). On 4xx → toast with error.

Identifier rules:
- kit → `record.serial`
- entity → `record.name`
- component (serialized) → `record.serial`; (bulk) → `record.id`
- transaction → `record.id` (transactions have no human name; admin must copy the id from the timeline row)

## 4. Backend

### 4.1 Endpoints

**`POST /api/admin/cascade-delete/preview`** (or `GET` with query params; choose `POST` for consistency with the action endpoint)

Request:
```json
{ "collection": "kits|entities|components|transactions", "record_id": "<id>" }
```

Response:
```json
{
  "collection": "kits",
  "record_id": "abc123",
  "identifier_field": "serial",
  "identifier_value": "DEMO-KIT-005",
  "blocked": false,
  "blockers": [],
  "counts": { "kits": 1, "transactions": 47, "components": 3, "kit_maintenance_schedules": 2 }
}
```

For a blocked entity:
```json
{
  "collection": "entities",
  "record_id": "ent123",
  "identifier_field": "name",
  "identifier_value": "DEMO-Warehouse",
  "blocked": true,
  "blockers": [
    { "collection": "transactions", "count": 5, "sample_ids": ["t1","t2","t3"] },
    { "collection": "users", "count": 2 }
  ],
  "counts": {}
}
```

**`POST /api/admin/cascade-delete`**

Request:
```json
{ "collection": "kits", "record_id": "abc123", "confirm_text": "DEMO-KIT-005" }
```

Response:
- 200: `{ "deleted": { "kits": 1, "transactions": 47, "components": 3, "kit_maintenance_schedules": 2 } }`
- 400 `{ "error": "blocked", "blockers": [...] }` — entity with references; client should re-fetch preview.
- 400 `{ "error": "confirm_mismatch", "expected": "DEMO-KIT-005" }` — confirm_text didn't match.
- 400 `{ "error": "invalid_collection" }` — collection not in whitelist.
- 400 `{ "error": "not_found" }` — record doesn't exist.
- 403 `{ "error": "forbidden" }` — caller is not admin.

### 4.2 Cascade rules

| Target collection | Pre-checks | Cascade order (must succeed in order) |
|---|---|---|
| `kits` | none | (a) `component_transactions` WHERE component IN (components WHERE kit=X); (b) `components` WHERE kit=X; (c) `kit_maintenance_records` WHERE schedule IN (schedules WHERE kit=X); (d) `kit_maintenance_schedules` WHERE kit=X; (e) `transactions` WHERE kit=X; (f) `kits/X` |
| `entities` | refuse if any: `transactions` WHERE from_entity=X OR to_entity=X; `requests` WHERE target_entity=X; `users` WHERE entity=X | (a) `entities/X` only — no cascade beyond the row itself once unblocked |
| `components` | none | (a) `component_transactions` WHERE component=X; (b) `components/X` |
| `transactions` | none | (a) `transactions/X` only |

### 4.3 Audit row written BEFORE delete

For every cascade-delete call (success or blocked check, but ONLY write on actual delete path), write a single audit_log row before any DAO `deleteRecord`:

```json
{
  "collection_name": "audit_log",
  "record": {
    "collection_name": "<target>",
    "record_id": "<id>",
    "actor": "<admin user id>",
    "action": "cascade_delete",
    "changes": "{\"before\": {<full snapshot>}, \"cascade\": {<preview counts>}, \"via\": \"web\"}"
  }
}
```

Cascade counts in the audit row are the *predicted* counts before the cascade fires. If a row gets created in the same tick by another caller, the actual deletion may differ; flag in the audit row's `cascade.predicted_at` ts.

### 4.4 Hook file

New file: `pb/pb_hooks/cascade_delete.pb.js`

- Two `routerAdd` calls: `/api/admin/cascade-delete/preview` (POST) and `/api/admin/cascade-delete` (POST).
- Both check `info.authRecord.get("role") === "admin"` first; return 403 otherwise.
- Whitelist `collection ∈ {kits, entities, components, transactions}` to prevent admins from cascading other tables.
- Use `$app.dao().runInTransaction(fn)` so the cascade is atomic. If any inner delete fails, the whole thing rolls back AND the audit row also rolls back. (Confirm PB v0.22 supports runInTransaction in Goja — fallback: do best-effort with error logging if not.)

Note: PB collection `deleteRule` stays `null` (no one can delete via the public REST API). The cascade endpoint bypasses that by using `$app.dao()` directly.

### 4.5 PocketBase rule changes

None.

## 5. Frontend

### 5.1 Service

New file: `frontend/src/services/admin.ts`

```typescript
export type CascadeCollection = "kits" | "entities" | "components" | "transactions";

export interface CascadePreview {
  collection: CascadeCollection;
  record_id: string;
  identifier_field: string;
  identifier_value: string;
  blocked: boolean;
  blockers: { collection: string; count: number; sample_ids?: string[] }[];
  counts: Record<string, number>;
}

export async function getCascadePreview(
  collection: CascadeCollection,
  recordId: string,
): Promise<CascadePreview>;

export async function cascadeDelete(
  collection: CascadeCollection,
  recordId: string,
  confirmText: string,
): Promise<{ deleted: Record<string, number> }>;
```

### 5.2 Component

New file: `frontend/src/components/CascadeDeleteDialog.tsx`

Props:
```typescript
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CascadeCollection;
  recordId: string;
  onDeleted?: () => void;   // optional callback after successful delete
}
```

State:
- `preview: CascadePreview | null`
- `confirmInput: string`
- `submitting: boolean`
- `error: string | null`

Loads preview on first open via `useEffect`. Button enabled only when `confirmInput === preview.identifier_value`. On submit calls `cascadeDelete` then either calls `onDeleted` or `useNavigate()`'s redirect.

### 5.3 Detail page integrations

- `KitDetailPage`: add a "Danger Zone" Card at the bottom (admin only). Inside: a destructive button "Cascade Hard Delete" that opens the dialog with `collection="kits"`. On `onDeleted`, navigate to `/kits`.
- `EntityDetailPage`: same pattern with `collection="entities"`. On `onDeleted`, navigate to `/entities`.
- `ComponentDetailPage`: same with `collection="components"`. On `onDeleted`, navigate to `/components`.
- `KitTimeline.tsx` (or wherever tx rows render inside KitDetailPage): per-row admin-only trash icon → opens `CascadeDeleteDialog` with `collection="transactions"`. On `onDeleted`, refresh the timeline.

### 5.4 Permission gating

The Danger Zone card / trash icon should only render when `useAuth().isAdmin === true`. Server-side rejection is the real gate; the UI gate is purely UX.

## 6. Testing

### 6.1 PB hook curl tests

A shell script `scripts/cascade_delete_test.sh` exercising:

1. Non-admin call → 403
2. Invalid collection → 400 `invalid_collection`
3. Missing confirm_text → 400 `confirm_mismatch`
4. Kit cascade success → counts match preview
5. Entity with active transactions → 400 `blocked`
6. Empty entity (no refs) → 200 success
7. Component cascade with component_transactions → counts match
8. Single transaction delete → 200 success, count=1

### 6.2 E2E

`frontend/e2e/cascade-delete.spec.ts`:

1. Admin sees Danger Zone on kit detail; viewer does not.
2. Admin opens cascade dialog → preview loads → type wrong serial → button disabled.
3. Admin types correct serial → button enables → clicks → toast → redirected to /kits.
4. Admin tries cascade-delete on entity with active tx → preview shows blockers → Delete button disabled.
5. Admin clicks trash on a tx row → dialog opens with `collection="transactions"` → confirm by id → tx gone from timeline.

## 7. Migration / data impact

Zero. No schema changes. The audit_log collection already has `action` as text. New action values (`cascade_delete`) are accepted.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Admin nukes prod data | Type-to-confirm + preview + audit row before delete |
| Transactional rollback fails partway (PB Goja doesn't fully support nested tx) | Test runInTransaction; if it fails partway, log the partial state in audit row and proceed |
| Concurrent writes during cascade race | Audit row's `cascade.predicted_at` flags the snapshot time; admin can compare against final counts |
| File cleanup not happening for kit attachments | PB's `deleteRecord` cleans linked files; verify in curl test |
| Admin uses this to defeat audit trail | Audit row WITH snapshot survives — defeats the use case |

## 9. Implementation plan

Four tasks, ordered. T23 must complete before T24/T25/T26.

- **T23** — Backend endpoint + hook + curl tests + audit logging
- **T24** — Frontend service + CascadeDeleteDialog component (no integration yet)
- **T25** — Wire dialog into KitDetail, EntityDetail, ComponentDetail, KitTimeline tx rows
- **T26** — E2E test spec covering happy paths + blocked + non-admin gate

T24 + T25 can run in parallel after T23 lands (different files mostly — services + new component vs page integrations).
