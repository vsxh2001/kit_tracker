/// <reference path="../pb_data/types.d.ts" />
// Prevent non-admin users from modifying admin-only fields on their own user record.
//
// PB's updateRule ("admin OR self") already ensures users can only edit their own record.
// This hook adds field-level restrictions on top: certain fields must remain admin-only
// even on self-edits.
//
// Currently guarded fields:
//   denial_notes — reserved for admin deny-request workflow (defense-in-depth).

onRecordBeforeUpdateRequest(function(e) {
  if (e.record.collection().name !== "users") return;

  var info = $apis.requestInfo(e.httpContext);
  if (!info || !info.authRecord) return;  // superuser bypass

  var auth = info.authRecord;
  if (auth.getString("role") === "admin") return;  // admins unrestricted

  try {
    var original = e.record.originalCopy();

    // denial_notes is admin-only (defense-in-depth before deny feature lands).
    var oldDenial = original.getString("denial_notes");
    var newDenial = e.record.getString("denial_notes");
    if (oldDenial !== newDenial) {
      throw new BadRequestError("Only admins can change denial_notes.");
    }
  } catch(err) {
    // Re-throw our explicit errors; swallow missing-field errors (field not yet created).
    if (err && err.message && err.message.indexOf("Only admins") === 0) {
      throw err;
    }
    // Otherwise: field doesn't exist yet — pass through.
  }
}, "users");
