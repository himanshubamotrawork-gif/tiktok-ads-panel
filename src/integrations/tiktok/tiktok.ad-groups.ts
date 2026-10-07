import { adGroupBudgetUpdateArgs } from "./tiktok.budget";
import { TikTokError } from "./tiktok.errors";
import { mapAdGroup } from "./tiktok.mappers";
import { fetchAllPages } from "./tiktok.service";
import type { AdGroupModel, Raw, TikTokGateway } from "./tiktok.types";

export async function listAdGroups(
  gateway: TikTokGateway,
  advertiserId: string,
  filter: { campaignIds?: string[]; adGroupIds?: string[]; automationType?: string | null },
): Promise<AdGroupModel[]> {
  const filtering: Record<string, unknown> = {};
  if (filter.campaignIds?.length) filtering.campaign_ids = filter.campaignIds;
  if (filter.adGroupIds?.length) filtering.adgroup_ids = filter.adGroupIds;
  if (filter.automationType) filtering.campaign_automation_type = filter.automationType;
  const rows = await fetchAllPages(gateway, "adgroup_get", { advertiser_id: advertiserId, filtering }, 100);
  return rows.map(mapAdGroup).filter((g): g is AdGroupModel => g !== null);
}

export async function getAdGroup(
  gateway: TikTokGateway,
  advertiserId: string,
  adGroupId: string,
): Promise<AdGroupModel> {
  const [adGroup] = await listAdGroups(gateway, advertiserId, { adGroupIds: [adGroupId] });
  if (!adGroup) {
    throw new TikTokError("TIKTOK_REJECTED", `TikTok did not return ad group ${adGroupId}.`, {
      tool: "adgroup_get",
    });
  }
  return adGroup;
}

/** Returns whether TikTok scheduled the change (daily budgets) or applied it now (lifetime). */
export async function updateAdGroupBudget(
  gateway: TikTokGateway,
  input: { advertiserId: string; adGroupId: string; budgetMode: string; newBudget: number },
): Promise<{ scheduled: boolean }> {
  const { args, scheduled } = adGroupBudgetUpdateArgs(input);
  await gateway.callTool("adgroup_budget_update", args);
  return { scheduled };
}

/** What the Edit Ad Group form can change. Everything else on an ad group is fixed or not built. */
export interface AdGroupChanges {
  name?: string;
  locationIds?: string[];
  ageGroups?: string[];
  gender?: string;
  languages?: string[];
  operatingSystems?: string[];
  interestCategoryIds?: string[];
  audienceIds?: string[];
  excludedAudienceIds?: string[];
  /** New cost cap. Only valid when the ad group already uses a cost cap. */
  bidAmount?: number;
  /** New end time (UTC, "YYYY-MM-DD HH:MM:SS"). */
  scheduleEndTime?: string;
}

// Settings adgroup_update accepts that this app resends unchanged. The tool replaces the
// whole ad group ("full-replacement update mode"), so anything left out could be reset.
const RESEND_FIELDS = [
  "adgroup_name",
  "age_groups",
  "gender",
  "languages",
  "location_ids",
  "zipcode_ids",
  "operating_systems",
  "interest_category_ids",
  "interest_keyword_ids",
  "purchase_intention_keyword_ids",
  "audience_ids",
  "excluded_audience_ids",
  "actions",
  "network_types",
  "carrier_ids",
  "device_model_ids",
  "device_price_ranges",
  "min_android_version",
  "min_ios_version",
  "household_income",
  "spending_power",
  "smart_audience_enabled",
  "smart_interest_behavior_enabled",
  "bid_price",
  "conversion_bid_price",
  "deep_bid_type",
  "deep_cpa_bid",
  "roas_bid",
  "pacing",
  "dayparting",
  "frequency",
  "frequency_schedule",
  "comment_disabled",
  "schedule_type",
  "schedule_start_time",
  "schedule_end_time",
];

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Builds the full adgroup_update payload: current settings overlaid with the changes. */
export function adGroupUpdateArgs(
  advertiserId: string,
  current: AdGroupModel,
  changes: AdGroupChanges,
  campaignBudgetOptimizeOn: boolean,
): Raw {
  const raw = current.raw;
  const args: Raw = { advertiser_id: advertiserId, adgroup_id: current.externalAdGroupId };
  for (const field of RESEND_FIELDS) if (!isEmpty(raw[field])) args[field] = raw[field];
  // Under campaign budget optimization TikTok rejects budget and bid-strategy updates.
  if (!campaignBudgetOptimizeOn) {
    if (!isEmpty(raw.budget)) args.budget = raw.budget;
    if (!isEmpty(raw.bid_type)) args.bid_type = raw.bid_type;
  }

  if (changes.name !== undefined) args.adgroup_name = changes.name;
  if (changes.locationIds !== undefined) args.location_ids = changes.locationIds;
  if (changes.ageGroups !== undefined) args.age_groups = changes.ageGroups;
  if (changes.gender !== undefined) args.gender = changes.gender;
  if (changes.languages !== undefined) args.languages = changes.languages;
  if (changes.operatingSystems !== undefined) args.operating_systems = changes.operatingSystems;
  if (changes.interestCategoryIds !== undefined) args.interest_category_ids = changes.interestCategoryIds;
  if (changes.audienceIds !== undefined) args.audience_ids = changes.audienceIds;
  if (changes.excludedAudienceIds !== undefined) args.excluded_audience_ids = changes.excludedAudienceIds;
  if (changes.bidAmount !== undefined) {
    // The ad group keeps whichever bid parameter it was created with.
    const field = !isEmpty(raw.conversion_bid_price) && Number(raw.conversion_bid_price) > 0 ? "conversion_bid_price" : "bid_price";
    args[field] = changes.bidAmount;
  }
  if (changes.scheduleEndTime !== undefined) {
    args.schedule_type = "SCHEDULE_START_END";
    args.schedule_end_time = changes.scheduleEndTime;
  }
  return args;
}

export async function updateAdGroup(
  gateway: TikTokGateway,
  advertiserId: string,
  current: AdGroupModel,
  changes: AdGroupChanges,
  campaignBudgetOptimizeOn: boolean,
): Promise<void> {
  await gateway.callTool("adgroup_update", adGroupUpdateArgs(advertiserId, current, changes, campaignBudgetOptimizeOn));
}
