/// <reference path="../pb_data/types.d.ts" />
// Block auth for users whose role is "denied".
// Password path: look up user by e.identity (email), check role.
// OAuth path: e.record is populated for existing users; if not set it's a new
//             OAuth signup (no existing denial), so pass through.

onRecordBeforeAuthWithPasswordRequest((e) => {
  const identity = e.identity || "";
  if (!identity) return;

  try {
    const users = $app.dao().findRecordsByFilter(
      "users",
      "email = {:email}",
      "", 1, 0,
      { email: identity }
    );
    if (users.length === 0) return; // unknown user — let PB return 400 as normal
    const user = users[0];
    if (user.getString("role") === "denied") {
      throw new BadRequestError("Your account has been denied. Contact administrator.");
    }
  } catch (err) {
    // Re-throw denial errors; swallow lookup failures.
    if (err && err.message && err.message.indexOf("denied") !== -1) throw err;
    console.log("[auth_deny_check] lookup error:", err);
  }
}, "users");

onRecordBeforeAuthWithOAuth2Request((e) => {
  // e.record is null/undefined for brand-new OAuth signups (PB creates the record after
  // this hook). Only existing, previously-denied users will have e.record set.
  if (!e.record) return;

  try {
    if (e.record.getString("role") === "denied") {
      throw new BadRequestError("Your account has been denied. Contact administrator.");
    }
  } catch (err) {
    if (err && err.message && err.message.indexOf("denied") !== -1) throw err;
    console.log("[auth_deny_check oauth] error:", err);
  }
}, "users");
