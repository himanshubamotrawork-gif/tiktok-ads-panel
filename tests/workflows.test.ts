import { beforeEach, describe, expect, it } from "vitest";
import { buildPlan } from "@/integrations/tiktok/tiktok.draft";
import { TikTokError } from "@/integrations/tiktok/tiktok.errors";
import { BULK_CONCURRENCY, runBulk } from "@/server/operations/bulk";
import { changeAdGroupBudget, createCampaignPaused, editAdGroup, editCampaign, setCampaignDelivery } from "@/server/workflows";
import { ADVERTISER, FakeTikTok, MemoryStore, activeCampaign, ctx, smartPlusDraft, trafficDraft } from "./helpers";

let tiktok: FakeTikTok;
let store: MemoryStore;

beforeEach(() => {
  tiktok = new FakeTikTok();
  store = new MemoryStore();
});

describe("pause and resume", () => {
  it("pauses a campaign and confirms it by re-reading from TikTok", async () => {
    tiktok.addCampaign(activeCampaign());
    const result = await setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", action: "pause" });

    expect(result).toMatchObject({ ok: true, status: "SUCCEEDED" });
    expect(result.campaign).toMatchObject({ status: "PAUSED", externalStatus: "CAMPAIGN_STATUS_DISABLE" });
    expect(tiktok.toolNames()).toEqual(["campaign_get", "campaign_status_update", "campaign_get"]);
    expect(tiktok.calls[1]?.args).toEqual({ advertiser_id: ADVERTISER, campaign_ids: ["c1"], operation_status: "DISABLE" });
    expect(store.operations[0]).toMatchObject({ status: "SUCCEEDED", action: "Campaign Paused", resourceId: "c1" });
  });

  it("resumes a paused campaign", async () => {
    tiktok.addCampaign(activeCampaign({ operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE" }));
    const result = await setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", action: "resume" });

    expect(result.ok).toBe(true);
    expect(result.campaign?.status).toBe("ACTIVE");
    expect(tiktok.calls[1]?.args.operation_status).toBe("ENABLE");
    expect(store.activity[0]).toMatchObject({ action: "Campaign Resumed", result: "Success" });
  });

  it("does not report Paused when TikTok still shows the campaign active", async () => {
    tiktok.addCampaign(activeCampaign());
    tiktok.ignoreStatusUpdates = true;
    const result = await setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", action: "pause" });

    expect(result).toMatchObject({ ok: false, status: "VERIFICATION_FAILED" });
    expect(result.message).toContain("still reports this campaign as Active");
    expect(result.campaign?.status).toBe("ACTIVE");
    expect(store.operations[0]?.status).toBe("VERIFICATION_FAILED");
    expect(store.activity[0]?.result).toBe("Not verified");
  });

  it("records a failed pause with a clear message and technical details", async () => {
    tiktok.addCampaign(activeCampaign());
    tiktok.failures.set(
      "campaign_status_update",
      new TikTokError("PERMISSION_DENIED", "x", { code: 40002, tiktokMessage: "No permission to operate campaign" }),
    );
    const result = await setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", action: "pause" });

    expect(result).toMatchObject({ ok: false, status: "FAILED" });
    expect(result.message).toBe(
      "Campaign pause failed because the connected TikTok user does not have permission for this: No permission to operate campaign.",
    );
    expect(store.operations[0]?.technicalError).toContain("40002");
    expect(store.activity[0]).toMatchObject({ result: "Failed", action: "Campaign Paused" });
  });

  it("reports unconfirmed when the follow-up read fails", async () => {
    tiktok.addCampaign(activeCampaign());
    let reads = 0;
    const original = tiktok.callTool.bind(tiktok);
    tiktok.callTool = async (name, args) => {
      if (name === "campaign_get" && ++reads === 2) throw new TikTokError("TIMEOUT", "TikTok did not respond in time.");
      return original(name, args);
    };
    const result = await setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", action: "pause" });

    expect(result.status).toBe("VERIFICATION_FAILED");
    expect(result.message).toContain("could not be confirmed");
  });
});

describe("edit campaign", () => {
  it("changes name and budget and logs exactly what changed", async () => {
    tiktok.addCampaign(activeCampaign());
    const result = await editCampaign(tiktok, store, ctx, {
      advertiserId: ADVERTISER,
      campaignId: "c1",
      name: "Test Campaign — Scale",
      budget: 100,
    });

    expect(result.ok).toBe(true);
    const update = tiktok.calls.find((c) => c.name === "campaign_update");
    expect(update?.args).toEqual({ advertiser_id: ADVERTISER, campaign_id: "c1", campaign_name: "Test Campaign — Scale", budget: 100 });
    expect(store.activity[0]).toMatchObject({
      action: "Campaign Edited",
      before: { name: "Test Campaign", budget: 50, budgetMode: "BUDGET_MODE_DAY" },
      after: { name: "Test Campaign — Scale", budget: 100, budgetMode: "BUDGET_MODE_DAY" },
      result: "Success",
      userName: "Himanshu",
    });
  });

  it("sends only the fields that changed and labels a budget-only change", async () => {
    tiktok.addCampaign(activeCampaign());
    await editCampaign(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", name: "Test Campaign", budget: 80 });

    const update = tiktok.calls.find((c) => c.name === "campaign_update");
    expect(update?.args).toEqual({ advertiser_id: ADVERTISER, campaign_id: "c1", budget: 80 });
    expect(store.activity[0]?.action).toBe("Campaign Budget Changed");
  });

  it("rejects a budget below 105% of spend before calling TikTok", async () => {
    tiktok.addCampaign(activeCampaign());
    tiktok.spend.set("c1", 100);
    await expect(editCampaign(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", budget: 101 })).rejects.toMatchObject({
      kind: "INVALID_BUDGET",
    });
    expect(tiktok.toolNames()).not.toContain("campaign_update");
    expect(store.operations).toHaveLength(0);
  });

  it("rejects a budget on a campaign with no campaign-level budget", async () => {
    tiktok.addCampaign(activeCampaign({ budget_mode: "BUDGET_MODE_INFINITE", budget: 0, budget_optimize_on: false }));
    await expect(editCampaign(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", budget: 100 })).rejects.toMatchObject({
      kind: "INVALID_BUDGET",
    });
  });

  it("rejects an edit with no changes", async () => {
    tiktok.addCampaign(activeCampaign());
    await expect(editCampaign(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", name: "Test Campaign" })).rejects.toThrow(
      "Nothing was changed",
    );
  });
});

describe("ad group budget", () => {
  const group = (overrides = {}) => ({
    adgroup_id: "g1",
    campaign_id: "c1",
    adgroup_name: "Ad Group A",
    budget_mode: "BUDGET_MODE_TOTAL",
    budget: 500,
    operation_status: "ENABLE",
    secondary_status: "ADGROUP_STATUS_DELIVERY_OK",
    ...overrides,
  });

  it("updates a lifetime budget immediately and confirms it", async () => {
    tiktok.addCampaign(activeCampaign({ budget_optimize_on: false, budget_mode: "BUDGET_MODE_INFINITE" }));
    tiktok.addAdGroup(group());
    const result = await changeAdGroupBudget(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", adGroupId: "g1", newBudget: 700 });

    expect(result.ok).toBe(true);
    expect(result.adGroup?.budget).toBe(700);
    expect(store.activity[0]).toMatchObject({
      action: "Ad Group Budget Changed",
      before: { budget: 500, budgetMode: "BUDGET_MODE_TOTAL" },
      result: "Success",
    });
  });

  it("reports a daily budget change as scheduled, not as applied", async () => {
    tiktok.addCampaign(activeCampaign({ budget_optimize_on: false, budget_mode: "BUDGET_MODE_INFINITE" }));
    tiktok.addAdGroup(group({ budget_mode: "BUDGET_MODE_DAY", budget: 30 }));
    const result = await changeAdGroupBudget(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", adGroupId: "g1", newBudget: 70 });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("scheduled");
    expect(result.adGroup).toMatchObject({ budget: 30, scheduledBudget: 70 });
  });

  it("refuses to edit ad group budgets under campaign budget optimization", async () => {
    tiktok.addCampaign(activeCampaign({ budget_optimize_on: true }));
    tiktok.addAdGroup(group());
    await expect(
      changeAdGroupBudget(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", adGroupId: "g1", newBudget: 700 }),
    ).rejects.toMatchObject({ kind: "INVALID_BUDGET" });
    expect(tiktok.toolNames()).not.toContain("adgroup_budget_update");
  });
});

describe("edit ad group", () => {
  const group = (overrides = {}) => ({
    adgroup_id: "g1",
    campaign_id: "c1",
    adgroup_name: "Ad Group A",
    location_ids: ["6252001"],
    gender: "GENDER_UNLIMITED",
    languages: [],
    budget_mode: "BUDGET_MODE_DAY",
    budget: 50,
    bid_type: "BID_TYPE_CUSTOM",
    bid_price: 0.5,
    pacing: "PACING_MODE_SMOOTH",
    schedule_type: "SCHEDULE_FROM_NOW",
    schedule_start_time: "2026-10-01 00:00:00",
    operation_status: "ENABLE",
    secondary_status: "ADGROUP_STATUS_DELIVERY_OK",
    ...overrides,
  });
  const manualCampaign = (overrides = {}) => activeCampaign({ budget_optimize_on: false, budget_mode: "BUDGET_MODE_INFINITE", ...overrides });
  const edit = (changes: Parameters<typeof editAdGroup>[3]["changes"]) =>
    editAdGroup(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId: "c1", adGroupId: "g1", changes });

  it("resends the current settings with the changes and confirms each one", async () => {
    tiktok.addCampaign(manualCampaign());
    tiktok.addAdGroup(group());
    const result = await edit({ name: "Renamed", locationIds: ["6252001", "2635167"], gender: "GENDER_FEMALE", bidAmount: 0.8 });

    expect(tiktok.toolNames()).toEqual(["campaign_get", "adgroup_get", "adgroup_update", "adgroup_get"]);
    expect(tiktok.calls[2]?.args).toEqual({
      advertiser_id: ADVERTISER,
      adgroup_id: "g1",
      adgroup_name: "Renamed",
      location_ids: ["6252001", "2635167"],
      gender: "GENDER_FEMALE",
      bid_price: 0.8,
      pacing: "PACING_MODE_SMOOTH",
      schedule_type: "SCHEDULE_FROM_NOW",
      schedule_start_time: "2026-10-01 00:00:00",
      budget: 50,
      bid_type: "BID_TYPE_CUSTOM",
    });
    expect(result).toMatchObject({ ok: true, status: "SUCCEEDED" });
    expect(result.adGroup?.name).toBe("Renamed");
    expect(store.activity[0]).toMatchObject({
      action: "Ad Group Edited",
      result: "Success",
      before: { name: "Ad Group A", locations: ["6252001"], gender: "GENDER_UNLIMITED", "cost cap": 0.5 },
    });
  });

  it("keeps the bid parameter the ad group was created with", async () => {
    tiktok.addCampaign(manualCampaign());
    tiktok.addAdGroup(group({ bid_price: 0, conversion_bid_price: 4 }));
    await edit({ bidAmount: 5 });

    expect(tiktok.calls[2]?.args).toMatchObject({ conversion_bid_price: 5 });
  });

  it("leaves budget and bid strategy out under campaign budget optimization", async () => {
    tiktok.addCampaign(activeCampaign({ budget_optimize_on: true }));
    tiktok.addAdGroup(group());
    await edit({ name: "Renamed" });

    expect(tiktok.calls[2]?.args).not.toHaveProperty("budget");
    expect(tiktok.calls[2]?.args).not.toHaveProperty("bid_type");
  });

  it("sets an end time by switching the schedule type", async () => {
    tiktok.addCampaign(manualCampaign());
    tiktok.addAdGroup(group());
    const result = await edit({ scheduleEndTime: "2026-11-01 00:00:00" });

    expect(tiktok.calls[2]?.args).toMatchObject({ schedule_type: "SCHEDULE_START_END", schedule_end_time: "2026-11-01 00:00:00" });
    expect(result.ok).toBe(true);
  });

  it("does not report success when TikTok does not show the new values", async () => {
    tiktok.addCampaign(manualCampaign());
    tiktok.addAdGroup(group());
    tiktok.ignoreAdGroupUpdates = true;
    const result = await edit({ name: "Renamed", ageGroups: ["AGE_25_34"] });

    expect(result).toMatchObject({ ok: false, status: "VERIFICATION_FAILED" });
    expect(result.message).toContain("name, ages");
    expect(store.activity[0]?.result).toBe("Not verified");
  });

  it("refuses ad groups of automatic (Smart+) campaigns", async () => {
    tiktok.addCampaign(manualCampaign({ campaign_automation_type: "UPGRADED_SMART_PLUS" }));
    tiktok.addAdGroup(group());
    await expect(edit({ name: "Renamed" })).rejects.toThrow("automatic (Smart+)");
    expect(tiktok.toolNames()).not.toContain("adgroup_update");
  });

  it("validates before sending anything to TikTok", async () => {
    tiktok.addCampaign(manualCampaign());
    tiktok.addAdGroup(group({ bid_type: "BID_TYPE_NO_BID", bid_price: 0 }));
    await expect(edit({})).rejects.toThrow("Nothing was changed");
    await expect(edit({ name: "  " })).rejects.toThrow("cannot be empty");
    await expect(edit({ locationIds: [] })).rejects.toThrow("at least one location");
    await expect(edit({ bidAmount: 1 })).rejects.toThrow("does not use a cost cap");
    expect(tiktok.toolNames()).not.toContain("adgroup_update");
    expect(store.operations).toHaveLength(0);
  });
});

describe("create (always paused)", () => {
  it("creates campaign, ad group and ad in order, re-reads them and never enables anything", async () => {
    const result = await createCampaignPaused(tiktok, store, ctx, buildPlan(trafficDraft()));

    expect(tiktok.toolNames()).toEqual(["campaign_create", "adgroup_create", "ad_create", "campaign_get", "adgroup_get", "ad_get"]);
    expect(tiktok.calls[0]?.args).toMatchObject({ operation_status: "DISABLE", objective_type: "TRAFFIC", budget_mode: "BUDGET_MODE_INFINITE" });
    expect(tiktok.calls[0]?.args).not.toHaveProperty("budget");
    const campaignId = result.campaign?.externalCampaignId;
    expect(tiktok.calls[1]?.args.campaign_id).toBe(campaignId);
    expect(tiktok.calls[2]?.args.adgroup_id).toBe(result.adGroups?.[0]?.externalAdGroupId);
    expect(result).toMatchObject({ ok: true, status: "SUCCEEDED", resourceId: campaignId });
    expect(result.campaign).toMatchObject({ operationStatus: "DISABLE", status: "PAUSED" });
    expect(result.message).toContain("Nothing is delivering");
    expect(result.adGroups).toHaveLength(1);
    expect(result.ads).toHaveLength(1);
    expect(store.operations[0]).toMatchObject({ status: "SUCCEEDED", resourceId: campaignId });
    expect(store.activity[0]).toMatchObject({ action: "Campaign Created", result: "Success" });
  });

  it("creates the campaign and ad group without an ad when none is configured", async () => {
    const result = await createCampaignPaused(tiktok, store, ctx, buildPlan(trafficDraft({ creative: undefined })));

    expect(tiktok.toolNames()).not.toContain("ad_create");
    expect(result.ok).toBe(true);
    expect(result.campaign?.status).toBe("PAUSED");
    expect(result.ads).toHaveLength(0);
  });

  it("uses the Smart+ tools for an automatic campaign and reads it back with the Smart+ filter", async () => {
    const result = await createCampaignPaused(tiktok, store, ctx, buildPlan(smartPlusDraft()));

    expect(tiktok.toolNames()).toEqual([
      "smart_plus_campaign_create",
      "smart_plus_adgroup_create",
      "smart_plus_ad_create",
      "campaign_get",
      "adgroup_get",
      "ad_get",
    ]);
    expect(tiktok.calls[4]?.args.filtering).toMatchObject({ campaign_automation_type: "UPGRADED_SMART_PLUS" });
    expect(tiktok.calls[5]?.args.filtering).toMatchObject({ campaign_automation_type: "UPGRADED_SMART_PLUS" });
    expect(result).toMatchObject({ ok: true, status: "SUCCEEDED" });
    expect(result.campaign).toMatchObject({ automationType: "UPGRADED_SMART_PLUS", operationStatus: "DISABLE" });
    expect(result.ads).toHaveLength(1);
  });

  it("stops at the failing step, keeps the campaign paused and says what was created", async () => {
    tiktok.failures.set(
      "adgroup_create",
      new TikTokError("INVALID_REQUEST", "x", { code: 40001, tiktokMessage: "location_ids is invalid" }),
    );
    const result = await createCampaignPaused(tiktok, store, ctx, buildPlan(trafficDraft()));

    expect(result).toMatchObject({ ok: false, status: "FAILED" });
    expect(result.message).toContain("Campaign creation failed because TikTok rejected the configuration: location_ids is invalid.");
    expect(result.message).toMatch(/Already created on TikTok and left in place: campaign \d+/);
    expect(tiktok.toolNames()).toEqual(["campaign_create", "adgroup_create"]);
    expect([...tiktok.campaigns.values()][0]?.operation_status).toBe("DISABLE");
  });

  it("does not report success when TikTok shows the new campaign as enabled", async () => {
    tiktok.ignorePausedOnCreate = true;
    const result = await createCampaignPaused(tiktok, store, ctx, buildPlan(trafficDraft()));

    expect(result).toMatchObject({ ok: false, status: "VERIFICATION_FAILED" });
    expect(result.message).toContain("instead of paused");
    expect(store.activity[0]?.result).toBe("Not verified");
  });

  it("never sends a status update, so nothing can be launched by creating", async () => {
    await createCampaignPaused(tiktok, store, ctx, buildPlan(trafficDraft()));
    await createCampaignPaused(tiktok, store, ctx, buildPlan(smartPlusDraft()));

    expect(tiktok.toolNames().filter((name) => name.includes("status_update"))).toEqual([]);
  });

  it("validates the draft before anything is sent to TikTok", () => {
    const noLocations = trafficDraft();
    noLocations.audience = { ...noLocations.audience, locationIds: [] };
    expect(() => buildPlan(noLocations)).toThrow("Select at least one location");
    expect(tiktok.calls).toHaveLength(0);
    expect(store.operations).toHaveLength(0);
  });
});

describe("bulk operations", () => {
  it("reports each campaign individually and keeps going after a failure", async () => {
    for (const id of ["c1", "c2", "c3", "c4"]) tiktok.addCampaign(activeCampaign({ campaign_id: id, campaign_name: id }));
    tiktok.campaigns.delete("c3");

    const results = await runBulk(
      ["c1", "c2", "c3", "c4"],
      BULK_CONCURRENCY,
      (campaignId) => setCampaignDelivery(tiktok, store, ctx, { advertiserId: ADVERTISER, campaignId, action: "pause" }),
      (r) => r.ok,
    );

    expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
    expect(results.map((r) => r.item)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(store.activity).toHaveLength(4);
  });

  it("never runs more than the concurrency limit at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
    );
    expect(peak).toBe(3);
  });

  it("captures thrown errors per item", async () => {
    const results = await runBulk([1, 2], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(results[1]).toMatchObject({ ok: false, error: "boom" });
    expect(results[0]).toMatchObject({ ok: true, result: 1 });
  });
});
