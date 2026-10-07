"use client";

import { budgetModeLabel, formatBudget } from "@/lib/format";

export interface BudgetEditorProps {
  /** Which budget this is; the two are never mixed in one control. */
  level: "campaign" | "adgroup";
  mode: string | null;
  /** Current budget on TikTok, when editing an existing object. */
  current?: number | null;
  currency?: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Modes to choose from when creating; omit when the mode cannot change. */
  modes?: string[];
  onModeChange?: (mode: string) => void;
  /** When set, the budget cannot be edited and this explains why. */
  lockedReason?: string | null;
  error?: string | null;
}

const LEVEL_LABEL = { campaign: "Campaign budget", adgroup: "Ad group budget" } as const;

/** One budget control used for campaign and ad group budgets, when creating and editing. */
export function BudgetEditor(props: BudgetEditorProps) {
  const { level, mode, current, currency, value, onChange, modes, onModeChange, lockedReason, error } = props;
  const noLimit = mode === "BUDGET_MODE_INFINITE";
  const daily = mode === "BUDGET_MODE_DAY" || mode === "BUDGET_MODE_DYNAMIC_DAILY_BUDGET";

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{LEVEL_LABEL[level]}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{level === "campaign" ? "Campaign level" : "Ad group level"}</span>
      </div>

      {current !== undefined && (
        <p className="mt-1 text-xs text-slate-500">Current: {formatBudget(current, mode, currency)}</p>
      )}

      {lockedReason ? (
        <p className="mt-2 text-sm text-slate-600">{lockedReason}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Budget type</span>
            {modes && onModeChange ? (
              <select className="input" value={mode ?? ""} onChange={(e) => onModeChange(e.target.value)}>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {budgetModeLabel(m)}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" value={budgetModeLabel(mode)} disabled readOnly />
            )}
          </label>
          <label className="block">
            <span className="label">Amount{currency ? ` (${currency})` : ""}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={noLimit ? "" : value}
              disabled={noLimit}
              placeholder={noLimit ? "No limit" : "0.00"}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </div>
      )}

      {!lockedReason && current !== undefined && (
        <p className="mt-2 text-xs text-slate-500">
          TikTok requires a new budget to be at least 105% of what has already been spent.
          {level === "adgroup" && daily && " Daily budget changes take effect at about 00:00 in the ad account's time zone."}
          {!modes && " The budget type cannot be changed after creation."}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
