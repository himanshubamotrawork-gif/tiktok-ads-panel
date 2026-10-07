// The wizard's form model and its translation into MCP tool arguments. The UI only ever
// produces a CampaignDraft; this module is the one place that knows which MCP parameter
// each choice becomes, for both manual and automatic (Upgraded Smart+) campaigns.

import { getCampaignType, type CampaignTypeConfig, type DestinationConfig, type OptimizationConfig } from "./tiktok.capabilities";

export interface AudienceDraft {
  /** AUTOMATIC is only valid for Smart+ types: TikTok finds the audience. */
  mode: "CUSTOM" | "AUTOMATIC";
  locationIds: string[];
  ageGroups: string[];
  smartAge: "OVER_EIGHTEEN" | "OVER_TWENTY_FIVE";
  gender: "GENDER_UNLIMITED" | "GENDER_FEMALE" | "GENDER_MALE";
  languages: string[];
  os: "" | "ANDROID" | "IOS";
  interestCategoryIds: string[];
  audienceIds: string[];
  excludedAudienceIds: string[];
}

export interface CreativeDraft {
  adName: string;
  source: "SPARK_CODE" | "SPARK_POST" | "LIBRARY_VIDEO";
  identityType: "CUSTOMIZED_USER" | "AUTH_CODE" | "TT_USER" | "BC_AUTH_TT";
  identityId: string;
  identityAuthorizedBcId?: string;
  tiktokItemId?: string;
  videoId?: string;
  coverImageId?: string;
  adText?: string;
}

export interface CampaignDraft {
  advertiserId: string;
  typeId: string;
  name: string;
  adGroupName: string;
  destinationId: string;
  optimizationGoal: string;
  audience: AudienceDraft;
  budget: { level: "CAMPAIGN" | "ADGROUP"; type: "DAILY" | "LIFETIME"; amount: number };
  schedule: { startTime: string; endTime?: string };
  bidding: {
    strategy: "BID_TYPE_NO_BID" | "BID_TYPE_CUSTOM";
    bidAmount?: number;
    pacing: "PACING_MODE_SMOOTH" | "PACING_MODE_FAST";
    frequency?: number;
    frequencySchedule?: number;
  };
  creative?: CreativeDraft;
  destination: {
    landingPageUrl?: string;
    pageId?: string;
    pixelId?: string;
    optimizationEvent?: string;
    callToAction?: string;
    ctaPortfolioId?: string;
  };
}

export interface CreationPlan {
  mode: "MANUAL" | "AUTOMATIC";
  advertiserId: string;
  campaignName: string;
  /** Arguments for campaign_create or smart_plus_campaign_create. Always paused. */
  campaign: Record<string, unknown>;
  /** Arguments for the ad group tool, without campaign_id. */
  adGroup: Record<string, unknown>;
  /** Arguments for the ad tool, without adgroup_id. Absent when no ad was configured. */
  ad?: Record<string, unknown>;
}

interface Resolved {
  type: CampaignTypeConfig;
  destination: DestinationConfig;
  optimization: OptimizationConfig;
}

function resolve(draft: CampaignDraft): Resolved | string {
  const type = getCampaignType(draft.typeId);
  if (!type) return "Choose a campaign type.";
  const destination = type.destinations.find((d) => d.id === draft.destinationId);
  if (!destination) return "Choose a destination.";
  const optimization = destination.optimizations.find((o) => o.goal === draft.optimizationGoal);
  if (!optimization) return "Choose an optimization goal.";
  return { type, destination, optimization };
}

// TikTok: at most 512 characters, no emoji.
const EMOJI = /\p{Extended_Pictographic}/u;

export function validateName(label: string, value: string): string | null {
  const name = value.trim();
  if (!name) return `Enter ${label}.`;
  if (name.length > 512) return `${label[0]?.toUpperCase()}${label.slice(1)} can be at most 512 characters.`;
  if (EMOJI.test(name)) return `TikTok does not allow emoji in ${label}.`;
  return null;
}

const isUrl = (value: string | undefined) => !!value && /^https?:\/\/\S+$/.test(value.trim());

/** Returns the first problem with the draft, or null when it can be sent to TikTok. */
export function validateDraft(draft: CampaignDraft): string | null {
  const resolved = resolve(draft);
  if (typeof resolved === "string") return resolved;
  const { type, destination, optimization } = resolved;
  const automatic = type.automation === "AUTOMATIC";

  const nameError = validateName("a campaign name", draft.name) ?? validateName("an ad group name", draft.adGroupName);
  if (nameError) return nameError;

  if (draft.audience.locationIds.length === 0) return "Select at least one location.";
  if (draft.audience.mode === "AUTOMATIC" && !automatic) return "Automatic audience is only available for automatic campaigns.";

  const { budget, schedule, bidding } = draft;
  if (!Number.isFinite(budget.amount) || budget.amount <= 0) return "Enter a budget greater than 0.";
  if (!schedule.startTime) return "Choose a start time.";
  if (schedule.endTime && schedule.endTime <= schedule.startTime) return "The end time must be after the start time.";
  if (budget.type === "LIFETIME" && !schedule.endTime) return "A lifetime budget needs an end time.";

  if (!type.bidStrategies.includes(bidding.strategy)) return "Choose a bidding strategy.";
  if (bidding.strategy === "BID_TYPE_CUSTOM") {
    if (!bidding.bidAmount || bidding.bidAmount <= 0) return "Enter a cost cap greater than 0.";
    if (bidding.bidAmount >= budget.amount) return "The cost cap must be lower than the budget.";
    if (automatic && budget.type !== "DAILY") return "For automatic campaigns, a cost cap needs a daily budget.";
  }
  if (type.frequencyCap && (bidding.frequency !== undefined || bidding.frequencySchedule !== undefined)) {
    const { frequency: f, frequencySchedule: s } = bidding;
    if (!f || !s || f < 1 || f > 1000 || s < 1 || s > 30) {
      return "A frequency cap needs 1–1000 impressions over 1–30 days.";
    }
  }

  const d = draft.destination;
  if (destination.landingPage === "required" && !isUrl(d.landingPageUrl)) {
    return "Enter a landing page URL starting with http:// or https://.";
  }
  if (destination.landingPage === "optional" && d.landingPageUrl && !isUrl(d.landingPageUrl)) {
    return "The landing page URL must start with http:// or https://.";
  }
  if (destination.fields.includes("instantForm") && !d.pageId) return "Select an Instant Form.";
  if (optimization.needsPixel && (!d.pixelId || !d.optimizationEvent)) {
    return "Select a pixel and the event to optimize for.";
  }

  const c = draft.creative;
  if (c) {
    const adNameError = validateName("an ad name", c.adName);
    if (adNameError) return adNameError;
    if (!c.identityId) return "Choose the TikTok account or Spark code for the ad.";
    if (c.source === "LIBRARY_VIDEO") {
      if (!type.creative.library) return "This campaign type only supports Spark Ads.";
      if (!c.videoId || !c.coverImageId) return "Enter the video ID and cover image ID.";
      if (!c.adText?.trim()) return "Enter ad text.";
    } else {
      if (!c.tiktokItemId) return "Choose the TikTok post for the Spark Ad.";
    }
    if (c.adText && (c.adText.length > 100 || EMOJI.test(c.adText))) return "Ad text can be at most 100 characters, without emoji.";
    if (type.cta === "PORTFOLIO" && !d.ctaPortfolioId) return "Enter the dynamic CTA portfolio ID. TikTok requires it for automatic campaigns.";
  }
  return null;
}

function requestId(): string {
  // TikTok wants the string form of a 64-bit integer.
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
}

function manualTargeting(a: AudienceDraft, type: CampaignTypeConfig): Record<string, unknown> {
  const has = (control: string) => (type.audience as string[]).includes(control);
  const out: Record<string, unknown> = { location_ids: a.locationIds };
  if (has("gender")) out.gender = a.gender;
  if (has("age") && a.ageGroups.length) out.age_groups = a.ageGroups;
  if (has("language") && a.languages.length) out.languages = a.languages;
  if (has("os") && a.os) out.operating_systems = [a.os];
  if (has("interests") && a.interestCategoryIds.length) out.interest_category_ids = a.interestCategoryIds;
  if (has("audiences") && a.audienceIds.length) out.audience_ids = a.audienceIds;
  if (has("exclusions") && a.excludedAudienceIds.length) out.excluded_audience_ids = a.excludedAudienceIds;
  return out;
}

function buildManual(draft: CampaignDraft, r: Resolved): CreationPlan {
  const { type, destination, optimization } = r;
  const { budget, schedule, bidding } = draft;
  const campaignBudget = budget.level === "CAMPAIGN";
  const budgetMode = budget.type === "LIFETIME" ? "BUDGET_MODE_TOTAL" : type.dailyBudgetMode;

  const campaign: Record<string, unknown> = {
    advertiser_id: draft.advertiserId,
    campaign_name: draft.name.trim(),
    objective_type: type.objective,
    operation_status: "DISABLE",
    ...type.campaignArgs,
    ...(campaignBudget
      ? { budget_optimize_on: true, budget_mode: budgetMode, budget: budget.amount }
      : { budget_mode: "BUDGET_MODE_INFINITE" }),
  };

  const adGroup: Record<string, unknown> = {
    advertiser_id: draft.advertiserId,
    adgroup_name: draft.adGroupName.trim(),
    placement_type: "PLACEMENT_TYPE_AUTOMATIC",
    ...manualTargeting(draft.audience, type),
    // adgroup_create requires budget fields even when the campaign budget is used; TikTok
    // then ignores them.
    budget_mode: budgetMode,
    budget: budget.amount,
    schedule_type: schedule.endTime ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW",
    schedule_start_time: schedule.startTime,
    optimization_goal: optimization.goal,
    billing_event: optimization.billingEvent,
    bid_type: bidding.strategy,
    pacing: campaignBudget ? "PACING_MODE_SMOOTH" : bidding.pacing,
    operation_status: "ENABLE",
  };
  if (schedule.endTime) adGroup.schedule_end_time = schedule.endTime;
  if (destination.promotionType) adGroup.promotion_type = destination.promotionType;
  if (destination.promotionTargetType) adGroup.promotion_target_type = destination.promotionTargetType;
  if (bidding.strategy === "BID_TYPE_CUSTOM") adGroup[optimization.bidField] = bidding.bidAmount;
  if (type.bidDisplayMode) adGroup.bid_display_mode = type.bidDisplayMode;
  if (type.frequencyCap && bidding.frequency && bidding.frequencySchedule) {
    adGroup.frequency = bidding.frequency;
    adGroup.frequency_schedule = bidding.frequencySchedule;
  }

  const plan: CreationPlan = { mode: "MANUAL", advertiserId: draft.advertiserId, campaignName: draft.name.trim(), campaign, adGroup };
  const c = draft.creative;
  if (c) {
    const d = draft.destination;
    const creative: Record<string, unknown> = {
      ad_name: c.adName.trim(),
      identity_type: c.identityType,
      identity_id: c.identityId,
      ad_format: "SINGLE_VIDEO",
      operation_status: "ENABLE",
    };
    if (c.identityAuthorizedBcId) creative.identity_authorized_bc_id = c.identityAuthorizedBcId;
    if (c.source === "LIBRARY_VIDEO") {
      creative.video_id = c.videoId;
      creative.image_ids = [c.coverImageId];
    } else {
      creative.tiktok_item_id = c.tiktokItemId;
    }
    if (c.adText?.trim()) creative.ad_text = c.adText.trim();
    if (destination.landingPage !== "none" && d.landingPageUrl?.trim()) creative.landing_page_url = d.landingPageUrl.trim();
    // ad_create takes page_id as a number.
    if (destination.fields.includes("instantForm") && d.pageId) creative.page_id = Number(d.pageId);
    if (destination.tiktokPageCategory) creative.tiktok_page_category = destination.tiktokPageCategory;
    if (type.cta === "TEXT" && d.callToAction) creative.call_to_action = d.callToAction;
    plan.ad = { advertiser_id: draft.advertiserId, creatives: [creative] };
  }
  return plan;
}

function buildAutomatic(draft: CampaignDraft, r: Resolved): CreationPlan {
  const { type, destination, optimization } = r;
  const { budget, schedule, bidding, audience: a } = draft;
  const campaignBudget = budget.level === "CAMPAIGN";
  const budgetMode = budget.type === "LIFETIME" ? "BUDGET_MODE_TOTAL" : "BUDGET_MODE_DYNAMIC_DAILY_BUDGET";

  const campaign: Record<string, unknown> = {
    advertiser_id: draft.advertiserId,
    request_id: requestId(),
    campaign_name: draft.name.trim(),
    objective_type: type.objective,
    operation_status: "DISABLE",
    ...type.campaignArgs,
    budget_optimize_on: campaignBudget,
    ...(campaignBudget ? { budget_mode: budgetMode, budget: budget.amount } : { budget_mode: "BUDGET_MODE_INFINITE" }),
  };

  const automaticAudience = a.mode === "AUTOMATIC";
  const targeting: Record<string, unknown> = { location_ids: a.locationIds };
  if (a.languages.length) targeting.languages = a.languages;
  if (a.os) targeting.operating_systems = [a.os];
  if (a.excludedAudienceIds.length) targeting.excluded_audience_ids = a.excludedAudienceIds;
  if (automaticAudience) {
    targeting.spc_audience_age = a.smartAge;
  } else {
    targeting.gender = a.gender;
    if (a.ageGroups.length) targeting.age_groups = a.ageGroups;
    if (a.interestCategoryIds.length) targeting.interest_category_ids = a.interestCategoryIds;
    if (a.audienceIds.length) targeting.audience_ids = a.audienceIds;
  }

  const d = draft.destination;
  const adGroup: Record<string, unknown> = {
    advertiser_id: draft.advertiserId,
    request_id: requestId(),
    adgroup_name: draft.adGroupName.trim(),
    promotion_type: destination.promotionType,
    optimization_goal: optimization.goal,
    billing_event: optimization.billingEvent,
    bid_type: bidding.strategy,
    targeting_optimization_mode: automaticAudience ? "AUTOMATIC" : "MANUAL",
    targeting_spec: targeting,
    schedule_type: schedule.endTime ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW",
    schedule_start_time: schedule.startTime,
    // Ad group and ad are created enabled under a paused campaign, so nothing delivers
    // until the campaign itself is enabled.
    operation_status: "ENABLE",
  };
  if (schedule.endTime) adGroup.schedule_end_time = schedule.endTime;
  if (destination.promotionTargetType) adGroup.promotion_target_type = destination.promotionTargetType;
  if (!campaignBudget) {
    adGroup.budget_mode = budgetMode;
    adGroup.budget = budget.amount;
  }
  if (bidding.strategy === "BID_TYPE_CUSTOM") adGroup[optimization.bidField] = bidding.bidAmount;
  if (optimization.needsPixel) {
    adGroup.pixel_id = d.pixelId;
    adGroup.optimization_event = d.optimizationEvent;
  }

  const plan: CreationPlan = { mode: "AUTOMATIC", advertiserId: draft.advertiserId, campaignName: draft.name.trim(), campaign, adGroup };
  const c = draft.creative;
  if (c) {
    const creativeInfo: Record<string, unknown> = {
      ad_format: "SINGLE_VIDEO",
      identity_type: c.identityType,
      identity_id: c.identityId,
      tiktok_item_id: c.tiktokItemId,
    };
    if (c.identityAuthorizedBcId) creativeInfo.identity_authorized_bc_id = c.identityAuthorizedBcId;
    const ad: Record<string, unknown> = {
      advertiser_id: draft.advertiserId,
      ad_name: c.adName.trim(),
      creative_list: [{ creative_info: creativeInfo }],
      ad_configuration: { call_to_action_id: d.ctaPortfolioId },
      operation_status: "ENABLE",
    };
    if (destination.landingPage !== "none" && d.landingPageUrl?.trim()) {
      ad.landing_page_url_list = [{ landing_page_url: d.landingPageUrl.trim() }];
    }
    if (destination.fields.includes("instantForm") && d.pageId) ad.page_list = [{ page_id: d.pageId }];
    plan.ad = ad;
  }
  return plan;
}

/** Translates a validated draft into MCP arguments. Throws if the draft is invalid. */
export function buildPlan(draft: CampaignDraft): CreationPlan {
  const problem = validateDraft(draft);
  if (problem) throw new Error(problem);
  const resolved = resolve(draft) as Resolved;
  return resolved.type.automation === "AUTOMATIC" ? buildAutomatic(draft, resolved) : buildManual(draft, resolved);
}
