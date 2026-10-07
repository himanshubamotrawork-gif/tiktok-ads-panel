import type { EntityStatus } from "@/integrations/tiktok/tiktok.types";

const STYLES: Record<EntityStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  PAUSED: { label: "Paused", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  PENDING: { label: "Pending", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  UNDER_REVIEW: { label: "Under review", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  REJECTED: { label: "Rejected", className: "bg-red-50 text-red-700 ring-red-200" },
  DISABLED: { label: "Not delivering", className: "bg-slate-100 text-slate-500 ring-slate-200" },
  UNKNOWN: { label: "Unknown", className: "bg-slate-50 text-slate-500 ring-slate-200" },
};

/** Normalized status; the original TikTok status is shown on hover. */
export function StatusBadge({ status, externalStatus }: { status: EntityStatus; externalStatus?: string | null }) {
  const style = STYLES[status];
  return (
    <span
      title={externalStatus ? `TikTok status: ${externalStatus}` : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {style.label}
    </span>
  );
}
