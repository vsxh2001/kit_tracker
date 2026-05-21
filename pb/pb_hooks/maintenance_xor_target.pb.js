/// <reference path="../pb_data/types.d.ts" />
// Enforce XOR constraint: each kit_maintenance_schedules row must reference
// exactly one of (kit, component) — never both, never neither.
//
// Uses onModelBeforeCreate/onModelBeforeUpdate (not onRecordBefore*Request)
// so that dao.save() calls from ai_chat.pb.js / ai_mcp.pb.js are also covered.

onModelBeforeCreate(function(e) {
  var kit = e.model.getString("kit");
  var comp = e.model.getString("component");
  if (!kit && !comp) {
    throw new BadRequestError("schedule must reference either kit or component");
  }
  if (kit && comp) {
    throw new BadRequestError("schedule cannot reference both kit and component");
  }
}, "kit_maintenance_schedules");

onModelBeforeUpdate(function(e) {
  var kit = e.model.getString("kit");
  var comp = e.model.getString("component");
  if (!kit && !comp) {
    throw new BadRequestError("schedule must reference either kit or component");
  }
  if (kit && comp) {
    throw new BadRequestError("schedule cannot reference both kit and component");
  }
}, "kit_maintenance_schedules");
