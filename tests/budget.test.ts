import { describe, expect, it } from "vitest";
import {
  adGroupBudgetUpdateArgs,
  campaignBudgetModes,
  validateAdGroupBudgetChange,
  validateCampaignBudgetChange,
  validateNewAdGroupBudget,
  validateNewCampaignBudget,
} from "@/integrations/tiktok/tiktok.budget";

describe("campaign budget rules", () => {
  it("offers different modes with and without campaign budget optimization", () => {
    expect(campaignBudgetModes(true)).not.toContain("BUDGET_MODE_INFINITE");
    expect(campaignBudgetModes(false)).toContain("BUDGET_MODE_INFINITE");
    expect(campaignBudgetModes(false)).not.toContain("BUDGET_MODE_DYNAMIC_DAILY_BUDGET");
  });

  it("validates a new campaign budget", () => {
    expect(validateNewCampaignBudget({ budgetOptimizeOn: true, budgetMode: "BUDGET_MODE_DAY", budget: 100 }).ok).toBe(true);
    expect(validateNewCampaignBudget({ budgetOptimizeOn: true, budgetMode: "BUDGET_MODE_INFINITE" }).ok).toBe(false);
    expect(validateNewCampaignBudget({ budgetOptimizeOn: false, budgetMode: "BUDGET_MODE_INFINITE" }).ok).toBe(true);
    expect(validateNewCampaignBudget({ budgetOptimizeOn: false, budgetMode: "BUDGET_MODE_INFINITE", budget: 5 }).ok).toBe(false);
    expect(validateNewCampaignBudget({ budgetOptimizeOn: true, budgetMode: "BUDGET_MODE_TOTAL" }).ok).toBe(false);
    expect(validateNewCampaignBudget({ budgetOptimizeOn: true, budgetMode: "BUDGET_MODE_DAY", budget: 0 }).ok).toBe(false);
  });

  it("requires a changed budget to be at least 105% of spend", () => {
    expect(validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_DAY", newBudget: 104, spend: 100 }).ok).toBe(false);
    expect(validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_DAY", newBudget: 105, spend: 100 }).ok).toBe(true);
    expect(validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_DAY", newBudget: 10, spend: null }).ok).toBe(true);
  });

  it("refuses a budget on a campaign without a campaign-level budget", () => {
    const check = validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_INFINITE", newBudget: 100 });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("ad groups");
  });

  it("rejects non-numeric and negative amounts", () => {
    expect(validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_DAY", newBudget: Number.NaN }).ok).toBe(false);
    expect(validateCampaignBudgetChange({ budgetMode: "BUDGET_MODE_DAY", newBudget: -5 }).ok).toBe(false);
  });
});

describe("ad group budget rules", () => {
  it("blocks ad group budgets under campaign budget optimization", () => {
    const check = validateAdGroupBudgetChange({ campaignBudgetOptimizeOn: true, budgetMode: "BUDGET_MODE_DAY", newBudget: 50 });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("campaign budget optimization");
  });

  it("allows them otherwise", () => {
    expect(validateAdGroupBudgetChange({ campaignBudgetOptimizeOn: false, budgetMode: "BUDGET_MODE_DAY", newBudget: 50 }).ok).toBe(true);
    expect(validateAdGroupBudgetChange({ campaignBudgetOptimizeOn: false, budgetMode: null, newBudget: 50 }).ok).toBe(false);
  });

  it("requires an end time for lifetime budgets", () => {
    expect(validateNewAdGroupBudget({ budgetMode: "BUDGET_MODE_TOTAL", budget: 100, scheduleType: "SCHEDULE_FROM_NOW" }).ok).toBe(false);
    expect(
      validateNewAdGroupBudget({
        budgetMode: "BUDGET_MODE_TOTAL",
        budget: 100,
        scheduleType: "SCHEDULE_START_END",
        scheduleEndTime: "2027-01-01 00:00:00",
      }).ok,
    ).toBe(true);
    expect(validateNewAdGroupBudget({ budgetMode: "BUDGET_MODE_DAY", budget: 100, scheduleType: "SCHEDULE_FROM_NOW" }).ok).toBe(true);
  });

  it("uses scheduled_budget for daily budgets and budget for lifetime budgets", () => {
    const daily = adGroupBudgetUpdateArgs({ advertiserId: "a", adGroupId: "g", budgetMode: "BUDGET_MODE_DAY", newBudget: 70 });
    expect(daily.scheduled).toBe(true);
    expect(daily.args).toEqual({ advertiser_id: "a", scheduled_budget: [{ adgroup_id: "g", scheduled_budget: 70 }] });

    const lifetime = adGroupBudgetUpdateArgs({ advertiserId: "a", adGroupId: "g", budgetMode: "BUDGET_MODE_TOTAL", newBudget: 700 });
    expect(lifetime.scheduled).toBe(false);
    expect(lifetime.args).toEqual({ advertiser_id: "a", budget: [{ adgroup_id: "g", budget: 700 }] });
  });
});
