export interface DateRangeValue {
  startDate: string;
  endDate: string;
}

export type RangePreset = "today" | "last7" | "last30" | "custom";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Dates are sent as calendar days; TikTok interprets them in the ad account time zone. */
export function presetRange(preset: Exclude<RangePreset, "custom">, now = new Date()): DateRangeValue {
  const end = new Date(now);
  const start = new Date(now);
  if (preset === "last7") start.setDate(start.getDate() - 6);
  if (preset === "last30") start.setDate(start.getDate() - 29);
  return { startDate: iso(start), endDate: iso(end) };
}

/** TikTok allows at most 365 days without a daily breakdown. */
export function validateRange(range: DateRangeValue): string | null {
  if (!range.startDate || !range.endDate) return "Choose a start and end date.";
  const start = new Date(range.startDate).getTime();
  const end = new Date(range.endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "Choose a valid start and end date.";
  if (end < start) return "The end date must be on or after the start date.";
  if ((end - start) / 86_400_000 > 365) return "Choose a range of at most 365 days.";
  return null;
}
