"use client";

import { useState } from "react";
import { RANGE_PRESETS, presetRange, validateRange, type DateRangeValue, type RangePreset } from "@/lib/date-range";

export function DateRangePicker({
  onChange,
  disabled,
}: {
  onChange: (range: DateRangeValue) => void;
  disabled?: boolean;
}) {
  const [preset, setPreset] = useState<RangePreset>("last7");
  const [custom, setCustom] = useState<DateRangeValue>(() => presetRange("last7"));
  const [error, setError] = useState<string | null>(null);

  function choose(next: RangePreset) {
    setPreset(next);
    setError(null);
    if (next !== "custom") {
      const range = presetRange(next);
      setCustom(range);
      onChange(range);
    }
  }

  function updateCustom(patch: Partial<DateRangeValue>) {
    const next = { ...custom, ...patch };
    setCustom(next);
    const problem = validateRange(next);
    setError(problem);
    if (!problem) onChange(next);
  }

  return (
    <div className="flex items-end gap-2">
      <label className="block">
        <span className="label">Date range</span>
        <select className="input w-36" value={preset} disabled={disabled} onChange={(e) => choose(e.target.value as RangePreset)}>
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" && (
        <div>
          <div className="flex gap-2">
            <input type="date" className="input w-36" aria-label="Start date" value={custom.startDate} disabled={disabled} onChange={(e) => updateCustom({ startDate: e.target.value })} />
            <input type="date" className="input w-36" aria-label="End date" value={custom.endDate} disabled={disabled} onChange={(e) => updateCustom({ endDate: e.target.value })} />
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
