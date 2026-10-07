import type { ActivityRow } from "@/server/dto";
import { EmptyState } from "../ui/primitives";

const RESULT_STYLE: Record<string, string> = {
  Success: "text-emerald-700",
  Failed: "text-red-700",
  "Not verified": "text-amber-700",
};

function summarize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object",
  );
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : null;
}

/** Activity recorded by this application for writes it sent to TikTok. */
export function ActivityList({ rows, showResource = false }: { rows: ActivityRow[]; showResource?: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No activity yet">
        Changes made from this panel are listed here. Changes made directly in TikTok Ads Manager are not.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => {
        const before = summarize(row.before);
        const after = summarize(row.after);
        return (
          <li key={row.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-medium text-slate-900">{row.action}</span>
                {showResource && row.resourceName && <span className="text-slate-600"> · {row.resourceName}</span>}
                {showResource && row.resourceId && <span className="text-xs text-slate-400"> ({row.resourceId})</span>}
              </span>
              <span className="text-xs text-slate-500">
                {row.userName} · {new Date(row.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 grid gap-0.5 text-xs text-slate-600">
              {before && (
                <span>
                  <span className="text-slate-400">Before:</span> {before}
                </span>
              )}
              {after && (
                <span>
                  <span className="text-slate-400">After:</span> {after}
                </span>
              )}
              <span>
                <span className="text-slate-400">Result:</span>{" "}
                <span className={`font-medium ${RESULT_STYLE[row.result] ?? "text-slate-700"}`}>{row.result}</span>
                {row.message && ` — ${row.message}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
