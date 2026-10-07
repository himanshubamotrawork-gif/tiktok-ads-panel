// What the create-campaign wizard can build, per campaign type. This is the single place
// that says which controls a campaign type gets; the wizard renders from it and the
// server builds MCP arguments from it. Everything here traces to an MCP tool definition:
// see docs/tiktok-campaign-capability-matrix.md.

export type Automation = "MANUAL" | "AUTOMATIC";

export type AudienceControl =
  | "geo"
  | "age"
  | "smartAge"
  | "gender"
  | "language"
  | "os"
  | "interests"
  | "audiences"
  | "exclusions";

export type DestinationField = "landingPageUrl" | "instantForm" | "pixel";

export interface OptimizationConfig {
  goal: string;
  label: string;
  billingEvent: string;
  /** Which bid parameter a cost cap uses for this goal. */
  bidField: "bid_price" | "conversion_bid_price";
  bidLabel: string;
  needsPixel?: boolean;
}

export interface DestinationConfig {
  id: string;
  label: string;
  description: string;
  promotionType?: string;
  promotionTargetType?: "INSTANT_PAGE" | "EXTERNAL_WEBSITE";
  fields: DestinationField[];
  /** Whether a landing page URL is required, optional or not used. */
  landingPage: "required" | "optional" | "none";
  tiktokPageCategory?: "PROFILE_PAGE";
  optimizations: OptimizationConfig[];
}

export interface CampaignTypeConfig {
  id: string;
  group: string;
  label: string;
  automation: Automation;
  objective: string;
  description: string;
  /** Extra campaign-level arguments, e.g. the sales destination. */
  campaignArgs?: Record<string, unknown>;
  destinations: DestinationConfig[];
  /** Controls for custom targeting. */
  audience: AudienceControl[];
  /** Smart+ only: controls honoured when TikTok finds the audience automatically. */
  automaticAudience?: AudienceControl[];
  /** MCP budget mode used for a daily budget on this type. */
  dailyBudgetMode: "BUDGET_MODE_DAY" | "BUDGET_MODE_DYNAMIC_DAILY_BUDGET";
  /** Whether campaign budget optimization is on by default. */
  campaignBudgetDefault: boolean;
  bidStrategies: ("BID_TYPE_NO_BID" | "BID_TYPE_CUSTOM")[];
  pacing: boolean;
  frequencyCap: boolean;
  bidDisplayMode?: string;
  creative: { spark: boolean; library: boolean };
  /** TEXT: a standard CTA value. PORTFOLIO: a dynamic CTA portfolio ID (required). */
  cta: "TEXT" | "PORTFOLIO" | "NONE";
}

const CLICK: OptimizationConfig = {
  goal: "CLICK",
  label: "Clicks",
  billingEvent: "CPC",
  bidField: "bid_price",
  bidLabel: "Target cost per click",
};
const LANDING_VIEW: OptimizationConfig = {
  goal: "TRAFFIC_LANDING_PAGE_VIEW",
  label: "Landing page views",
  billingEvent: "OCPM",
  bidField: "conversion_bid_price",
  bidLabel: "Target cost per landing page view",
};
const LEADS: OptimizationConfig = {
  goal: "LEAD_GENERATION",
  label: "Leads",
  billingEvent: "OCPM",
  bidField: "conversion_bid_price",
  bidLabel: "Target cost per lead",
};
const CONVERSIONS: OptimizationConfig = {
  goal: "CONVERT",
  label: "Conversions (pixel event)",
  billingEvent: "OCPM",
  bidField: "conversion_bid_price",
  bidLabel: "Target cost per conversion",
  needsPixel: true,
};

const WEBSITE = (optimizations: OptimizationConfig[]): DestinationConfig => ({
  id: "WEBSITE",
  label: "Landing page",
  description: "Send people to a page on your website.",
  promotionType: "WEBSITE",
  fields: ["landingPageUrl"],
  landingPage: "required",
  optimizations,
});

const INSTANT_FORM: DestinationConfig = {
  id: "INSTANT_FORM",
  label: "Instant Form",
  description: "Collect leads in a form that opens inside TikTok.",
  promotionType: "LEAD_GENERATION",
  promotionTargetType: "INSTANT_PAGE",
  fields: ["instantForm"],
  landingPage: "none",
  optimizations: [LEADS],
};

const WEBSITE_FORM = (optimizations: OptimizationConfig[]): DestinationConfig => ({
  id: "WEBSITE_FORM",
  label: "Website form",
  description: "Send people to a lead form on your own website.",
  promotionType: "LEAD_GENERATION",
  promotionTargetType: "EXTERNAL_WEBSITE",
  fields: ["landingPageUrl"],
  landingPage: "required",
  optimizations,
});

const FULL_AUDIENCE: AudienceControl[] = ["geo", "age", "gender", "language", "os", "interests", "audiences", "exclusions"];
const SMART_AUDIENCE: AudienceControl[] = ["geo", "smartAge", "language", "os", "exclusions"];
const BOTH_BIDS: CampaignTypeConfig["bidStrategies"] = ["BID_TYPE_NO_BID", "BID_TYPE_CUSTOM"];

export const CAMPAIGN_TYPES: CampaignTypeConfig[] = [
  {
    id: "LEAD_GENERATION:MANUAL",
    group: "Lead generation",
    label: "Manual",
    automation: "MANUAL",
    objective: "LEAD_GENERATION",
    description: "You choose the audience, bidding and placements yourself.",
    destinations: [INSTANT_FORM, WEBSITE_FORM([CLICK])],
    audience: FULL_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: false,
    creative: { spark: true, library: true },
    cta: "TEXT",
  },
  {
    id: "LEAD_GENERATION:AUTOMATIC",
    group: "Lead generation",
    label: "Automatic",
    automation: "AUTOMATIC",
    objective: "LEAD_GENERATION",
    description: "TikTok's Smart+ automation finds the audience and tests your creatives for you.",
    destinations: [INSTANT_FORM, WEBSITE_FORM([CONVERSIONS, CLICK])],
    audience: FULL_AUDIENCE,
    automaticAudience: SMART_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
    campaignBudgetDefault: true,
    bidStrategies: BOTH_BIDS,
    pacing: false,
    frequencyCap: false,
    creative: { spark: true, library: false },
    cta: "PORTFOLIO",
  },
  {
    id: "WEB_CONVERSIONS:MANUAL",
    group: "Sales",
    label: "Manual",
    automation: "MANUAL",
    objective: "WEB_CONVERSIONS",
    description: "Website sales where you choose the audience and bidding yourself.",
    destinations: [WEBSITE([CLICK, LANDING_VIEW])],
    audience: FULL_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: false,
    creative: { spark: true, library: true },
    cta: "TEXT",
  },
  {
    id: "WEB_CONVERSIONS:AUTOMATIC",
    group: "Sales",
    label: "Automatic",
    automation: "AUTOMATIC",
    objective: "WEB_CONVERSIONS",
    description: "Website sales run by TikTok's Smart+ automation, optimized for a pixel event.",
    campaignArgs: { sales_destination: "WEBSITE" },
    destinations: [WEBSITE([CONVERSIONS, CLICK, LANDING_VIEW])],
    audience: FULL_AUDIENCE,
    automaticAudience: SMART_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
    campaignBudgetDefault: true,
    bidStrategies: BOTH_BIDS,
    pacing: false,
    frequencyCap: false,
    creative: { spark: true, library: false },
    cta: "PORTFOLIO",
  },
  {
    id: "TRAFFIC:MANUAL",
    group: "Traffic",
    label: "Traffic",
    automation: "MANUAL",
    objective: "TRAFFIC",
    description: "Send people to your website.",
    destinations: [WEBSITE([CLICK, LANDING_VIEW])],
    audience: FULL_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: false,
    creative: { spark: true, library: true },
    cta: "TEXT",
  },
  {
    id: "REACH:MANUAL",
    group: "Reach",
    label: "Reach",
    automation: "MANUAL",
    objective: "REACH",
    description: "Show your ad to as many people as possible.",
    destinations: [
      {
        id: "NONE",
        label: "No destination",
        description: "The ad plays without sending people anywhere. A landing page is optional.",
        fields: ["landingPageUrl"],
        landingPage: "optional",
        optimizations: [
          { goal: "REACH", label: "Reach", billingEvent: "CPM", bidField: "bid_price", bidLabel: "Target cost per 1,000 impressions" },
        ],
      },
    ],
    audience: ["geo", "age", "gender", "language", "os", "interests", "audiences", "exclusions"],
    dailyBudgetMode: "BUDGET_MODE_DAY",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: true,
    creative: { spark: true, library: true },
    cta: "TEXT",
  },
  {
    id: "VIDEO_VIEWS:MANUAL",
    group: "Video views",
    label: "Video views",
    automation: "MANUAL",
    objective: "VIDEO_VIEWS",
    description: "Get more people to watch your video.",
    destinations: [
      {
        id: "NONE",
        label: "No destination",
        description: "The ad plays without sending people anywhere. A landing page is optional.",
        fields: ["landingPageUrl"],
        landingPage: "optional",
        optimizations: [
          { goal: "ENGAGED_VIEW", label: "6-second views", billingEvent: "CPV", bidField: "bid_price", bidLabel: "Target cost per view" },
          { goal: "ENGAGED_VIEW_FIFTEEN", label: "15-second views", billingEvent: "CPV", bidField: "bid_price", bidLabel: "Target cost per view" },
        ],
      },
    ],
    audience: FULL_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DAY",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: false,
    bidDisplayMode: "CPV",
    creative: { spark: true, library: true },
    cta: "TEXT",
  },
  {
    id: "ENGAGEMENT:MANUAL",
    group: "Community interaction",
    label: "Community interaction",
    automation: "MANUAL",
    objective: "ENGAGEMENT",
    description: "Grow followers or profile visits for a TikTok account.",
    destinations: [
      {
        id: "PROFILE",
        label: "TikTok profile",
        description: "Send people to the TikTok account the ad runs as.",
        promotionType: "EXTERNAL_OR_DISPLAY",
        fields: [],
        landingPage: "none",
        tiktokPageCategory: "PROFILE_PAGE",
        optimizations: [
          { goal: "FOLLOWERS", label: "Followers", billingEvent: "OCPM", bidField: "conversion_bid_price", bidLabel: "Target cost per follower" },
          { goal: "PAGE_VISIT", label: "Profile visits", billingEvent: "OCPM", bidField: "conversion_bid_price", bidLabel: "Target cost per visit" },
        ],
      },
    ],
    audience: FULL_AUDIENCE,
    dailyBudgetMode: "BUDGET_MODE_DAY",
    campaignBudgetDefault: false,
    bidStrategies: BOTH_BIDS,
    pacing: true,
    frequencyCap: false,
    creative: { spark: true, library: false },
    cta: "NONE",
  },
];

/** Campaign types the MCP defines that the wizard does not build yet. Shown as unavailable. */
export const UNBUILT_CAMPAIGN_TYPES = [
  { label: "App promotion", reason: "needs a registered app and app events" },
  { label: "Product sales (TikTok Shop or catalog)", reason: "needs a shop or catalog; allowlist-only on TikTok" },
  { label: "Sales to an app, or website and app", reason: "needs a catalog and a registered app" },
  { label: "Reach & Frequency", reason: "uses a separate reservation workflow" },
  { label: "Lead generation by message or phone call", reason: "needs a messaging account or phone setup" },
];

export const AGE_GROUPS = ["AGE_13_17", "AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55_100"] as const;

export const SMART_AGE_OPTIONS = [
  { value: "OVER_EIGHTEEN", label: "18 and over" },
  { value: "OVER_TWENTY_FIVE", label: "25 and over" },
] as const;

export const BID_STRATEGY_LABELS: Record<string, { label: string; description: string }> = {
  BID_TYPE_NO_BID: {
    label: "Maximum delivery",
    description: "TikTok spends the budget to get the most results at the lowest cost it can find.",
  },
  BID_TYPE_CUSTOM: {
    label: "Cost cap",
    description: "TikTok tries to keep the average cost per result at or below the amount you set.",
  },
};

export function getCampaignType(id: string): CampaignTypeConfig | undefined {
  return CAMPAIGN_TYPES.find((t) => t.id === id);
}

export function campaignTypeGroups(): { group: string; types: CampaignTypeConfig[] }[] {
  const groups = new Map<string, CampaignTypeConfig[]>();
  for (const type of CAMPAIGN_TYPES) groups.set(type.group, [...(groups.get(type.group) ?? []), type]);
  return [...groups.entries()].map(([group, types]) => ({ group, types }));
}

export const ageLabel = (age: string) => age.replace("AGE_", "").replace("_", "–").replace("–100", "+");
