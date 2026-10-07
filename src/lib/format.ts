export const NOT_AVAILABLE = "Not available";

export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return NOT_AVAILABLE;
  const value = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${value} ${currency}` : value;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  return `${value.toFixed(2)}%`;
}

const BUDGET_MODE_LABELS: Record<string, string> = {
  BUDGET_MODE_DAY: "Daily",
  BUDGET_MODE_DYNAMIC_DAILY_BUDGET: "Daily (weekly average)",
  BUDGET_MODE_TOTAL: "Lifetime",
  BUDGET_MODE_INFINITE: "No limit",
};

export function budgetModeLabel(mode: string | null | undefined): string {
  if (!mode) return NOT_AVAILABLE;
  return BUDGET_MODE_LABELS[mode] ?? mode;
}

export function formatBudget(
  amount: number | null | undefined,
  mode: string | null | undefined,
  currency?: string | null,
): string {
  if (mode === "BUDGET_MODE_INFINITE") return "No limit";
  if (amount === null || amount === undefined) return NOT_AVAILABLE;
  const suffix = mode === "BUDGET_MODE_TOTAL" ? " lifetime" : mode ? "/day" : "";
  return `${formatMoney(amount, currency)}${suffix}`;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
