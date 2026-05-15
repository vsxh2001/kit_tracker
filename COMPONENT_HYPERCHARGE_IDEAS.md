# Component handling — industry-grounded ideas

Author: product-manager agent
Date: 2026-05-15
Status: DISCUSSION — not yet approved for build

## 1. TL;DR

- **Bin codes per entity** (e.g. `A-3-2`) — finally answer "where in Lab-A is it?" Borrowed from WMS topology.
- **Kit BOM templates** — define what *should* be in a kit type, then audit any kit instance against it. Borrowed from manufacturing BOMs and Snipe-IT asset models.
- **Reorder points on Products** with low-stock email — turns the catalog from passive into an early-warning system. Fishbowl's most-loved feature.
- **Component lifecycle state** (`received → in_service → in_repair → retired`) — closes the "I have 12 of these but 3 are broken" gap. Snipe-IT / Asset Panda standard.
- **Component-level reservations + checkout queues** — extends `requests` from kit-level to component-level. Koha's item-vs-title holds pattern.

## 2. Where we are today

Post in-flight changes: components are physical instances (serial OR `is_bulk + quantity`) that belong to a **Product** (required catalog entry with name, category, manufacturer, model, description, specs JSON, url, is_active). Components live inside **Kits**, which live inside **Entities**. Movement is recorded by append-only `transactions` (kit moves) and `component_transactions` (component splits/merges/transfers). Kits have periodic `KitMaintenanceSchedule` checks. Roles: admin / technician / user / viewer / denied / pending.

**Known gaps:**

- No physical location *within* an entity (where on the shelf?).
- No notion of what a kit *should* contain — only what it does contain right now.
- No stock thresholds; you only learn you're out of widgets when someone tries to use one.
- No component condition / health — `is_active` is binary; no "in repair" or "retired" states.
- Reservations operate at kit-level only; you can't reserve "any free torque wrench."
- No calibration per *component* (only per *kit*) — but calibration is usually a component property (e.g. an individual gauge), not a kit property.
- No batch/lot/expiry — irrelevant for screws, critical for consumables with shelf life (adhesives, batteries, sterile items).

## 3. Industry survey

### Snipe-IT — Assets vs Consumables vs Components ([docs](https://snipe-it.readme.io/docs/managing-assets))

Open-source ITAM. **Pattern worth borrowing:** distinct *types* of inventory with distinct lifecycles. Assets check out and return; consumables check out and don't return; components attach to assets. **Maps to kit-tracker:** current `is_bulk` flag conflates two ideas — "serialized vs not" and "returnable vs consumable." A separate `consumable` flag on Product would let us model batteries, zip ties, and tape correctly.

### McMaster-Carr / cross-reference catalogs ([example](https://www.aehonline.com/cross-reference/))

Industrial parts distributor. **Pattern worth borrowing:** *functional equivalents* — different brand part numbers that are form/fit/function compatible. **Maps to kit-tracker:** a `Product.substitutes` many-to-many relation. When a kit's BOM calls for Product A and only Product A' is in stock, the system can recommend the substitute instead of failing.

### Helm WMS / generic WMS — Bin location topology ([reference](https://helmwms.com/glossary/bin-(warehouse-bin-location)))

Aisle-Bay-Level codes (e.g. `A-12-03`) form a hierarchical address. **Pattern worth borrowing:** a short, scannable, free-form bin code attached to the item. **Maps to kit-tracker:** add an optional `bin_code` to Component (and/or Kit) — autocomplete from previously-used codes within the same entity. Doesn't require modeling shelves as first-class entities (over-engineering for our scale).

### GageList — Calibration crib ([gagelist.com](https://gagelist.com/))

Specialized tool-crib software for measurement gauges. **Pattern worth borrowing:** calibration is a property of an *individual gauge*, not a kit, and emails go out *automatically* before the due date. **Maps to kit-tracker:** lift `KitMaintenanceSchedule` to also apply to Components (rename concept to `MaintenanceSchedule`, polymorphic target).

### Koha library — Item-level vs Title-level holds ([Koha manual](https://koha-community.org/manual/18.11/en/html/circulation.html))

Open-source library system. **Pattern worth borrowing:** patrons can reserve "this specific copy" *or* "any copy of this title — first one returned wins." The queue is global, with priority rules. **Maps to kit-tracker:** today, requests target a specific `designated_kit`. We need a "request any component matching Product X" mode that auto-fulfills from the first available instance.

### FDA UDI + medical lot tracking ([UDI basics](https://www.fda.gov/medical-devices/unique-device-identification-system-udi-system/udi-basics))

UDI = Device Identifier (the model) + Production Identifier (lot, batch, expiry, serial). **Pattern worth borrowing:** lot + expiry as first-class fields on bulk components; recall is "find every component where lot=X and notify holders." **Maps to kit-tracker:** add optional `lot_code` and `expires_at` to Component. Even without medical compliance, this unlocks shelf-life tracking for adhesives and batteries.

### Fishbowl — Reorder points & MRP ([fishbowl reorder](https://help.fishbowlinventory.com/drive/s/article/Drive-Reorder-Report))

Mid-market inventory system. **Pattern worth borrowing:** per-SKU minimum stock level + automatic email when below threshold. **Maps to kit-tracker:** add `reorder_point` to Product. Compute "current stock" as `SUM(component.quantity) WHERE product=X AND is_active=true`. Nightly job emails admins+technicians when below threshold.

### Asset Panda — Lifecycle states ([asset lifecycle](https://www.assetpanda.com/resource-center/blog/what-is-the-average-equipment-lifecycle/))

Cloud asset platform. **Pattern worth borrowing:** discrete lifecycle states (Available, In Use, In Repair, Retired) that gate which operations are allowed. **Maps to kit-tracker:** Component gets a `status` enum instead of a bare `is_active` bool — UI can hide "in_repair" components from request fulfillment, and "retired" ones stay searchable but uncheckable.

## 4. Proposals

### 4.1 Bin code on Component

- **Problem it solves:** Lab-A has 200+ items. "Where is it?" today returns "Lab-A." That's useless when looking for a 3cm part.
- **What it looks like:** Optional `bin_code` text field (max 16 chars) on Component. Component detail page shows it prominently; mobile view emphasizes it. Autocomplete dropdown sourced from `DISTINCT bin_code WHERE current_entity = <selected>`. No separate `bins` collection — bins are inferred from usage.
- **Effort:** S (~1d).
- **Dependencies:** None.
- **Risk:** Stale bin codes when components move. Need to add a "clear bin on transfer" toggle (default on).
- **Industry parallel:** Helm WMS topology, simplified to one level.

### 4.2 Kit BOM template (kit\_type)

- **Problem it solves:** Today a kit is just "whatever components got dragged into it." We can't answer "is the cable kit complete?" or "what's missing from this loaner?"
- **What it looks like:** New `kit_types` collection. Each kit\_type has a name ("Standard Field Toolbag") and a list of `kit_type_items` (Product + required quantity + optional/required flag). Kits get an optional `kit_type` relation. The kit detail page shows a checklist: required components present, missing, surplus, substitutes.
- **Effort:** M (~2-3d).
- **Dependencies:** Builds on Products. Wants 4.3 (substitutes) for full value.
- **Risk:** Auditing is read-only — easy. Auto-creating components from a template (kit assembly wizard) is harder; defer that to phase 2.
- **Industry parallel:** Manufacturing BOMs, Snipe-IT asset models.

### 4.3 Product substitutes

- **Problem it solves:** "I'm out of part X but I have functional-equivalent X' — system should know that."
- **What it looks like:** Many-to-many `product_substitutes` join (product\_a, product\_b, note). Symmetric (A↔B). UI: on Product detail, show a "Compatible with" list. When fulfilling a request for Product A, also surface substitute Products available.
- **Effort:** S–M (~1-2d).
- **Dependencies:** Products (shipped).
- **Risk:** Maintenance burden — substitutes get stale. Flag with a "verified by" + "verified at" so users see how confident.
- **Industry parallel:** McMaster-Carr cross-reference; automotive parts catalogs.

### 4.4 Component lifecycle status

- **Problem it solves:** A broken-but-repairable component shouldn't be `is_active=false` (which hides it everywhere), nor `is_active=true` (which makes it lendable). We need an intermediate state.
- **What it looks like:** Replace `is_active: bool` with `status: 'available' | 'in_use' | 'in_repair' | 'lost' | 'retired'`. Migration maps `is_active=true` → `available`, `false` → `retired`. Filter UI and request fulfillment skip non-`available` automatically. "In repair" components still show in audits.
- **Effort:** M (~2d, mostly UI sweep).
- **Dependencies:** None.
- **Risk:** Migration touches every component. Requires updating every UI list filter. **High risk to existing behavior — needs test coverage before shipping.** See section 6 / 7.
- **Industry parallel:** Snipe-IT, Asset Panda lifecycle states.

### 4.5 Reorder point + low-stock alert

- **Problem it solves:** Surprise stockouts on consumables.
- **What it looks like:** Add `reorder_point` (int, default null) to Product. Add a derived "on-hand" count per product (= sum of active component quantities). Nightly PB hook (or cron) queries products where `on_hand < reorder_point` and emails admin+technician group. Dashboard widget: "5 products below reorder."
- **Effort:** M (~2d incl email).
- **Dependencies:** SMTP already configured (per CLAUDE.md).
- **Risk:** Email spam if thresholds are set too high — give admin an in-UI mute toggle per product.
- **Industry parallel:** Fishbowl MRP tool.

### 4.6 Component-level reservation (Koha-style)

- **Problem it solves:** "I need *a* torque wrench by Friday" — today you must designate a specific kit, which forces logistics to play matchmaker manually.
- **What it looks like:** Extend `requests` to support either `designated_kit` (current) *or* `designated_product` + `quantity`. New status `queued` precedes `approved` when no instance is currently available. Fulfillment picks the first available component of that product (FIFO from request queue) and creates the transaction.
- **Effort:** L (~4-5d).
- **Dependencies:** 4.4 (status) so we know what "available" means. Touches `fulfillRequest` (high-risk atomic flow — see CLAUDE.md).
- **Risk:** **High.** Request fulfillment is already atomic across two collections. Adding a queue introduces ordering, race conditions, and priority rules. Don't ship without tests.
- **Industry parallel:** Koha item-vs-title holds.

### 4.7 Lot + expiry on bulk components

- **Problem it solves:** Adhesives, batteries, calibration standards have shelf lives. Today nothing flags an expired tube of epoxy.
- **What it looks like:** Optional `lot_code` (text) and `expires_at` (date) on Component. Component list view shows an "expires in X days" badge when within 30d. Dashboard: "3 components expiring this month."
- **Effort:** S (~1d).
- **Dependencies:** None.
- **Risk:** None significant — purely additive.
- **Industry parallel:** UDI Production Identifier (lot/expiry portion).

### 4.8 Per-component maintenance schedule

- **Problem it solves:** A torque wrench needs calibration. Currently `KitMaintenanceSchedule` attaches to a kit, not the wrench — but the wrench may move between kits, and the calibration follows the wrench.
- **What it looks like:** Either (a) generalize `KitMaintenanceSchedule` to polymorphic target (`target_kit` OR `target_component`), or (b) add a parallel `ComponentMaintenanceSchedule` collection (simpler — copy the existing pattern). Recommend (b) to minimize touching working code.
- **Effort:** M (~2-3d).
- **Dependencies:** Mirrors existing maintenance code.
- **Risk:** Doubles maintenance-related UI surface area. If we don't have many serialized tools needing calibration, this is over-engineering.
- **Industry parallel:** GageList — calibration is per-gauge.

### 4.9 Bulk vs serialized split UX polish

- **Problem it solves:** Today an admin distinguishes bulk vs serialized via a checkbox. Forms read clunky and the conditional fields are easy to miss.
- **What it looks like:** Split the "New Component" dialog into a first-step picker: "Add specific item (with serial)" vs "Add quantity of bulk item." Each path shows only relevant fields. Same DB shape; pure UI improvement.
- **Effort:** S (~1d).
- **Dependencies:** None.
- **Risk:** Low; UI-only.
- **Industry parallel:** Snipe-IT's consumables-vs-assets entry flow.

### 4.10 Free pool / Unassigned entity convention

- **Problem it solves:** Components currently must live in a kit which lives in an entity. Where does a loose part go between assignments?
- **What it looks like:** Bless a system entity called "Shelf" (or "Unassigned") as the default home. Document the convention; optionally add a UI shortcut "Return to shelf." No schema change.
- **Effort:** S (~0.5d, mostly docs + a button).
- **Dependencies:** None.
- **Risk:** Naming bikeshed.
- **Industry parallel:** Bikeshare "dock" concept; tool crib "free pool."

### 4.11 Damage / condition flag with photo

- **Problem it solves:** Returning a damaged item should be flagged immediately, not silently. "Needs repair before next use."
- **What it looks like:** On a return / transfer transaction, optional checkbox "Report damage" → opens a sub-form (severity dropdown: minor/major/unusable; notes; photo upload). Side effect: component status flips to `in_repair` (4.4) automatically when severity = unusable.
- **Effort:** M (~2d).
- **Dependencies:** 4.4 (status), kits already have attachments — same mechanism for component damage photos.
- **Risk:** Low if 4.4 is in place. Without 4.4, just notes-with-photo (still useful).
- **Industry parallel:** Sunbelt Rental Protection Plan return inspection.

### 4.12 Bulk barcode/QR scan workflow (mobile-friendly)

- **Problem it solves:** Receiving 50 new screws and creating 50 components by hand is painful.
- **What it looks like:** Mobile-first "Scan & Add" screen. Camera reads QR/barcode (existing libs: `html5-qrcode`). Scanned code becomes the serial; product is pre-selected from a dropdown that persists across scans. Tap to confirm; loop. Same flow for "Move components to kit X" — scan kit, then scan components.
- **Effort:** L (~4-5d incl. mobile UX work).
- **Dependencies:** None.
- **Risk:** Mobile UI is a new modality for this app — risks UI complexity sprawl. Recommend a single dedicated route `/scan` rather than weaving scanning into every existing page.
- **Industry parallel:** Every WMS, Snipe-IT mobile.

### 4.13 Component history timeline view

- **Problem it solves:** "Where has this serial been?" requires SQL today.
- **What it looks like:** Component detail page gets a vertical timeline: transactions (split/merge/transfer), maintenance events, damage reports, status changes. Read-only view over `component_transactions` + (4.8) + (4.11).
- **Effort:** S–M (~1-2d).
- **Dependencies:** Best after 4.4 and 4.11 land so the timeline is rich.
- **Risk:** Low.
- **Industry parallel:** Asset Panda "Activity Stream."

### 4.14 Utilization / idle-time analytics

- **Problem it solves:** Which products are over-stocked? Which sit idle for 6 months? Procurement signal.
- **What it looks like:** Admin-only dashboard tab. Per-product: count, days-since-last-move (median), pct-of-time-in-active-kit. Sort by "longest idle." Suggest retirement candidates.
- **Effort:** M (~2-3d, mostly query + viz).
- **Dependencies:** Sufficient historical data — wait until ≥6mo of `component_transactions` is in prod.
- **Risk:** Premature without data. Easy to over-engineer charts.
- **Industry parallel:** WMS slotting analytics; Asset Panda retire-after-N-incidents.

### 4.15 Consumable flag on Product (one-way checkout)

- **Problem it solves:** Tape doesn't come back. Today the system expects every transfer to potentially have a return.
- **What it looks like:** Boolean `is_consumable` on Product. When component of a consumable product is moved to a non-storage entity, mark it consumed; don't expect return. Affects reorder calculations (consumed counts toward "burn rate").
- **Effort:** S (~1d).
- **Dependencies:** None for the flag; full integration with 4.5 (reorder) is the value-add.
- **Risk:** Low.
- **Industry parallel:** Snipe-IT consumables.

### 4.16 NOT a proposal — already shipped

The brief listed several ideas already in place. Calling them out explicitly so they're not re-proposed: Products as catalog (shipped, with URL field landing), append-only audit log (shipped), per-kit maintenance (shipped), on-call shifts (shipped).

## 5. Prioritization

| # | Proposal | Value | Effort | Risk | When |
|---|---|---|---|---|---|
| 4.1 | Bin code | High | S | Low | **Now** |
| 4.7 | Lot + expiry | High | S | Low | **Now** |
| 4.5 | Reorder point + alert | High | M | Low-Med | **Now** |
| 4.2 | Kit BOM template | High | M | Med | Next |
| 4.4 | Lifecycle status | High | M | Med (migration) | Next |
| 4.9 | Bulk/serialized split UX | Med | S | Low | Next |
| 4.13 | Component timeline | Med | S-M | Low | Next |
| 4.3 | Substitutes | Med | S-M | Low | Later |
| 4.11 | Damage flag + photo | Med | M | Low | Later (needs 4.4) |
| 4.15 | Consumable flag | Med | S | Low | Later (pairs w/ 4.5) |
| 4.6 | Component reservation | High | L | **High** | Later (needs tests) |
| 4.8 | Per-component maintenance | Med | M | Low | Later (unclear demand) |
| 4.10 | Free-pool entity | Low | S | Low | Anytime |
| 4.12 | Barcode scan mobile | Med-High | L | Med | Later (validate demand first) |
| 4.14 | Utilization analytics | Med | M | Low | After 6mo data |

**Start with these 3 first:**

1. **4.1 Bin code** — smallest possible win. One field, one autocomplete, makes Lab-A immediately more useful. No risk to atomic transaction flows.
2. **4.7 Lot + expiry** — also tiny, also additive, opens medical / consumable use cases the system can't touch today.
3. **4.5 Reorder point + alert** — slightly bigger but transforms Product from passive catalog into something operationally useful. Pairs naturally with 4.15 (consumable flag) as a stretch.

These three are intentionally all *additive* schema changes with no migration risk and no touch on the append-only transaction or `fulfillRequest` atomicity. They unlock conversation about the harder items (4.4 status, 4.6 reservations) once the team has tasted the win.

## 6. NOT recommended (and why)

- **Full multi-level WMS topology** (warehouse → zone → aisle → bay → shelf → bin as nested entities). Over-engineering for our scale. The flat `bin_code` string in 4.1 captures 90% of the value at 5% of the effort. Revisit only if entities grow past ~10 large warehouses.
- **Generic polymorphic relations** ("component can attach to anything"). PocketBase relations are typed; polymorphism via convention is fragile. Stick to explicit relations per attachment target.
- **AI-driven anomaly detection** (e.g. "this component is unusual"). Premature without a test suite, without a baseline, and without proven UX demand. Revisit once 4.14 analytics has been in place a quarter.
- **Procurement workflow (PO → receive → assign serial).** Adjacent system territory; we're a tracker, not an ERP. If the org wants this, integrate with a separate PO system, don't grow into it.

## 7. Open questions for user

1. **Calibration scope** — are the things requiring calibration *kits* or *components*? If components, 4.8 jumps in priority. If overwhelmingly kits, defer 4.8 indefinitely.
2. **Consumables share of inventory** — what fraction of components are consumed-not-returned (tape, screws, adhesives)? Drives 4.15 priority.
3. **Reservation pain** — how often does a requester say "any one of X" and currently get told "pick a specific kit"? If this is a daily frustration, 4.6 jumps despite the risk; if rare, defer.
4. **Bin code policy** — should bins be admin-managed (curated list) or technician-managed (free-form text with autocomplete)? Affects whether 4.1 needs a `bins` collection.
5. **Test suite appetite** — proposals 4.4, 4.6, and 4.12 are risky enough that they should not ship without test coverage on transaction atomicity. Is there appetite to stand up a PB-level integration test harness before, or alongside, those features?
6. **Lifecycle states wording** — what states does the team actually use in real life? Don't borrow Snipe-IT's labels — capture the org's vocabulary first.
7. **Mobile vs desktop usage split** — is most check-in/out at a desk or on the floor? Drives whether 4.12 (mobile scan) is a quick win or a luxury.
8. **Substitute authority** — who decides Product A is functionally equivalent to A'? Engineering? Logistics? Affects whether 4.3 needs an approval flag.
9. **Recall risk** — does the org ever need to "find everyone holding lot X"? If yes, 4.7 needs a recall workflow on top of the lot field.
10. **Expected return on consumables** — request UI today asks for `expected_return`; should it suppress that field when the requested product is consumable (4.15)?
