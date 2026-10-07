"use server";

// Read-only capability checks. Calls each read tool the app depends on and reports the
// shape of what TikTok returned, so field names taken from convention can be confirmed
// against live data before any write is enabled. Makes no changes on TikTok.

import { withTikTok } from "@/integrations/tiktok/tiktok.client";
import { describeFailure } from "@/integrations/tiktok/tiktok.errors";
import type { Raw } from "@/integrations/tiktok/tiktok.types";
import { run, writesEnabled } from "../action-utils";
import { requireAdAccount, requireContext } from "../context";
import type { ActionResult } from "../dto";

export interface DiagnosticRow {
  tool: string;
  purpose: string;
  ok: boolean;
  error: string | null;
  /** Top-level keys of TikTok's `data`. */
  dataKeys: string[];
  /** For the first list found: its key, length and the keys of its first item. */
  listKey: string | null;
  listLength: number | null;
  itemKeys: string[];
}

export interface DiagnosticsReport {
  writesEnabled: boolean;
  advertiserId: string;
  rows: DiagnosticRow[];
}

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

function describe(data: unknown): Pick<DiagnosticRow, "dataKeys" | "listKey" | "listLength" | "itemKeys"> {
  if (!isRecord(data)) return { dataKeys: [], listKey: null, listLength: null, itemKeys: [] };
  const dataKeys = Object.keys(data);
  for (const key of dataKeys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const firstItem = value[0];
      return { dataKeys, listKey: key, listLength: value.length, itemKeys: isRecord(firstItem) ? Object.keys(firstItem).sort() : [] };
    }
  }
  return { dataKeys, listKey: null, listLength: null, itemKeys: [] };
}

export async function runDiagnosticsAction(advertiserId: string): Promise<ActionResult<DiagnosticsReport>> {
  const ctx = await requireContext();
  return run("Running diagnostics", async () => {
    await requireAdAccount(ctx.workspaceId, advertiserId);
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const a = { advertiser_id: advertiserId };

    const checks: { tool: string; purpose: string; args: Record<string, unknown> }[] = [
      { tool: "user_info_get", purpose: "Connected TikTok user", args: {} },
      { tool: "bc_get", purpose: "Business Centers", args: { page_size: 5 } },
      { tool: "auth_advertiser_get", purpose: "Authorized ad accounts", args: {} },
      { tool: "advertiser_info_get", purpose: "Ad account details", args: { advertiser_ids: [advertiserId] } },
      { tool: "campaign_get", purpose: "Campaigns", args: { ...a, page_size: 5 } },
      { tool: "campaign_get", purpose: "Campaigns (Smart+ filter)", args: { ...a, page_size: 5, filtering: { campaign_automation_type: "UPGRADED_SMART_PLUS" } } },
      { tool: "adgroup_get", purpose: "Ad groups", args: { ...a, page_size: 5 } },
      { tool: "ad_get", purpose: "Ads", args: { ...a, page_size: 5 } },
      {
        tool: "report_integrated_get",
        purpose: "Campaign performance report",
        args: { ...a, report_type: "BASIC", data_level: "AUCTION_CAMPAIGN", dimensions: ["campaign_id"], metrics: ["spend", "impressions", "clicks", "ctr", "conversion", "cost_per_conversion"], start_date: weekAgo, end_date: today, page_size: 5 },
      },
      { tool: "tool_region_get", purpose: "Countries for Traffic", args: { ...a, placements: ["PLACEMENT_TIKTOK"], objective_type: "TRAFFIC", promotion_type: "WEBSITE", level_range: "TO_COUNTRY" } },
      {
        tool: "tool_targeting_search",
        purpose: "City / region search",
        args: { ...a, objective_type: "TRAFFIC", promotion_type: "WEBSITE", placements: ["PLACEMENT_TIKTOK"], search_type: "FUZZY_SEARCH", keywords: ["New York"], geo_types: ["PROVINCE", "CITY"] },
      },
      { tool: "tool_language_get", purpose: "Languages", args: a },
      { tool: "tool_interest_category_get", purpose: "Interest categories", args: { ...a, version: 2, placements: ["PLACEMENT_TIKTOK"] } },
      { tool: "dmp_custom_audience_list_get", purpose: "Custom audiences", args: { ...a, page_size: 5 } },
      { tool: "identity_get", purpose: "Identities", args: { ...a, page_size: 5 } },
      { tool: "page_get", purpose: "Instant Forms", args: { ...a, business_type: "LEAD_GEN", status: "PUBLISHED", page_size: 5 } },
      { tool: "pixel_list_get", purpose: "Pixels", args: { ...a, page_size: 5 } },
      { tool: "creative_cta_recommend_get", purpose: "Call-to-action values", args: { ...a, asset_type: "CTA_NORMAL", content_type: "LANDING_PAGE" } },
    ];

    const rows = await withTikTok(ctx.workspaceId, async (gateway) => {
      const out: DiagnosticRow[] = [];
      for (const check of checks) {
        try {
          const data = await gateway.callTool(check.tool, check.args);
          out.push({ tool: check.tool, purpose: check.purpose, ok: true, error: null, ...describe(data) });
        } catch (err) {
          out.push({
            tool: check.tool,
            purpose: check.purpose,
            ok: false,
            error: describeFailure("This check", err),
            dataKeys: [],
            listKey: null,
            listLength: null,
            itemKeys: [],
          });
        }
      }
      return out;
    });
    return { writesEnabled: writesEnabled(), advertiserId, rows };
  });
}
