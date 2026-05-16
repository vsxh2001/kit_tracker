/// <reference path="../pb_data/types.d.ts" />
// Enforce: at most one ACTIVE kit per serial.
//
// Migration 1778880000_kit_serial_not_unique dropped the DB-level UNIQUE
// constraint on kits.serial so a retired (is_active=false) kit can free up
// its serial for reuse. This hook adds the missing business rule: among
// active kits the serial must still be unique. Retired kits may share a
// serial with each other and with one active kit.
//
// All logic inlined inside each callback — PB v0.22 Goja runs each hook
// invocation in an isolated runtime; module-level function declarations
// are NOT visible inside callbacks.

onRecordBeforeCreateRequest((e) => {
  if (!e.collection || e.collection.name !== "kits") return;
  if (!e.record.getBool("is_active")) return;
  const serial = e.record.getString("serial");
  if (!serial) return;
  const matches = $app.dao().findRecordsByFilter(
    "kits",
    "serial = {:serial} && is_active = true",
    "",
    1,
    0,
    { serial: serial }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active kit already uses this serial. Retire it first or pick a different serial."
    );
  }
}, "kits");

onRecordBeforeUpdateRequest((e) => {
  if (!e.collection || e.collection.name !== "kits") return;
  if (!e.record.getBool("is_active")) return;
  const serial = e.record.getString("serial");
  if (!serial) return;
  const matches = $app.dao().findRecordsByFilter(
    "kits",
    "serial = {:serial} && is_active = true && id != {:id}",
    "",
    1,
    0,
    { serial: serial, id: e.record.id }
  );
  if (matches.length > 0) {
    throw new BadRequestError(
      "Another active kit already uses this serial. Retire it first or pick a different serial."
    );
  }
}, "kits");
