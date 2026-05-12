/// <reference path="../pb_data/types.d.ts" />
// requests.updateRule allows owner to update own open requests for legitimate fields
// (delivery_date, notes, designated_kit, target_entity).
// This hook blocks owners from changing the `status` field — only admin/technician
// may transition status (open → approved/rejected/fulfilled/cancelled).
//
// Per Goja runtime isolation: all PB API calls inside callback scope.

onRecordBeforeUpdateRequest(function(e) {
  if (e.record.collection().name !== "requests") return;

  var info = $apis.requestInfo(e.httpContext);
  if (!info || !info.authRecord) return;  // superuser bypass

  var auth = info.authRecord;
  var role = auth.getString("role");
  if (role === "admin" || role === "technician") return;  // allowed

  var original = e.record.originalCopy();
  var oldStatus = original.getString("status");
  var newStatus = e.record.getString("status");

  if (oldStatus !== newStatus) {
    // Allow ONLY owner cancelling own open request
    if (newStatus === "cancelled" && oldStatus === "open" && e.record.getString("requester") === auth.id) {
      return;
    }
    throw new BadRequestError("Only admin or technician can change request status");
  }
}, "requests");
