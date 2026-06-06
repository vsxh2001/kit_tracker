import type { MaintStatus } from "../lib/utils";

export function MaintenanceStatusBadge({
  status,
  size = "md",
}: {
  status: MaintStatus;
  size?: "sm" | "md";
}) {
  const padX = size === "sm" ? "px-1.5" : "px-2";
  const base = `inline-flex items-center rounded-full ${padX} py-0.5 text-xs font-semibold`;
  if (status === "overdue") return <span className={`${base} bg-red-100 text-red-700`}>Overdue</span>;
  if (status === "due-soon") return <span className={`${base} bg-amber-100 text-amber-700`}>Due soon</span>;
  return <span className={`${base} bg-emerald-100 text-emerald-700`}>OK</span>;
}
