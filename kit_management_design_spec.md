# Kit Management Web App — Product Design & Specification

## 1. Product Goal

Build a simple internal web app for tracking **equipment kits**, who currently holds them, and their full movement history.

The system should answer:

- Where is each kit right now?
- Who had this kit before?
- When did a kit move from one entity to another?
- What requests are open?
- Which kit was assigned to which request?
- What notes were attached to a kit or transfer?

The intended scale is small:

- About **24 kits**
- About **12 users**
- Internal team usage
- Simple permissions
- Strong history/audit tracking

Recommended stack:

- **Frontend:** Vite + React + TypeScript
- **Backend/database/auth:** PocketBase
- **Deployment:** single small VM, Docker container, or local internal server

---

## 2. Core Concepts

### Kit

A physical bundle of equipment.

A kit has:

- Serial number
- Notes
- Current holder/location, derived from the latest transaction
- Full transaction history

Example:

```text
Kit SN-001
Current entity: Lab
Notes: Missing one USB-C cable
```

### Entity

An entity is anyone or anything that can hold a kit.

Examples:

- Logistics
- Lab
- Team A
- External Customer X
- Storage Room
- Maintenance
- User: Daniel

Entity should be generic. Do not hard-code “person”, “team”, or “location” as separate models unless you really need to later.

### Transaction

A movement record showing that a kit moved from one entity to another.

Example:

```text
Kit SN-001 moved from Logistics to Team A
Timestamp: 2026-05-08 14:32
Notes: Delivered for field test
```

Transactions are the **source of truth** for kit history.

### Request

A request is a demand for a kit.

Example:

```text
User: Team A
Date: 2026-05-08
Status: Approved
Designated kit: SN-001
Notes: Needed for experiment next week
```

A request may optionally point to a specific kit.

---

## 3. Product Scope

### MVP Features

The first version should support:

1. Create/edit kits
2. Create/edit entities
3. Create transactions between entities
4. View current kit location
5. View full history per kit
6. Create and manage kit requests
7. Assign a kit to a request
8. Basic login
9. Basic role separation:
   - Admin / logistics user
   - Regular requester
   - Read-only viewer, optional

---

## 4. Recommended Roles

Keep permissions simple.

### Admin / Logistics

Can:

- Create kits
- Edit kits
- Create entities
- Edit entities
- Move kits between entities
- Approve/reject requests
- Assign kits to requests
- View all history

### Regular User

Can:

- View available kits
- Create requests
- View their own requests
- Maybe view kit history, depending on internal policy

### Viewer

Optional.

Can:

- View kits
- View entities
- View transactions
- Cannot change data

For a small team, you can even start with only:

```text
admin
user
```

---

## 5. Data Model

PocketBase collections should probably be:

1. `kits`
2. `entities`
3. `transactions`
4. `requests`
5. `users`

PocketBase already has a built-in `users` collection, so use that for authentication.

---

## 6. PocketBase Collection Design

### `kits`

Represents each physical kit.

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `serial` | text | yes | Unique kit serial |
| `notes` | text | no | Free text |
| `is_active` | bool | yes | Useful for retired/deleted kits |
| `created` | auto | yes | PocketBase built-in |
| `updated` | auto | yes | PocketBase built-in |

Recommended indexes:

```text
serial unique
is_active
```

Example:

```json
{
  "serial": "KIT-001",
  "notes": "Main RF field kit",
  "is_active": true
}
```

### `entities`

Represents anything that can hold a kit.

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `name` | text | yes | Entity name |
| `description` | text | no | Description |
| `type` | select | yes | Suggested: `person`, `team`, `lab`, `storage`, `customer`, `maintenance`, `other` |
| `is_active` | bool | yes | Allows hiding old entities |
| `created` | auto | yes | PocketBase built-in |
| `updated` | auto | yes | PocketBase built-in |

Your original schema only had name and description. I would add `type` because it makes filtering much easier later.

Example:

```json
{
  "name": "Logistics",
  "description": "Main logistics storage",
  "type": "storage",
  "is_active": true
}
```

### `transactions`

Represents movement of a kit.

I would use PocketBase relations instead of storing `kit serial` as plain text.

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `kit` | relation → `kits` | yes | The moved kit |
| `from_entity` | relation → `entities` | no | Nullable for initial creation |
| `to_entity` | relation → `entities` | yes | New holder |
| `timestamp` | date | yes | Time of movement |
| `notes` | text | no | Free text |
| `created_by` | relation → `users` | yes | Who recorded it |
| `request` | relation → `requests` | no | Optional link to request |

Your original fields:

```text
kit serial
current entity
next entity
timestamp
notes
```

Recommended naming:

```text
kit
from_entity
to_entity
timestamp
notes
```

This makes the meaning clearer.

Example:

```json
{
  "kit": "KIT_RECORD_ID",
  "from_entity": "LOGISTICS_ENTITY_ID",
  "to_entity": "TEAM_A_ENTITY_ID",
  "timestamp": "2026-05-08 14:32:00",
  "notes": "Delivered for test",
  "created_by": "USER_ID",
  "request": "REQUEST_ID"
}
```

### `requests`

Represents a demand for a kit.

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `requester` | relation → `users` or `entities` | yes | Who requested |
| `date` | date | yes | Request date |
| `status` | select | yes | See statuses below |
| `designated_kit` | relation → `kits` | no | Optional |
| `target_entity` | relation → `entities` | no | Where kit should go |
| `notes` | text | no | Request details |
| `decision_notes` | text | no | Approval/rejection notes |
| `created` | auto | yes | PocketBase built-in |
| `updated` | auto | yes | PocketBase built-in |

Recommended request statuses:

```text
draft
submitted
approved
rejected
fulfilled
cancelled
```

Simpler MVP statuses:

```text
open
approved
rejected
fulfilled
cancelled
```

Example:

```json
{
  "requester": "USER_ID",
  "date": "2026-05-08",
  "status": "approved",
  "designated_kit": "KIT_RECORD_ID",
  "target_entity": "TEAM_A_ENTITY_ID",
  "notes": "Need kit for lab test next week"
}
```

---

## 7. Important Derived State

### Current Kit Holder

Do **not** store current holder directly on the kit in the MVP unless you need performance.

Instead, derive it from the latest transaction:

```text
current holder = latest transaction.to_entity for this kit
```

For 24 kits, this is easy and fast.

Later, you may cache it on the kit:

```text
kits.current_entity
```

But if you do, you must make sure every transaction updates it atomically.

For PocketBase, I recommend this MVP approach:

```text
Use latest transaction as source of truth.
```

Then in the frontend, when listing kits, fetch:

```ts
transactions?filter=(kit='KIT_ID')&sort=-timestamp&perPage=1&expand=to_entity
```

---

## 8. Main Workflows

### Workflow 1 — Create a Kit

Actor: Admin / Logistics

Steps:

1. User opens “Kits”
2. Clicks “New Kit”
3. Enters serial and notes
4. Saves
5. Optional: creates initial transaction from empty source to `Logistics` or `Storage`

Important rule:

A kit without a transaction has no known current location.

Recommended behavior:

After kit creation, force the user to choose initial entity.

### Workflow 2 — Move Kit

Actor: Admin / Logistics

Steps:

1. User opens kit detail page
2. Clicks “Move kit”
3. System shows current holder
4. User selects next entity
5. User adds notes
6. System creates transaction

Example:

```text
KIT-001
From: Logistics
To: Lab
Notes: Sent for inspection
```

Validation:

- `kit` is required
- `to_entity` is required
- `from_entity` should equal current holder unless admin overrides
- `timestamp` defaults to now
- `from_entity` and `to_entity` should not be the same, unless you want to allow “status note” transactions

### Workflow 3 — Request Kit

Actor: Regular user

Steps:

1. User opens “Requests”
2. Clicks “New request”
3. Enters request notes
4. Optional: chooses a designated kit
5. Optional: chooses target entity
6. Submits request

Initial status:

```text
open
```

or

```text
submitted
```

### Workflow 4 — Approve Request

Actor: Admin / Logistics

Steps:

1. Admin opens request queue
2. Reviews request
3. Assigns a kit if none was designated
4. Sets status to `approved`
5. Optionally creates a transaction to move the kit

Possible behavior:

When admin approves a request, do **not** automatically move the kit. Approval and physical delivery are different.

Recommended flow:

```text
open → approved → fulfilled
```

The kit movement happens when status changes to `fulfilled`.

### Workflow 5 — Fulfill Request

Actor: Admin / Logistics

Steps:

1. Admin opens approved request
2. Clicks “Fulfill”
3. System creates transaction:
   - kit: designated kit
   - from_entity: current holder
   - to_entity: request target entity
   - request: current request
4. Request status becomes `fulfilled`

This keeps request and transaction connected.

### Workflow 6 — Return Kit

You do not necessarily need a separate return model.

A return is just another transaction.

Example:

```text
KIT-001 moved from Team A to Logistics
Notes: Returned after field use
```

### Workflow 7 — Maintenance

You can also model maintenance as an entity.

Example entities:

```text
Maintenance
Lab Checkup
Broken / Quarantine
Storage
```

Then moving a kit to maintenance is just:

```text
KIT-001: Team A → Maintenance
```

No separate maintenance table is needed in the MVP.

---

## 9. UI Specification

### Main Navigation

Suggested sidebar:

```text
Dashboard
Kits
Requests
Entities
Transactions
Admin
```

For MVP:

```text
Dashboard
Kits
Requests
Entities
```

### Dashboard

Purpose: quick operational overview.

Widgets:

1. Total kits
2. Kits by current entity
3. Open requests
4. Approved but unfulfilled requests
5. Recent transactions

Example dashboard:

```text
Total kits: 24
Open requests: 3
Approved requests: 1
Kits in Logistics: 12
Kits in Lab: 4
Kits with Teams: 8
```

### Kits Page

Table columns:

| Column | Description |
|---|---|
| Serial | Kit serial |
| Current entity | Latest transaction destination |
| Last moved | Latest transaction timestamp |
| Notes | Short preview |
| Actions | View / Move / Edit |

Filters:

- Search by serial
- Filter by current entity
- Show inactive kits toggle

Actions:

- New kit
- View kit
- Move kit

### Kit Detail Page

Sections:

#### Header

```text
KIT-001
Current holder: Lab
Last moved: 2026-05-08 14:32
```

#### Details

```text
Serial
Notes
Active/inactive
```

#### Actions

```text
Move kit
Edit kit
Retire kit
```

#### Transaction History

| Time | From | To | Notes | Created by |
|---|---|---|---|---|
| 2026-05-08 14:32 | Logistics | Lab | Delivered | Alice |
| 2026-05-01 09:10 | Lab | Logistics | Returned | Bob |

### Move Kit Modal

Fields:

```text
Kit: KIT-001
Current entity: Logistics
Next entity: [select]
Timestamp: [default now]
Notes: [textarea]
```

Buttons:

```text
Cancel
Move kit
```

Validation:

- Next entity required
- Notes optional
- Timestamp required

### Entities Page

Table columns:

| Column | Description |
|---|---|
| Name | Entity name |
| Type | person/team/lab/storage/customer/etc. |
| Description | Short description |
| Active | Yes/no |
| Actions | View/Edit |

Actions:

- New entity
- Edit entity
- Deactivate entity

### Entity Detail Page

Shows:

- Entity name
- Description
- Type
- Kits currently held by this entity
- Transactions involving this entity

Useful for answering:

```text
What does Team A currently hold?
```

### Requests Page

Table columns:

| Column | Description |
|---|---|
| Date | Request date |
| Requester | User/entity who requested |
| Status | open/approved/rejected/fulfilled |
| Designated kit | Optional kit |
| Target entity | Where kit should go |
| Notes | Short preview |
| Actions | View/Approve/Fulfill |

Filters:

- Status
- Requester
- Designated kit
- Date range

### Request Detail Page

Sections:

#### Request Info

```text
Requester
Date
Status
Designated kit
Target entity
Notes
Decision notes
```

#### Actions

Depending on status:

```text
Approve
Reject
Assign kit
Fulfill
Cancel
```

#### Linked Transaction

Once fulfilled, show the transaction that fulfilled the request.

---

## 10. Frontend Routes

Suggested React Router structure:

```text
/login

/
  /dashboard

/kits
/kits/new
/kits/:id
/kits/:id/edit
/kits/:id/move

/entities
/entities/new
/entities/:id
/entities/:id/edit

/requests
/requests/new
/requests/:id
/requests/:id/edit

/transactions
/transactions/:id
```

For MVP, I would avoid too many separate pages and use modals for creation/editing.

Simpler MVP routes:

```text
/login
/dashboard
/kits
/kits/:id
/entities
/requests
/requests/:id
```

---

## 11. Backend Rules

### Important Business Rules

#### Kit serials must be unique

No two active kits should have the same serial.

#### Transactions should be append-only

Do not edit or delete transactions casually.

A transaction is an audit record.

Recommended policy:

- Admin can create transactions
- Editing transactions should be disabled or restricted
- If a mistake happens, create a correction transaction or allow admin-only edit with caution

#### Current holder is latest transaction

For each kit:

```text
latest transaction by timestamp determines current holder
```

If two transactions have the exact same timestamp, use `created` as tie-breaker.

#### Request fulfillment creates transaction

When a request is fulfilled:

- There must be a designated kit
- There must be a target entity
- A transaction should be created
- Request status should become `fulfilled`

---

## 12. PocketBase Access Rules

PocketBase rules are JavaScript-like expressions.

A simple version:

### `kits`

```text
List/View:
@request.auth.id != ""

Create/Update:
@request.auth.role = "admin"
```

PocketBase’s default user model does not include `role`, so add a `role` field to the `users` collection.

Suggested user field:

```text
role: select(admin, user, viewer)
```

### `entities`

```text
List/View:
@request.auth.id != ""

Create/Update:
@request.auth.role = "admin"
```

### `transactions`

```text
List/View:
@request.auth.id != ""

Create:
@request.auth.role = "admin"

Update/Delete:
@request.auth.role = "admin"
```

For stronger audit behavior:

```text
Update/Delete:
false
```

That is safer.

### `requests`

Regular users can create requests.

```text
List/View:
@request.auth.id != ""
```

For stricter privacy:

```text
@request.auth.role = "admin" || requester = @request.auth.id
```

Create:

```text
@request.auth.id != ""
```

Update:

```text
@request.auth.role = "admin" || requester = @request.auth.id
```

But regular users should probably not be allowed to approve their own requests. So in practice, handle status changes carefully.

Simpler MVP:

- User can create request
- Admin can edit status
- User can cancel own request

---

## 13. Recommended User Permissions

| Action | Admin | User | Viewer |
|---|---:|---:|---:|
| View kits | yes | yes | yes |
| Create kit | yes | no | no |
| Edit kit | yes | no | no |
| Move kit | yes | no | no |
| View transactions | yes | yes | yes |
| Create request | yes | yes | no |
| Approve request | yes | no | no |
| Fulfill request | yes | no | no |
| Manage entities | yes | no | no |

---

## 14. API/Data Access Layer

In the React app, create a clean service layer.

Example folder:

```text
src/
  lib/
    pocketbase.ts
  services/
    kits.ts
    entities.ts
    transactions.ts
    requests.ts
  pages/
  components/
  types/
```

### TypeScript Types

```ts
export type EntityType =
  | "person"
  | "team"
  | "lab"
  | "storage"
  | "customer"
  | "maintenance"
  | "other";

export type RequestStatus =
  | "open"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type UserRole = "admin" | "user" | "viewer";

export interface Kit {
  id: string;
  serial: string;
  notes?: string;
  is_active: boolean;
  created: string;
  updated: string;
}

export interface Entity {
  id: string;
  name: string;
  description?: string;
  type: EntityType;
  is_active: boolean;
  created: string;
  updated: string;
}

export interface Transaction {
  id: string;
  kit: string;
  from_entity?: string;
  to_entity: string;
  timestamp: string;
  notes?: string;
  created_by: string;
  request?: string;
  created: string;
  updated: string;
}

export interface KitRequest {
  id: string;
  requester: string;
  date: string;
  status: RequestStatus;
  designated_kit?: string;
  target_entity?: string;
  notes?: string;
  decision_notes?: string;
  created: string;
  updated: string;
}
```

---

## 15. Key Frontend Functions

### Get all kits

```ts
async function listKits() {
  return pb.collection("kits").getFullList({
    sort: "serial",
    filter: "is_active = true",
  });
}
```

### Get latest transaction for a kit

```ts
async function getLatestKitTransaction(kitId: string) {
  const result = await pb.collection("transactions").getList(1, 1, {
    filter: `kit = "${kitId}"`,
    sort: "-timestamp,-created",
    expand: "from_entity,to_entity,created_by",
  });

  return result.items[0] ?? null;
}
```

### Move kit

```ts
async function moveKit(params: {
  kitId: string;
  fromEntityId?: string;
  toEntityId: string;
  notes?: string;
  requestId?: string;
}) {
  return pb.collection("transactions").create({
    kit: params.kitId,
    from_entity: params.fromEntityId,
    to_entity: params.toEntityId,
    timestamp: new Date().toISOString(),
    notes: params.notes,
    request: params.requestId,
  });
}
```

You can set `created_by` automatically in frontend from the logged-in user, or better, enforce it server-side using PocketBase hooks later.

---

## 16. MVP Implementation Plan

### Phase 1 — Foundation

Build:

- Vite React TypeScript app
- PocketBase setup
- Login/logout
- Collections:
  - kits
  - entities
  - transactions
  - requests
- Basic admin user

Deliverable:

```text
User can log in and see an empty dashboard.
```

### Phase 2 — Kits and Entities

Build:

- Kits table
- Create kit
- Edit kit
- Entities table
- Create entity
- Edit entity

Deliverable:

```text
Admin can create kits and entities.
```

### Phase 3 — Transactions

Build:

- Move kit modal
- Transaction creation
- Current holder calculation
- Kit detail page with history

Deliverable:

```text
Admin can move kits and view full kit history.
```

### Phase 4 — Requests

Build:

- Request creation
- Request list
- Request detail
- Approve/reject
- Assign kit
- Fulfill request and create transaction

Deliverable:

```text
Users can request kits. Admin can approve and fulfill them.
```

### Phase 5 — Dashboard and Polish

Build:

- Summary cards
- Recent transactions
- Open request count
- Filters/search
- Better validation
- Error handling

Deliverable:

```text
The app is useful for day-to-day operation.
```

---

## 17. Suggested UI Components

Use a simple component library to move fast.

Good options:

- Tailwind CSS + shadcn/ui
- Mantine
- MUI
- Radix UI + custom CSS

For an internal logistics tool, I would choose:

```text
Vite + React + TypeScript + Tailwind + shadcn/ui + PocketBase
```

Useful components:

- Table
- Dialog/modal
- Select
- Badge
- Textarea
- Date picker
- Toast notification
- Confirmation dialog

---

## 18. Status Badges

Use clear visual states.

Request statuses:

```text
open       - gray/blue
approved   - green
rejected   - red
fulfilled  - purple/green
cancelled  - gray
```

Kit states can be derived from current entity type:

```text
storage      - available
team/person  - assigned
lab          - in check
maintenance  - unavailable
customer     - external
```

---

## 19. Naming Cleanup

Your original schema has some typos. I would standardize names like this:

```text
transection  → transaction
entite       → entity
next entetie → to_entity
current entite → from_entity
```

Also avoid using `date` alone where possible. Prefer:

```text
requested_at
timestamp
created
updated
```

But for MVP, `date` is fine.

---

## 20. Recommended Final Schema

### `kits`

```text
serial: text, unique, required
notes: text, optional
is_active: bool, required, default true
```

### `entities`

```text
name: text, required
description: text, optional
type: select, required
is_active: bool, required, default true
```

### `transactions`

```text
kit: relation kits, required
from_entity: relation entities, optional
to_entity: relation entities, required
timestamp: date, required
notes: text, optional
created_by: relation users, required
request: relation requests, optional
```

### `requests`

```text
requester: relation users, required
date: date, required
status: select, required
designated_kit: relation kits, optional
target_entity: relation entities, optional
notes: text, optional
decision_notes: text, optional
```

### `users`

Add:

```text
name: text
role: select(admin, user, viewer)
entity: relation entities, optional
```

The `entity` field is useful because a user may represent a team/person/customer entity.

---

## 21. One Important Design Decision

You have two options for connecting users and entities.

### Option A — Users and entities are separate

A request has:

```text
requester = user
target_entity = entity
```

This is clean.

Example:

```text
Daniel requested that KIT-001 be sent to Team A.
```

### Option B — Everything is an entity

Users are also entities.

This is elegant for transactions but slightly more annoying for authentication.

My recommendation:

```text
Use users for login.
Use entities for kit possession.
Optionally link user → entity.
```

That gives you both clean authentication and flexible logistics.

---

## 22. Example User Stories

### Logistics user

```text
As a logistics user,
I want to see all kits and who currently has them,
so that I can know what is available.
```

### Regular user

```text
As a regular user,
I want to request a kit,
so that logistics can approve and assign one.
```

### Admin

```text
As an admin,
I want to move a kit from one entity to another,
so that the system reflects the real physical state.
```

### Auditor

```text
As an auditor,
I want to view a kit’s transaction history,
so that I can understand where it was over time.
```

---

## 23. MVP Acceptance Criteria

The MVP is successful when:

1. An admin can create 24 kits.
2. An admin can create all relevant entities.
3. A user can submit a request.
4. An admin can approve the request.
5. An admin can assign a kit.
6. An admin can fulfill the request.
7. Fulfillment creates a transaction.
8. A kit detail page shows complete transaction history.
9. A dashboard shows current kit locations.
10. The system can answer: “Where is KIT-003 right now?”

---

## 24. Technical Risks

### Risk: Inconsistent current holder

If you cache current holder on the kit and forget to update it, data can become inconsistent.

Mitigation:

```text
For MVP, derive current holder from latest transaction.
```

### Risk: Users edit history

If users can edit old transactions, audit value is reduced.

Mitigation:

```text
Make transactions append-only, or admin-only editable.
```

### Risk: PocketBase rules become complex

PocketBase is excellent for small internal apps, but complex permissions can become awkward.

Mitigation:

```text
Keep roles simple.
Use admin/user/viewer only.
```

### Risk: Request and transaction flow becomes unclear

Approval is not the same as physical delivery.

Mitigation:

```text
Use statuses:
open → approved → fulfilled
```

---

## 25. Recommended MVP Screens

Start with these six screens:

```text
1. Login
2. Dashboard
3. Kits list
4. Kit detail
5. Entities list
6. Requests list/detail
```

You can add a dedicated transactions page later.

---

## 26. Final Product Definition

This app is an internal kit tracking and request management system.

It tracks physical kits through entities using append-only transactions. Each kit’s current holder is derived from its latest transaction. Users can request kits, and logistics/admin users can approve, assign, and fulfill those requests. The system prioritizes simplicity, traceability, and operational clarity over complex permissions or heavy ERP-style features.

Recommended build:

```text
Frontend: Vite + React + TypeScript
UI: Tailwind + shadcn/ui
Backend: PocketBase
Auth: PocketBase users
Database: PocketBase SQLite
Deployment: Docker or small internal VM
```

This is a very good fit for PocketBase because the scale is small, the schema is simple, and you want fast development with built-in auth, admin UI, and relational collections.
