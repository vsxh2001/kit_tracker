/// <reference path="../pb_data/types.d.ts" />
// Enforce XOR constraint: each kit_maintenance_schedules row must reference
// exactly one of (kit, component) — never both, never neither.

onRecordBeforeCreateRequest(function(e) {
  var kit = e.record.getString("kit");
  var comp = e.record.getString("component");
  if (!kit && !comp) {
    throw new BadRequestError("schedule must reference either kit or component");
  }
  if (kit && comp) {
    throw new BadRequestError("schedule cannot reference both kit and component");
  }
}, "kit_maintenance_schedules");

onRecordBeforeUpdateRequest(function(e) {
  var kit = e.record.getString("kit");
  var comp = e.record.getString("component");
  if (!kit && !comp) {
    throw new BadRequestError("schedule must reference either kit or component");
  }
  if (kit && comp) {
    throw new BadRequestError("schedule cannot reference both kit and component");
  }
}, "kit_maintenance_schedules");
