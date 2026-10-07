import { describe, expect, it } from "vitest";
import { TikTokError, describeFailure, toTikTokError } from "@/integrations/tiktok/tiktok.errors";
import {
  mapAdAccount,
  mapAdGroup,
  mapBusinessCenter,
  mapCampaign,
  mapMetricRows,
  normalizeStatus,
  parseToolResult,
} from "@/integrations/tiktok/tiktok.mappers";

const text = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

describe("parseToolResult", () => {
  it("returns the data of a successful envelope", () => {
    const data = parseToolResult("auth_advertiser_get", text({ code: 0, message: "OK", data: { list: [1] } }));
    expect(data).toEqual({ list: [1] });
  });

  it("prefers structured content when present", () => {
    const data = parseToolResult("x", { structuredContent: { code: 0, data: { a: 1 } }, content: [] });
    expect(data).toEqual({ a: 1 });
  });

  it("turns a non-zero code into a classified error", () => {
    const call = () => parseToolResult("campaign_get", text({ code: 40002, message: "No permission", request_id: "r1" }));
    expect(call).toThrowError(TikTokError);
    try {
      call();
    } catch (err) {
      const e = err as TikTokError;
      expect(e.kind).toBe("PERMISSION_DENIED");
      expect(e.details).toMatchObject({ tool: "campaign_get", code: 40002, requestId: "r1" });
    }
  });

  it("classifies budget problems and rate limits", () => {
    const kindOf = (code: number, message: string) => {
      try {
        parseToolResult("t", text({ code, message }));
      } catch (err) {
        return (err as TikTokError).kind;
      }
    };
    expect(kindOf(40001, "Budget is lower than the minimum")).toBe("INVALID_BUDGET");
    expect(kindOf(40001, "location_ids is invalid")).toBe("INVALID_REQUEST");
    expect(kindOf(40100, "Too many requests")).toBe("RATE_LIMITED");
    expect(kindOf(40105, "Access token is incorrect")).toBe("AUTH_REQUIRED");
    expect(kindOf(51234, "Something else")).toBe("TIKTOK_REJECTED");
  });

  it("rejects unreadable responses", () => {
    expect(() => parseToolResult("t", { content: [{ type: "text", text: "not json" }], isError: true })).toThrowError(
      TikTokError,
    );
  });
});

describe("error messages", () => {
  it("explains failures in plain language and never as a bare code", () => {
    const rejected = new TikTokError("INVALID_REQUEST", "x", { tiktokMessage: "location_ids is invalid", code: 40001 });
    expect(describeFailure("Campaign creation", rejected)).toBe(
      "Campaign creation failed because TikTok rejected the configuration: location_ids is invalid.",
    );
    expect(describeFailure("Campaign pause", new TikTokError("NOT_CONNECTED", "x"))).toContain("Connect TikTok");
  });

  it("classifies transport errors", () => {
    expect(toTikTokError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })).kind).toBe("NETWORK");
    expect(toTikTokError(Object.assign(new Error("Request timed out"), { code: -32001 })).kind).toBe("TIMEOUT");
    expect(toTikTokError(Object.assign(new Error("nope"), { name: "UnauthorizedError" })).kind).toBe("AUTH_REQUIRED");
    expect(toTikTokError(new Error("weird")).kind).toBe("UNKNOWN");
  });
});

describe("normalizeStatus", () => {
  it.each([
    ["CAMPAIGN_STATUS_ENABLE", "ENABLE", "ACTIVE"],
    ["ADGROUP_STATUS_DELIVERY_OK", "ENABLE", "ACTIVE"],
    ["CAMPAIGN_STATUS_DISABLE", "DISABLE", "PAUSED"],
    ["ADGROUP_STATUS_CAMPAIGN_DISABLE", "ENABLE", "PAUSED"],
    ["AD_STATUS_AUDIT", "ENABLE", "UNDER_REVIEW"],
    ["ADGROUP_STATUS_REAUDIT", "ENABLE", "UNDER_REVIEW"],
    ["AD_STATUS_AUDIT_DENY", "ENABLE", "REJECTED"],
    ["ADGROUP_STATUS_NOT_START", "ENABLE", "PENDING"],
    ["CAMPAIGN_STATUS_DELETE", "DISABLE", "DISABLED"],
    ["CAMPAIGN_STATUS_BUDGET_EXCEED", "ENABLE", "DISABLED"],
    ["SOMETHING_NEW", "ENABLE", "UNKNOWN"],
  ])("%s / %s → %s", (secondary, operation, expected) => {
    expect(normalizeStatus(secondary, operation)).toBe(expected);
  });

  it("falls back to the operation status when no detailed status is reported", () => {
    expect(normalizeStatus(null, "ENABLE")).toBe("ACTIVE");
    expect(normalizeStatus(undefined, "DISABLE")).toBe("PAUSED");
    expect(normalizeStatus(null, null)).toBe("UNKNOWN");
  });
});

describe("entity mappers", () => {
  it("maps a campaign and keeps the original TikTok status", () => {
    const campaign = mapCampaign({
      campaign_id: "123",
      advertiser_id: "9",
      campaign_name: "Spring",
      objective_type: "TRAFFIC",
      secondary_status: "CAMPAIGN_STATUS_DISABLE",
      operation_status: "DISABLE",
      budget_mode: "BUDGET_MODE_DAY",
      budget: 50,
      budget_optimize_on: true,
      create_time: "2026-01-01 00:00:00",
    });
    expect(campaign).toMatchObject({
      externalCampaignId: "123",
      name: "Spring",
      status: "PAUSED",
      externalStatus: "CAMPAIGN_STATUS_DISABLE",
      operationStatus: "DISABLE",
      budget: 50,
      budgetOptimizeOn: true,
      modifyTime: null,
    });
  });

  it("returns null without an ID and never invents missing values", () => {
    expect(mapCampaign({ campaign_name: "x" })).toBeNull();
    const campaign = mapCampaign({ campaign_id: "1" });
    expect(campaign).toMatchObject({ objective: null, budget: null, budgetMode: null, status: "UNKNOWN" });
  });

  it("maps ad groups with targeting and scheduled budget", () => {
    const adGroup = mapAdGroup({
      adgroup_id: "g1",
      campaign_id: "c1",
      adgroup_name: "Group",
      budget: "30",
      scheduled_budget: 40,
      bid_type: "BID_TYPE_NO_BID",
      location_ids: ["6252001"],
      languages: [],
      gender: "GENDER_UNLIMITED",
    });
    expect(adGroup).toMatchObject({ budget: 30, scheduledBudget: 40, bidStrategy: "BID_TYPE_NO_BID" });
    expect(adGroup?.targeting).toEqual({ location_ids: ["6252001"], gender: "GENDER_UNLIMITED" });
  });

  it("maps business centers in nested and flat form", () => {
    expect(mapBusinessCenter({ bc_info: { bc_id: "b1", name: "My BC", status: "ENABLE" }, user_role: "ADMIN" })).toMatchObject({
      externalBcId: "b1",
      name: "My BC",
      userRole: "ADMIN",
    });
    expect(mapBusinessCenter({ bc_id: "b2", name: "Flat" })?.externalBcId).toBe("b2");
  });

  it("maps ad accounts from both listing tools", () => {
    expect(mapAdAccount({ advertiser_id: "1", advertiser_name: "Acc" })?.name).toBe("Acc");
    expect(mapAdAccount({ asset_id: "2", asset_name: "Asset" })).toMatchObject({ externalAdvertiserId: "2", name: "Asset" });
    expect(mapAdAccount({ advertiser_id: "3", name: "N", currency: "USD", display_timezone: "Etc/UTC" })).toMatchObject({
      currency: "USD",
      timezone: "Etc/UTC",
    });
  });

  it("maps report rows and leaves absent metrics as null", () => {
    const rows = mapMetricRows(
      { list: [{ dimensions: { campaign_id: "c1" }, metrics: { spend: "12.50", impressions: "1000", clicks: "20", ctr: "2.00", conversion: "-" } }] },
      "campaign_id",
    );
    expect(rows.get("c1")).toEqual({
      spend: 12.5,
      impressions: 1000,
      clicks: 20,
      ctr: 2,
      conversions: null,
      costPerConversion: null,
    });
  });
});
