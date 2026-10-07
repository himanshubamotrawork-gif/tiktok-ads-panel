import { describe, expect, it } from "vitest";
import { CAMPAIGN_TYPES, getCampaignType } from "@/integrations/tiktok/tiktok.capabilities";
import { buildPlan, validateDraft, validateName, type CampaignDraft } from "@/integrations/tiktok/tiktok.draft";
import { localInputToTikTokTime, tikTokTimeToLocalInput } from "@/lib/tiktok-time";
import { ADVERTISER, smartPlusDraft, trafficDraft } from "./helpers";

type Args = Record<string, unknown>;
const creativeOf = (plan: { ad?: Args }) => (plan.ad?.creatives as Args[])[0] as Args;

describe("capability config", () => {
  it("gives every campaign type a unique ID and at least one destination with an optimization goal", () => {
    expect(new Set(CAMPAIGN_TYPES.map((t) => t.id)).size).toBe(CAMPAIGN_TYPES.length);
    for (const type of CAMPAIGN_TYPES) {
      expect(type.destinations.length).toBeGreaterThan(0);
      for (const destination of type.destinations) expect(destination.optimizations.length).toBeGreaterThan(0);
      expect(type.bidStrategies).toContain("BID_TYPE_NO_BID");
    }
  });

  it("offers automatic (Smart+) only for the objectives the MCP defines it for", () => {
    const automatic = CAMPAIGN_TYPES.filter((t) => t.automation === "AUTOMATIC");
    expect(automatic.map((t) => t.objective).sort()).toEqual(["LEAD_GENERATION", "WEB_CONVERSIONS"]);
    for (const type of automatic) {
      expect(type.automaticAudience).toBeDefined();
      expect(type.cta).toBe("PORTFOLIO");
      expect(type.creative).toEqual({ spark: true, library: false });
      expect(type.pacing).toBe(false);
    }
  });

  it("offers conversion (pixel) optimization only on automatic types", () => {
    for (const type of CAMPAIGN_TYPES) {
      const goals = type.destinations.flatMap((d) => d.optimizations.map((o) => o.goal));
      if (type.automation === "MANUAL") expect(goals).not.toContain("CONVERT");
    }
    expect(getCampaignType("WEB_CONVERSIONS:AUTOMATIC")?.destinations[0]?.optimizations[0]).toMatchObject({ goal: "CONVERT", needsPixel: true });
  });
});

describe("draft validation", () => {
  const problem = (overrides: Partial<CampaignDraft>, base = trafficDraft) => validateDraft(base(overrides));

  it("accepts the valid drafts", () => {
    expect(validateDraft(trafficDraft())).toBeNull();
    expect(validateDraft(smartPlusDraft())).toBeNull();
  });

  it("requires a known type, destination and goal", () => {
    expect(problem({ typeId: "APP_PROMOTION:MANUAL" })).toBe("Choose a campaign type.");
    expect(problem({ destinationId: "INSTANT_FORM" })).toBe("Choose a destination.");
    expect(problem({ optimizationGoal: "CONVERT" })).toBe("Choose an optimization goal.");
  });

  it("checks names", () => {
    expect(problem({ name: "  " })).toBe("Enter a campaign name.");
    expect(problem({ adGroupName: "" })).toBe("Enter an ad group name.");
    expect(problem({ name: "Sale 🔥" })).toContain("emoji");
    expect(validateName("a campaign name", "x".repeat(513))).toContain("at most 512 characters");
  });

  it("requires a location and rejects an automatic audience on a manual type", () => {
    const base = trafficDraft();
    expect(problem({ audience: { ...base.audience, locationIds: [] } })).toBe("Select at least one location.");
    expect(problem({ audience: { ...base.audience, mode: "AUTOMATIC" } })).toContain("only available for automatic campaigns");
  });

  it("checks budget and schedule", () => {
    expect(problem({ budget: { level: "ADGROUP", type: "DAILY", amount: 0 } })).toBe("Enter a budget greater than 0.");
    expect(problem({ budget: { level: "ADGROUP", type: "DAILY", amount: Number.NaN } })).toBe("Enter a budget greater than 0.");
    expect(problem({ schedule: { startTime: "" } })).toBe("Choose a start time.");
    expect(problem({ schedule: { startTime: "2026-10-08 00:00:00", endTime: "2026-10-07 00:00:00" } })).toContain("after the start time");
    expect(problem({ budget: { level: "ADGROUP", type: "LIFETIME", amount: 500 } })).toBe("A lifetime budget needs an end time.");
  });

  it("checks a cost cap", () => {
    const pacing = "PACING_MODE_SMOOTH" as const;
    expect(problem({ bidding: { strategy: "BID_TYPE_CUSTOM", pacing } })).toBe("Enter a cost cap greater than 0.");
    expect(problem({ bidding: { strategy: "BID_TYPE_CUSTOM", bidAmount: 50, pacing } })).toBe("The cost cap must be lower than the budget.");
    expect(problem({ bidding: { strategy: "BID_TYPE_CUSTOM", bidAmount: 2, pacing } })).toBeNull();
    expect(
      problem(
        {
          budget: { level: "CAMPAIGN", type: "LIFETIME", amount: 500 },
          schedule: { startTime: "2026-10-08 00:00:00", endTime: "2026-11-08 00:00:00" },
          bidding: { strategy: "BID_TYPE_CUSTOM", bidAmount: 2, pacing },
        },
        smartPlusDraft,
      ),
    ).toBe("For automatic campaigns, a cost cap needs a daily budget.");
  });

  it("checks the destination fields the type needs", () => {
    expect(problem({ destination: {} })).toContain("Enter a landing page URL");
    expect(problem({ destination: { landingPageUrl: "example.com" } })).toContain("Enter a landing page URL");
    expect(problem({ typeId: "LEAD_GENERATION:MANUAL", destinationId: "INSTANT_FORM", optimizationGoal: "LEAD_GENERATION", destination: {} })).toBe(
      "Select an Instant Form.",
    );
    expect(problem({ destination: { landingPageUrl: "https://example.com", ctaPortfolioId: "cta9" } }, smartPlusDraft)).toBe(
      "Select a pixel and the event to optimize for.",
    );
    expect(
      problem({ typeId: "REACH:MANUAL", destinationId: "NONE", optimizationGoal: "REACH", destination: { landingPageUrl: "not a url" } }),
    ).toContain("must start with http");
  });

  it("checks a frequency cap only where the type has one", () => {
    const reach = { typeId: "REACH:MANUAL", destinationId: "NONE", optimizationGoal: "REACH", destination: {} };
    const pacing = "PACING_MODE_SMOOTH" as const;
    expect(problem({ ...reach, bidding: { strategy: "BID_TYPE_NO_BID", pacing, frequency: 3 } })).toContain("frequency cap");
    expect(problem({ ...reach, bidding: { strategy: "BID_TYPE_NO_BID", pacing, frequency: 3, frequencySchedule: 31 } })).toContain("frequency cap");
    expect(problem({ ...reach, bidding: { strategy: "BID_TYPE_NO_BID", pacing, frequency: 3, frequencySchedule: 7 } })).toBeNull();
    expect(problem({ ...reach })).toBeNull();
  });

  it("checks the creative", () => {
    const creative = trafficDraft().creative!;
    expect(problem({ creative: { ...creative, adName: "" } })).toBe("Enter an ad name.");
    expect(problem({ creative: { ...creative, identityId: "" } })).toContain("Choose the TikTok account or Spark code");
    expect(problem({ creative: { ...creative, tiktokItemId: undefined } })).toContain("Choose the TikTok post");
    expect(problem({ creative: { ...creative, adText: "x".repeat(101) } })).toContain("at most 100 characters");
    expect(problem({ creative: { ...creative, source: "LIBRARY_VIDEO", identityType: "CUSTOMIZED_USER" } })).toBe("Enter the video ID and cover image ID.");
    expect(
      problem({ creative: { ...creative, source: "LIBRARY_VIDEO", identityType: "CUSTOMIZED_USER", videoId: "v1", coverImageId: "i1" } }),
    ).toBe("Enter ad text.");
    expect(problem({ creative: { ...creative, source: "LIBRARY_VIDEO", videoId: "v1", coverImageId: "i1", adText: "Hi" } }, smartPlusDraft)).toBe(
      "This campaign type only supports Spark Ads.",
    );
    expect(problem({ destination: { ...smartPlusDraft().destination, ctaPortfolioId: undefined } }, smartPlusDraft)).toContain(
      "dynamic CTA portfolio ID",
    );
    expect(problem({ creative: undefined, destination: { ...smartPlusDraft().destination, ctaPortfolioId: undefined } }, smartPlusDraft)).toBeNull();
  });
});

describe("manual plan", () => {
  it("builds a Traffic campaign with an ad group budget", () => {
    const plan = buildPlan(trafficDraft());

    expect(plan).toMatchObject({ mode: "MANUAL", advertiserId: ADVERTISER, campaignName: "New Campaign" });
    expect(plan.campaign).toEqual({
      advertiser_id: ADVERTISER,
      campaign_name: "New Campaign",
      objective_type: "TRAFFIC",
      operation_status: "DISABLE",
      budget_mode: "BUDGET_MODE_INFINITE",
    });
    expect(plan.adGroup).toEqual({
      advertiser_id: ADVERTISER,
      adgroup_name: "Ad Group 1",
      placement_type: "PLACEMENT_TYPE_AUTOMATIC",
      location_ids: ["6252001"],
      gender: "GENDER_UNLIMITED",
      budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
      budget: 50,
      schedule_type: "SCHEDULE_FROM_NOW",
      schedule_start_time: "2026-10-08 00:00:00",
      optimization_goal: "CLICK",
      billing_event: "CPC",
      bid_type: "BID_TYPE_NO_BID",
      pacing: "PACING_MODE_SMOOTH",
      operation_status: "ENABLE",
      promotion_type: "WEBSITE",
    });
    expect(plan.ad).toEqual({
      advertiser_id: ADVERTISER,
      creatives: [
        {
          ad_name: "Ad 1",
          identity_type: "TT_USER",
          identity_id: "id1",
          ad_format: "SINGLE_VIDEO",
          operation_status: "ENABLE",
          tiktok_item_id: "7000000000000000001",
          landing_page_url: "https://example.com",
          call_to_action: "LEARN_MORE",
        },
      ],
    });
  });

  it("always creates the campaign paused", () => {
    for (const type of CAMPAIGN_TYPES) {
      const destination = type.destinations[0]!;
      const base = type.automation === "AUTOMATIC" ? smartPlusDraft() : trafficDraft();
      const plan = buildPlan({
        ...base,
        typeId: type.id,
        destinationId: destination.id,
        optimizationGoal: destination.optimizations[0]!.goal,
        creative: type.automation === "AUTOMATIC" ? base.creative : undefined,
        destination: { ...base.destination, pageId: "123", pixelId: "px1", optimizationEvent: "SHOPPING" },
      });
      expect(plan.campaign.operation_status, type.id).toBe("DISABLE");
      expect(plan.campaign.objective_type, type.id).toBe(type.objective);
    }
  });

  it("puts the budget on the campaign when campaign budget is chosen and forces standard pacing", () => {
    const plan = buildPlan(
      trafficDraft({ budget: { level: "CAMPAIGN", type: "DAILY", amount: 80 }, bidding: { strategy: "BID_TYPE_NO_BID", pacing: "PACING_MODE_FAST" } }),
    );

    expect(plan.campaign).toMatchObject({ budget_optimize_on: true, budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", budget: 80 });
    expect(plan.adGroup.pacing).toBe("PACING_MODE_SMOOTH");
  });

  it("uses a lifetime budget with a start and end time", () => {
    const plan = buildPlan(
      trafficDraft({
        budget: { level: "ADGROUP", type: "LIFETIME", amount: 500 },
        schedule: { startTime: "2026-10-08 00:00:00", endTime: "2026-11-08 00:00:00" },
      }),
    );

    expect(plan.adGroup).toMatchObject({
      budget_mode: "BUDGET_MODE_TOTAL",
      schedule_type: "SCHEDULE_START_END",
      schedule_end_time: "2026-11-08 00:00:00",
    });
  });

  it("sends a cost cap in the bid parameter that matches the goal", () => {
    const bidding = { strategy: "BID_TYPE_CUSTOM" as const, bidAmount: 2, pacing: "PACING_MODE_SMOOTH" as const };
    const click = buildPlan(trafficDraft({ bidding }));
    const landing = buildPlan(trafficDraft({ optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW", bidding }));

    expect(click.adGroup).toMatchObject({ bid_type: "BID_TYPE_CUSTOM", bid_price: 2, billing_event: "CPC" });
    expect(click.adGroup).not.toHaveProperty("conversion_bid_price");
    expect(landing.adGroup).toMatchObject({ conversion_bid_price: 2, billing_event: "OCPM" });
    expect(landing.adGroup).not.toHaveProperty("bid_price");
  });

  it("sends only the targeting that was chosen", () => {
    const base = trafficDraft();
    const plan = buildPlan(
      trafficDraft({
        audience: {
          ...base.audience,
          ageGroups: ["AGE_25_34"],
          gender: "GENDER_FEMALE",
          languages: ["en"],
          os: "IOS",
          interestCategoryIds: ["15"],
          audienceIds: ["a1"],
          excludedAudienceIds: ["a2"],
        },
      }),
    );

    expect(plan.adGroup).toMatchObject({
      age_groups: ["AGE_25_34"],
      gender: "GENDER_FEMALE",
      languages: ["en"],
      operating_systems: ["IOS"],
      interest_category_ids: ["15"],
      audience_ids: ["a1"],
      excluded_audience_ids: ["a2"],
    });
    const plain = buildPlan(trafficDraft()).adGroup;
    for (const key of ["age_groups", "languages", "operating_systems", "interest_category_ids", "audience_ids", "excluded_audience_ids"]) {
      expect(plain).not.toHaveProperty(key);
    }
  });

  it("builds Reach with a plain daily budget, CPM billing and a frequency cap", () => {
    const plan = buildPlan(
      trafficDraft({
        typeId: "REACH:MANUAL",
        destinationId: "NONE",
        optimizationGoal: "REACH",
        bidding: { strategy: "BID_TYPE_NO_BID", pacing: "PACING_MODE_SMOOTH", frequency: 3, frequencySchedule: 7 },
        destination: {},
      }),
    );

    expect(plan.adGroup).toMatchObject({ budget_mode: "BUDGET_MODE_DAY", billing_event: "CPM", frequency: 3, frequency_schedule: 7 });
    expect(plan.adGroup).not.toHaveProperty("promotion_type");
    expect(creativeOf(plan)).not.toHaveProperty("landing_page_url");
  });

  it("ignores a frequency cap on types that do not have one", () => {
    const plan = buildPlan(trafficDraft({ bidding: { strategy: "BID_TYPE_NO_BID", pacing: "PACING_MODE_SMOOTH", frequency: 3, frequencySchedule: 7 } }));
    expect(plan.adGroup).not.toHaveProperty("frequency");
  });

  it("builds Video views with CPV billing and display mode", () => {
    const plan = buildPlan(
      trafficDraft({
        typeId: "VIDEO_VIEWS:MANUAL",
        destinationId: "NONE",
        optimizationGoal: "ENGAGED_VIEW_FIFTEEN",
        bidding: { strategy: "BID_TYPE_CUSTOM", bidAmount: 0.05, pacing: "PACING_MODE_SMOOTH" },
        destination: {},
      }),
    );

    expect(plan.adGroup).toMatchObject({
      optimization_goal: "ENGAGED_VIEW_FIFTEEN",
      billing_event: "CPV",
      bid_display_mode: "CPV",
      bid_price: 0.05,
      budget_mode: "BUDGET_MODE_DAY",
    });
  });

  it("builds Community interaction towards the profile, without a landing page or CTA", () => {
    const plan = buildPlan(trafficDraft({ typeId: "ENGAGEMENT:MANUAL", destinationId: "PROFILE", optimizationGoal: "FOLLOWERS" }));

    expect(plan.adGroup).toMatchObject({ promotion_type: "EXTERNAL_OR_DISPLAY", optimization_goal: "FOLLOWERS", billing_event: "OCPM" });
    expect(creativeOf(plan)).toMatchObject({ tiktok_page_category: "PROFILE_PAGE" });
    expect(creativeOf(plan)).not.toHaveProperty("landing_page_url");
    expect(creativeOf(plan)).not.toHaveProperty("call_to_action");
  });

  it("builds manual lead generation with an Instant Form", () => {
    const plan = buildPlan(
      trafficDraft({
        typeId: "LEAD_GENERATION:MANUAL",
        destinationId: "INSTANT_FORM",
        optimizationGoal: "LEAD_GENERATION",
        destination: { pageId: "7123", landingPageUrl: "https://example.com" },
      }),
    );

    expect(plan.adGroup).toMatchObject({ promotion_type: "LEAD_GENERATION", promotion_target_type: "INSTANT_PAGE", optimization_goal: "LEAD_GENERATION" });
    expect(creativeOf(plan)).toMatchObject({ page_id: 7123 });
    expect(creativeOf(plan)).not.toHaveProperty("landing_page_url");
  });

  it("builds a library video ad with a cover image and ad text", () => {
    const plan = buildPlan(
      trafficDraft({
        creative: { adName: "Ad 1", source: "LIBRARY_VIDEO", identityType: "CUSTOMIZED_USER", identityId: "id1", videoId: "v1", coverImageId: "i1", adText: " Shop now " },
      }),
    );

    expect(creativeOf(plan)).toMatchObject({ identity_type: "CUSTOMIZED_USER", video_id: "v1", image_ids: ["i1"], ad_text: "Shop now" });
    expect(creativeOf(plan)).not.toHaveProperty("tiktok_item_id");
  });

  it("leaves the ad out when no creative is configured", () => {
    expect(buildPlan(trafficDraft({ creative: undefined })).ad).toBeUndefined();
  });

  it("refuses to build from an invalid draft", () => {
    expect(() => buildPlan(trafficDraft({ name: "" }))).toThrow("Enter a campaign name.");
  });
});

describe("automatic (Smart+) plan", () => {
  it("builds website sales with a campaign budget, automatic audience and a pixel event", () => {
    const plan = buildPlan(smartPlusDraft());

    expect(plan.mode).toBe("AUTOMATIC");
    expect(plan.campaign).toMatchObject({
      advertiser_id: ADVERTISER,
      campaign_name: "New Campaign",
      objective_type: "WEB_CONVERSIONS",
      sales_destination: "WEBSITE",
      operation_status: "DISABLE",
      budget_optimize_on: true,
      budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
      budget: 50,
    });
    expect(plan.adGroup).toMatchObject({
      promotion_type: "WEBSITE",
      optimization_goal: "CONVERT",
      billing_event: "OCPM",
      bid_type: "BID_TYPE_NO_BID",
      targeting_optimization_mode: "AUTOMATIC",
      targeting_spec: { location_ids: ["6252001"], spc_audience_age: "OVER_EIGHTEEN" },
      pixel_id: "px1",
      optimization_event: "SHOPPING",
      operation_status: "ENABLE",
    });
    // Under a campaign budget the ad group carries no budget of its own.
    expect(plan.adGroup).not.toHaveProperty("budget");
    expect(plan.adGroup).not.toHaveProperty("budget_mode");
    expect(plan.ad).toEqual({
      advertiser_id: ADVERTISER,
      ad_name: "Ad 1",
      creative_list: [{ creative_info: { ad_format: "SINGLE_VIDEO", identity_type: "AUTH_CODE", identity_id: "auth1", tiktok_item_id: "7000000000000000001" } }],
      ad_configuration: { call_to_action_id: "cta9" },
      operation_status: "ENABLE",
      landing_page_url_list: [{ landing_page_url: "https://example.com" }],
    });
  });

  it("sends a numeric request ID with the campaign and the ad group", () => {
    const plan = buildPlan(smartPlusDraft());
    expect(plan.campaign.request_id).toMatch(/^\d+$/);
    expect(plan.adGroup.request_id).toMatch(/^\d+$/);
  });

  it("sends only the settings TikTok honours for an automatic audience", () => {
    const base = smartPlusDraft();
    const plan = buildPlan(
      smartPlusDraft({
        audience: {
          ...base.audience,
          smartAge: "OVER_TWENTY_FIVE",
          ageGroups: ["AGE_25_34"],
          gender: "GENDER_FEMALE",
          languages: ["en"],
          os: "ANDROID",
          interestCategoryIds: ["15"],
          audienceIds: ["a1"],
          excludedAudienceIds: ["a2"],
        },
      }),
    );

    expect(plan.adGroup.targeting_spec).toEqual({
      location_ids: ["6252001"],
      languages: ["en"],
      operating_systems: ["ANDROID"],
      excluded_audience_ids: ["a2"],
      spc_audience_age: "OVER_TWENTY_FIVE",
    });
  });

  it("sends full targeting for a custom audience", () => {
    const base = smartPlusDraft();
    const plan = buildPlan(
      smartPlusDraft({ audience: { ...base.audience, mode: "CUSTOM", ageGroups: ["AGE_25_34"], gender: "GENDER_MALE", interestCategoryIds: ["15"], audienceIds: ["a1"] } }),
    );

    expect(plan.adGroup.targeting_optimization_mode).toBe("MANUAL");
    expect(plan.adGroup.targeting_spec).toEqual({
      location_ids: ["6252001"],
      gender: "GENDER_MALE",
      age_groups: ["AGE_25_34"],
      interest_category_ids: ["15"],
      audience_ids: ["a1"],
    });
  });

  it("puts the budget on the ad group when campaign budget is off", () => {
    const plan = buildPlan(smartPlusDraft({ budget: { level: "ADGROUP", type: "DAILY", amount: 40 } }));

    expect(plan.campaign).toMatchObject({ budget_optimize_on: false, budget_mode: "BUDGET_MODE_INFINITE" });
    expect(plan.campaign).not.toHaveProperty("budget");
    expect(plan.adGroup).toMatchObject({ budget_mode: "BUDGET_MODE_DYNAMIC_DAILY_BUDGET", budget: 40 });
  });

  it("sends a cost cap as a conversion bid", () => {
    const plan = buildPlan(smartPlusDraft({ bidding: { strategy: "BID_TYPE_CUSTOM", bidAmount: 8, pacing: "PACING_MODE_SMOOTH" } }));
    expect(plan.adGroup).toMatchObject({ bid_type: "BID_TYPE_CUSTOM", conversion_bid_price: 8 });
  });

  it("builds automatic lead generation with an Instant Form and no pixel", () => {
    const plan = buildPlan(
      smartPlusDraft({
        typeId: "LEAD_GENERATION:AUTOMATIC",
        destinationId: "INSTANT_FORM",
        optimizationGoal: "LEAD_GENERATION",
        destination: { pageId: "7123", ctaPortfolioId: "cta9" },
      }),
    );

    expect(plan.campaign).not.toHaveProperty("sales_destination");
    expect(plan.adGroup).toMatchObject({ promotion_type: "LEAD_GENERATION", promotion_target_type: "INSTANT_PAGE", optimization_goal: "LEAD_GENERATION" });
    expect(plan.adGroup).not.toHaveProperty("pixel_id");
    expect(plan.ad).toMatchObject({ page_list: [{ page_id: "7123" }] });
    expect(plan.ad).not.toHaveProperty("landing_page_url_list");
  });
});

describe("schedule time conversion", () => {
  it("converts a local date-time input to TikTok's UTC format", () => {
    const local = "2026-10-08T09:30";
    const expected = new Date(local).toISOString().slice(0, 19).replace("T", " ");
    expect(localInputToTikTokTime(local)).toBe(expected);
    expect(localInputToTikTokTime(local)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/);
  });

  it("round-trips between the two formats", () => {
    expect(tikTokTimeToLocalInput(localInputToTikTokTime("2026-10-08T09:30"))).toBe("2026-10-08T09:30");
  });

  it("returns an empty value for missing or unreadable times", () => {
    expect(localInputToTikTokTime("")).toBe("");
    expect(localInputToTikTokTime("not a date")).toBe("");
    expect(tikTokTimeToLocalInput(null)).toBe("");
    expect(tikTokTimeToLocalInput("soon")).toBe("");
  });
});
