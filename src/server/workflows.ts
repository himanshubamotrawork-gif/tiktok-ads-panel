// Write workflows. Each one goes through runOperation, so it is recorded, executed,
// re-read from TikTok and logged. They depend only on the gateway and store interfaces,
// which is what lets the tests run them against mocks.

import { listAds } from "@/integrations/tiktok/tiktok.ads";
import {
  getAdGroup,
  listAdGroups,
  updateAdGroup,
  updateAdGroupBudget,
  type AdGroupChanges,
} from "@/integrations/tiktok/tiktok.ad-groups";
import { validateAdGroupBudgetChange, validateCampaignBudgetChange } from "@/integrations/tiktok/tiktok.budget";
import { getCampaign, isUpgradedSmartPlus, setCampaignStatus, updateCampaign } from "@/integrations/tiktok/tiktok.campaigns";
import { executeCreationPlan, type CreatedIds } from "@/integrations/tiktok/tiktok.creation";
import type { CreationPlan } from "@/integrations/tiktok/tiktok.draft";
import { TikTokError } from "@/integrations/tiktok/tiktok.errors";
import { getCampaignLifetimeSpend } from "@/integrations/tiktok/tiktok.reporting";
import type { AdGroupModel, AdModel, CampaignModel, TikTokGateway } from "@/integrations/tiktok/tiktok.types";
import { budgetModeLabel, titleCase } from "@/lib/format";
import { runOperation, type OperationContext, type OperationResult, type OperationStore } from "./operations/runner";

function statusLabel(campaign: { status: string; externalStatus: string | null }): string {
  return campaign.externalStatus ? `${titleCase(campaign.status)} (${campaign.externalStatus})` : titleCase(campaign.status);
}

function campaignSnapshot(c: CampaignModel) {
  return {
    name: c.name,
    status: c.status,
    externalStatus: c.externalStatus,
    operationStatus: c.operationStatus,
    budgetMode: c.budgetMode,
    budget: c.budget,
  };
}

const sameAmount = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.005;

async function spendOrNull(gateway: TikTokGateway, advertiserId: string, campaignId: string) {
  // The 105%-of-spend pre-check is a convenience; TikTok enforces the rule regardless.
  try {
    return await getCampaignLifetimeSpend(gateway, advertiserId, campaignId);
  } catch {
    return null;
  }
}

// ---------- pause / resume ----------

export async function setCampaignDelivery(
  gateway: TikTokGateway,
  store: OperationStore,
  ctx: OperationContext,
  input: { advertiserId: string; campaignId: string; action: "pause" | "resume"; campaignName?: string },
): Promise<OperationResult & { campaign?: CampaignModel }> {
  const pause = input.action === "pause";
  const target = pause ? "DISABLE" : "ENABLE";
  let latest: CampaignModel | undefined;
  let before: ReturnType<typeof campaignSnapshot> | undefined;

  const result = await runOperation(store, ctx, {
    action: pause ? "Campaign Paused" : "Campaign Resumed",
    failureLabel: pause ? "Campaign pause" : "Campaign resume",
    resourceType: "campaign",
    resourceId: input.campaignId,
    resourceName: input.campaignName,
    advertiserId: input.advertiserId,
    requestedData: { operation_status: target },
    get before() {
      return before;
    },
    async execute() {
      const current = await getCampaign(gateway, input.advertiserId, input.campaignId);
      before = campaignSnapshot(current);
      await setCampaignStatus(gateway, input.advertiserId, input.campaignId, target, current.automationType);
    },
    async verify() {
      latest = await getCampaign(gateway, input.advertiserId, input.campaignId);
      const after = campaignSnapshot(latest);
      const name = latest.name;
      if (latest.operationStatus !== target) {
        return {
          ok: false,
          after,
          resourceName: name,
          message: `TikTok still reports this campaign as ${statusLabel(latest)}, so it was not ${pause ? "paused" : "resumed"}.`,
        };
      }
      return {
        ok: true,
        after,
        resourceName: name,
        message: pause
          ? `Campaign paused. TikTok reports it as ${statusLabel(latest)}.`
          : `Campaign resumed. TikTok reports it as ${statusLabel(latest)}.`,
      };
    },
  });
  return { ...result, campaign: latest };
}

// ---------- edit campaign (name, budget) ----------

export async function editCampaign(
  gateway: TikTokGateway,
  store: OperationStore,
  ctx: OperationContext,
  input: { advertiserId: string; campaignId: string; name?: string; budget?: number },
): Promise<OperationResult & { campaign?: CampaignModel }> {
  const current = await getCampaign(gateway, input.advertiserId, input.campaignId);
  const changes: { name?: string; budget?: number } = {};
  if (input.name !== undefined && input.name.trim() !== current.name) changes.name = input.name.trim();
  if (input.budget !== undefined && !sameAmount(current.budget, input.budget)) changes.budget = input.budget;

  if (changes.name !== undefined && changes.name.length === 0) {
    throw new TikTokError("INVALID_REQUEST", "Campaign name cannot be empty.");
  }
  if (changes.name !== undefined && changes.name.length > 512) {
    throw new TikTokError("INVALID_REQUEST", "Campaign name can be at most 512 characters.");
  }
  if (changes.budget !== undefined) {
    const spend = await spendOrNull(gateway, input.advertiserId, input.campaignId);
    const check = validateCampaignBudgetChange({ budgetMode: current.budgetMode, newBudget: changes.budget, spend });
    if (!check.ok) throw new TikTokError("INVALID_BUDGET", check.error ?? "Invalid budget.");
  }
  if (changes.name === undefined && changes.budget === undefined) {
    throw new TikTokError("INVALID_REQUEST", "Nothing was changed.");
  }

  const budgetOnly = changes.budget !== undefined && changes.name === undefined;
  let latest: CampaignModel | undefined;
  const result = await runOperation(store, ctx, {
    action: budgetOnly ? "Campaign Budget Changed" : "Campaign Edited",
    failureLabel: budgetOnly ? "Campaign budget change" : "Campaign edit",
    resourceType: "campaign",
    resourceId: input.campaignId,
    resourceName: current.name,
    advertiserId: input.advertiserId,
    requestedData: changes,
    before: {
      ...(changes.name !== undefined ? { name: current.name } : {}),
      ...(changes.budget !== undefined ? { budget: current.budget, budgetMode: current.budgetMode } : {}),
    },
    execute: () => updateCampaign(gateway, input.advertiserId, input.campaignId, changes),
    async verify() {
      latest = await getCampaign(gateway, input.advertiserId, input.campaignId);
      const after = {
        ...(changes.name !== undefined ? { name: latest.name } : {}),
        ...(changes.budget !== undefined ? { budget: latest.budget, budgetMode: latest.budgetMode } : {}),
      };
      const problems: string[] = [];
      if (changes.name !== undefined && latest.name !== changes.name) {
        problems.push(`the name is still "${latest.name}"`);
      }
      if (changes.budget !== undefined && !sameAmount(latest.budget, changes.budget)) {
        problems.push(`the budget is still ${latest.budget ?? "not set"}`);
      }
      if (problems.length) {
        return { ok: false, after, resourceName: latest.name, message: `TikTok accepted the request, but ${problems.join(" and ")}.` };
      }
      return { ok: true, after, resourceName: latest.name, message: "Campaign updated and confirmed with TikTok." };
    },
  });
  return { ...result, campaign: latest };
}

// ---------- ad group budget ----------

export async function changeAdGroupBudget(
  gateway: TikTokGateway,
  store: OperationStore,
  ctx: OperationContext,
  input: { advertiserId: string; campaignId: string; adGroupId: string; newBudget: number },
): Promise<OperationResult & { adGroup?: AdGroupModel }> {
  const [campaign, current] = await Promise.all([
    getCampaign(gateway, input.advertiserId, input.campaignId),
    getAdGroup(gateway, input.advertiserId, input.adGroupId),
  ]);
  const check = validateAdGroupBudgetChange({
    campaignBudgetOptimizeOn: campaign.budgetOptimizeOn,
    budgetMode: current.budgetMode,
    newBudget: input.newBudget,
  });
  if (!check.ok) throw new TikTokError("INVALID_BUDGET", check.error ?? "Invalid budget.");
  const budgetMode = current.budgetMode as string;

  let latest: AdGroupModel | undefined;
  const result = await runOperation(store, ctx, {
    action: "Ad Group Budget Changed",
    failureLabel: "Ad group budget change",
    resourceType: "adgroup",
    resourceId: input.adGroupId,
    resourceName: current.name,
    advertiserId: input.advertiserId,
    requestedData: { budget: input.newBudget, budgetMode },
    before: { budget: current.budget, budgetMode },
    execute: () =>
      updateAdGroupBudget(gateway, {
        advertiserId: input.advertiserId,
        adGroupId: input.adGroupId,
        budgetMode,
        newBudget: input.newBudget,
      }),
    async verify({ scheduled }) {
      latest = await getAdGroup(gateway, input.advertiserId, input.adGroupId);
      const after = { budget: latest.budget, scheduledBudget: latest.scheduledBudget, budgetMode: latest.budgetMode };
      if (sameAmount(latest.budget, input.newBudget)) {
        return { ok: true, after, message: "Ad group budget updated and confirmed with TikTok." };
      }
      if (scheduled && sameAmount(latest.scheduledBudget, input.newBudget)) {
        return {
          ok: true,
          after,
          message: `TikTok scheduled the new ${budgetModeLabel(budgetMode).toLowerCase()} budget. It takes effect at about 00:00 in the ad account's time zone; until then the current budget stays ${latest.budget ?? "unchanged"}.`,
        };
      }
      return {
        ok: false,
        after,
        message: scheduled
          ? "TikTok accepted the request, but the ad group does not show the new budget yet. Daily budget changes are scheduled for about 00:00 in the ad account's time zone, so check again after that."
          : `TikTok accepted the request, but the ad group budget is still ${latest.budget ?? "not set"}.`,
      };
    },
  });
  return { ...result, adGroup: latest };
}

// ---------- edit ad group ----------

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && [...a].map(String).sort().join() === [...b].sort().join();

/**
 * Edits the ad group settings TikTok allows to change. adgroup_update replaces the whole
 * ad group, so the current settings are resent together with the changes, and the
 * result is checked field by field against a fresh read.
 */
export async function editAdGroup(
  gateway: TikTokGateway,
  store: OperationStore,
  ctx: OperationContext,
  input: { advertiserId: string; campaignId: string; adGroupId: string; changes: AdGroupChanges },
): Promise<OperationResult & { adGroup?: AdGroupModel }> {
  const { advertiserId, adGroupId, changes } = input;
  const [campaign, current] = await Promise.all([
    getCampaign(gateway, advertiserId, input.campaignId),
    getAdGroup(gateway, advertiserId, adGroupId),
  ]);
  if (isUpgradedSmartPlus(campaign.automationType)) {
    throw new TikTokError("INVALID_REQUEST", "Editing ad groups of automatic (Smart+) campaigns is not available in this panel yet.");
  }
  if (Object.values(changes).every((value) => value === undefined)) {
    throw new TikTokError("INVALID_REQUEST", "Nothing was changed.");
  }
  if (changes.name !== undefined && !changes.name.trim()) throw new TikTokError("INVALID_REQUEST", "Ad group name cannot be empty.");
  if (changes.locationIds !== undefined && changes.locationIds.length === 0) {
    throw new TikTokError("INVALID_REQUEST", "An ad group needs at least one location.");
  }
  if (changes.bidAmount !== undefined) {
    if (current.bidStrategy !== "BID_TYPE_CUSTOM") {
      throw new TikTokError("INVALID_REQUEST", "This ad group does not use a cost cap, so there is no bid to change.");
    }
    if (!(changes.bidAmount > 0)) throw new TikTokError("INVALID_REQUEST", "Enter a cost cap greater than 0.");
  }

  const raw = current.raw;
  const before: Record<string, unknown> = {};
  const expectations: { label: string; check: (after: AdGroupModel) => boolean }[] = [];
  const track = (label: string, key: string, check: (after: AdGroupModel) => boolean) => {
    before[label] = raw[key] ?? null;
    expectations.push({ label, check });
  };
  if (changes.name !== undefined) track("name", "adgroup_name", (a) => a.name === changes.name);
  const lists: [keyof AdGroupChanges, string, string][] = [
    ["locationIds", "locations", "location_ids"],
    ["ageGroups", "ages", "age_groups"],
    ["languages", "languages", "languages"],
    ["operatingSystems", "device OS", "operating_systems"],
    ["interestCategoryIds", "interests", "interest_category_ids"],
    ["audienceIds", "audiences", "audience_ids"],
    ["excludedAudienceIds", "excluded audiences", "excluded_audience_ids"],
  ];
  for (const [field, label, key] of lists) {
    const wanted = changes[field] as string[] | undefined;
    if (wanted !== undefined) track(label, key, (a) => sameList(a.raw[key] ?? [], wanted));
  }
  if (changes.gender !== undefined) track("gender", "gender", (a) => a.raw.gender === changes.gender);
  if (changes.bidAmount !== undefined) {
    const key = Number(raw.conversion_bid_price) > 0 ? "conversion_bid_price" : "bid_price";
    track("cost cap", key, (a) => Math.abs(Number(a.raw[key]) - (changes.bidAmount as number)) < 0.005);
  }
  if (changes.scheduleEndTime !== undefined) {
    track("end time", "schedule_end_time", (a) => a.raw.schedule_end_time === changes.scheduleEndTime);
  }

  let latest: AdGroupModel | undefined;
  const result = await runOperation(store, ctx, {
    action: "Ad Group Edited",
    failureLabel: "Ad group edit",
    resourceType: "adgroup",
    resourceId: adGroupId,
    resourceName: current.name,
    advertiserId,
    requestedData: changes,
    before,
    execute: () => updateAdGroup(gateway, advertiserId, current, changes, campaign.budgetOptimizeOn === true),
    async verify() {
      latest = await getAdGroup(gateway, advertiserId, adGroupId);
      const checked = latest;
      const failed = expectations.filter((e) => !e.check(checked)).map((e) => e.label);
      const after: Record<string, unknown> = { name: latest.name };
      for (const label of Object.keys(before)) {
        const expectation = lists.find(([, l]) => l === label);
        if (expectation) after[label] = latest.raw[expectation[2]] ?? null;
      }
      if (changes.gender !== undefined) after.gender = latest.raw.gender ?? null;
      if (changes.bidAmount !== undefined) after["cost cap"] = latest.raw.conversion_bid_price ?? latest.raw.bid_price ?? null;
      if (changes.scheduleEndTime !== undefined) after["end time"] = latest.raw.schedule_end_time ?? null;
      if (failed.length) {
        return {
          ok: false,
          after,
          resourceName: latest.name,
          message: `TikTok accepted the request, but these settings do not show the new value: ${failed.join(", ")}.`,
        };
      }
      return { ok: true, after, resourceName: latest.name, message: "Ad group updated and confirmed with TikTok." };
    },
  });
  return { ...result, adGroup: latest };
}

// ---------- create (always paused) ----------

export interface CreationOutcome extends OperationResult {
  campaign?: CampaignModel;
  adGroups?: AdGroupModel[];
  ads?: AdModel[];
}

/**
 * Creates campaign → ad group → ad with the campaign paused, then re-reads everything
 * from TikTok. Nothing is ever enabled here: launching is a separate, explicit action.
 * If a step fails, whatever was created stays paused and is reported to the user.
 */
export async function createCampaignPaused(
  gateway: TikTokGateway,
  store: OperationStore,
  ctx: OperationContext,
  plan: CreationPlan,
): Promise<CreationOutcome> {
  const { advertiserId } = plan;
  const created: CreatedIds = {};
  const outcome: Pick<CreationOutcome, "campaign" | "adGroups" | "ads"> = {};
  const automationType = plan.mode === "AUTOMATIC" ? "UPGRADED_SMART_PLUS" : null;

  const result = await runOperation(store, ctx, {
    action: "Campaign Created",
    failureLabel: "Campaign creation",
    resourceType: "campaign",
    resourceName: plan.campaignName,
    advertiserId,
    requestedData: plan,
    execute: () => executeCreationPlan(gateway, plan, created),
    failureNote() {
      if (!created.campaignId) return undefined;
      const parts = [`campaign ${created.campaignId}`];
      if (created.adGroupId) parts.push(`ad group ${created.adGroupId}`);
      if (created.adId) parts.push(`ad ${created.adId}`);
      return `Already created on TikTok and left in place: ${parts.join(", ")}. The campaign was created paused, so nothing is delivering.`;
    },
    async verify() {
      const campaignId = created.campaignId as string;
      const campaign = await getCampaign(gateway, advertiserId, campaignId);
      const adGroups = await listAdGroups(gateway, advertiserId, { campaignIds: [campaignId], automationType });
      const ads = await listAds(gateway, advertiserId, { campaignIds: [campaignId], automationType });
      Object.assign(outcome, { campaign, adGroups, ads });

      const after = {
        campaignId,
        ...campaignSnapshot(campaign),
        adGroups: adGroups.map((g) => ({ id: g.externalAdGroupId, name: g.name, status: g.status })),
        ads: ads.map((a) => ({ id: a.externalAdId, name: a.name, status: a.status })),
      };
      const base = { after, resourceId: campaignId, resourceName: campaign.name };

      const problems: string[] = [];
      if (!adGroups.some((g) => g.externalAdGroupId === created.adGroupId)) problems.push("the ad group is missing");
      if (created.adId && ads.length === 0) problems.push("the ad is missing");
      if (campaign.operationStatus !== "DISABLE") problems.push(`the campaign is ${statusLabel(campaign)} instead of paused`);
      if (problems.length) {
        return { ...base, ok: false, message: `The campaign was created, but TikTok reports that ${problems.join(" and ")}.` };
      }
      return {
        ...base,
        ok: true,
        message: `Campaign created and paused. TikTok reports it as ${statusLabel(campaign)}. Nothing is delivering or spending until you launch it.`,
      };
    },
  });
  return { ...result, ...outcome };
}
