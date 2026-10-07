// Budget rules taken from the MCP tool definitions (campaign_create, campaign_update,
// adgroup_create, adgroup_update, adgroup_budget_update). Minimum amounts per currency
// are not exposed by the MCP, so they are left to TikTok to enforce.

import type { BudgetMode } from "./tiktok.types";

export interface BudgetCheck {
  ok: boolean;
  error?: string;
}

const OK: BudgetCheck = { ok: true };
const fail = (error: string): BudgetCheck => ({ ok: false, error });

/** TikTok requires a new budget to be at least 105% of what has already been spent. */
export const MIN_BUDGET_TO_SPEND_RATIO = 1.05;

export function isDailyMode(mode: string | null | undefined): boolean {
  return mode === "BUDGET_MODE_DAY" || mode === "BUDGET_MODE_DYNAMIC_DAILY_BUDGET";
}

function checkAmount(amount: number, spend: number | null | undefined): BudgetCheck {
  if (!Number.isFinite(amount) || amount <= 0) return fail("Budget must be a number greater than 0.");
  if (spend !== null && spend !== undefined && spend > 0) {
    const minimum = spend * MIN_BUDGET_TO_SPEND_RATIO;
    if (amount < minimum) {
      return fail(
        `Budget must be at least ${minimum.toFixed(2)} (105% of the ${spend.toFixed(2)} already spent).`,
      );
    }
  }
  return OK;
}

/** Budget modes TikTok accepts at campaign level, depending on campaign budget optimization. */
export function campaignBudgetModes(budgetOptimizeOn: boolean): BudgetMode[] {
  return budgetOptimizeOn
    ? ["BUDGET_MODE_DYNAMIC_DAILY_BUDGET", "BUDGET_MODE_DAY", "BUDGET_MODE_TOTAL"]
    : ["BUDGET_MODE_INFINITE", "BUDGET_MODE_DAY", "BUDGET_MODE_TOTAL"];
}

export function validateNewCampaignBudget(input: {
  budgetOptimizeOn: boolean;
  budgetMode: BudgetMode;
  budget?: number;
}): BudgetCheck {
  if (!campaignBudgetModes(input.budgetOptimizeOn).includes(input.budgetMode)) {
    return fail(
      input.budgetOptimizeOn
        ? "With campaign budget optimization on, the campaign needs a daily or lifetime budget."
        : "This budget mode is only available with campaign budget optimization on.",
    );
  }
  if (input.budgetMode === "BUDGET_MODE_INFINITE") {
    return input.budget === undefined ? OK : fail("A campaign with no budget limit cannot have a budget amount.");
  }
  if (input.budget === undefined) return fail("Enter a budget amount.");
  return checkAmount(input.budget, null);
}

export function validateCampaignBudgetChange(input: {
  budgetMode: string | null;
  newBudget: number;
  spend?: number | null;
}): BudgetCheck {
  if (!input.budgetMode || input.budgetMode === "BUDGET_MODE_INFINITE") {
    return fail(
      "This campaign has no campaign-level budget. Its budgets are set on the ad groups, and TikTok does not allow the budget mode to be changed after creation.",
    );
  }
  return checkAmount(input.newBudget, input.spend);
}

export function validateAdGroupBudgetChange(input: {
  campaignBudgetOptimizeOn: boolean | null;
  budgetMode: string | null;
  newBudget: number;
  spend?: number | null;
}): BudgetCheck {
  if (input.campaignBudgetOptimizeOn) {
    return fail(
      "This campaign uses campaign budget optimization, so TikTok distributes the campaign budget and ad group budgets cannot be edited.",
    );
  }
  if (!input.budgetMode) return fail("TikTok did not report a budget mode for this ad group.");
  return checkAmount(input.newBudget, input.spend);
}

export function validateNewAdGroupBudget(input: {
  budgetMode: string;
  budget: number;
  scheduleType: string;
  scheduleEndTime?: string;
}): BudgetCheck {
  if (input.budgetMode === "BUDGET_MODE_TOTAL") {
    if (input.scheduleType !== "SCHEDULE_START_END" || !input.scheduleEndTime) {
      return fail("A lifetime budget needs a schedule with both a start and an end time.");
    }
  }
  return checkAmount(input.budget, null);
}

/**
 * Arguments for adgroup_budget_update. Lifetime budgets change immediately; daily
 * budgets are scheduled by TikTok for about 00:00 the next day in the account time zone.
 */
export function adGroupBudgetUpdateArgs(input: {
  advertiserId: string;
  adGroupId: string;
  budgetMode: string;
  newBudget: number;
}): { args: Record<string, unknown>; scheduled: boolean } {
  if (isDailyMode(input.budgetMode)) {
    return {
      scheduled: true,
      args: {
        advertiser_id: input.advertiserId,
        scheduled_budget: [{ adgroup_id: input.adGroupId, scheduled_budget: input.newBudget }],
      },
    };
  }
  return {
    scheduled: false,
    args: {
      advertiser_id: input.advertiserId,
      budget: [{ adgroup_id: input.adGroupId, budget: input.newBudget }],
    },
  };
}
