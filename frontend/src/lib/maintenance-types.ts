import type { MaintenanceType } from "../types";

export const MAINTENANCE_TYPES: { value: MaintenanceType; label: string }[] = [
  { value: "calibration",   label: "Calibration" },
  { value: "inspection",    label: "Inspection" },
  { value: "service",       label: "Service" },
  { value: "replacement",   label: "Replacement" },
  { value: "certification", label: "Certification" },
  { value: "other",         label: "Other" },
];

export function maintenanceTypeLabel(value: string): string {
  return MAINTENANCE_TYPES.find((t) => t.value === value)?.label ?? value;
}
