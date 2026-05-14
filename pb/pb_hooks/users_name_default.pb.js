/// <reference path="../pb_data/types.d.ts" />
// If name is empty on user create, fall back to the email local part.
// Prevents blank name cells in the admin UI when Google OAuth doesn't
// return a display name (scope not granted or not set on the Google account).

onRecordBeforeCreateRequest((e) => {
  const name = e.record.getString("name");
  if (!name) {
    const email = e.record.getString("email");
    if (email && email.indexOf("@") > 0) {
      e.record.set("name", email.split("@")[0]);
    }
  }
}, "users");
