/// <reference path="../pb_data/types.d.ts" />
// Block self-delete: a user cannot delete their own account.
//
// Last-admin delete is enforced by pb/pb_hooks/last_admin_check.pb.js (H4) —
// not duplicated here.
//
// `info` is null for superuser / system contexts; in that case the deleteRule
// chain has already authorised the delete, so we don't intervene.

onRecordBeforeDeleteRequest((e) => {
  const info = $apis.requestInfo(e.httpContext);
  if (!info || !info.authRecord) return;

  if (e.record.id === info.authRecord.id) {
    throw new BadRequestError("Cannot delete your own account.");
  }
}, "users");
