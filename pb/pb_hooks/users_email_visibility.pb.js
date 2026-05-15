/// <reference path="../pb_data/types.d.ts" />
// Force emailVisibility=true on every users record create.
//
// Why: PocketBase defaults emailVisibility to false. When false, the email
// field is omitted from API responses for non-owner non-superuser callers.
// Result: admins listing /users via the regular API see records but with
// empty email cells — making user management impossible.
//
// Kit-tracker is an internal tool where admins MUST see emails to manage
// roles. Force-set on create. Backfill of pre-existing users is handled by
// migration 1778742000_backfill_email_visibility.js.
//
// Uses onModelBeforeCreate (lower-level Dao hook) so admin-panel creates
// — which bypass onRecordBeforeCreateRequest — are also covered.

onModelBeforeCreate((e) => {
  e.model.setEmailVisibility(true);
}, "users");
