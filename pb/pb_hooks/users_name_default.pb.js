/// <reference path="../pb_data/types.d.ts" />
// If name is empty on user create, fall back to the email local part.
// Prevents blank name cells in the admin UI when Google OAuth doesn't
// return a display name (scope not granted or not set on the Google account).
//
// Uses onModelBeforeCreate (lower-level Dao hook) so admin-panel creates
// — which bypass onRecordBeforeCreateRequest — are also covered.

onModelBeforeCreate((e) => {
  const name = e.model.getString("name");
  if (!name) {
    const email = e.model.getString("email");
    if (email && email.indexOf("@") > 0) {
      e.model.set("name", email.split("@")[0]);
    }
  }
}, "users");
