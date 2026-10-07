import { mapMetricRows } from "./tiktok.mappers";
import type { Metrics, TikTokGateway } from "./tiktok.types";

// Exact metric names accepted by report_integrated_get.
const METRICS = ["spend", "impressions", "clicks", "ctr", "conversion", "cost_per_conversion"];

type Level = "campaign" | "adgroup" | "ad";

const LEVELS: Record<Level, { dataLevel: string; dimension: string; filterField: string }> = {
  campaign: { dataLevel: "AUCTION_CAMPAIGN", dimension: "campaign_id", filterField: "campaign_ids" },
  adgroup: { dataLevel: "AUCTION_ADGROUP", dimension: "adgroup_id", filterField: "adgroup_ids" },
  ad: { dataLevel: "AUCTION_AD", dimension: "ad_id", filterField: "ad_ids" },
};

export interface DateRange {
  /** YYYY-MM-DD in the ad account time zone. */
  startDate: string;
  endDate: string;
}

/**
 * Metrics per object for a date range, keyed by TikTok ID. Objects with no delivery in
 * the range are simply absent, which the UI shows as "No data".
 */
export async function getMetrics(
  gateway: TikTokGateway,
  advertiserId: string,
  level: Level,
  range: DateRange,
  filter: { campaignIds?: string[] } = {},
): Promise<Map<string, Metrics>> {
  const { dataLevel, dimension } = LEVELS[level];
  const out = new Map<string, Metrics>();
  const filtering = filter.campaignIds?.length
    ? [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(filter.campaignIds) }]
    : undefined;
  for (let page = 1; page <= 20; page++) {
    const data = await gateway.callTool("report_integrated_get", {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: dataLevel,
      dimensions: [dimension],
      metrics: METRICS,
      start_date: range.startDate,
      end_date: range.endDate,
      page,
      page_size: 1000,
      ...(filtering ? { filtering } : {}),
    });
    const rows = mapMetricRows(data, dimension);
    for (const [id, metrics] of rows) out.set(id, metrics);
    const pageInfo = (data as { page_info?: { total_page?: number } }).page_info;
    if (!pageInfo?.total_page || page >= pageInfo.total_page || rows.size === 0) break;
  }
  return out;
}

/** Lifetime spend for one campaign, used for the 105%-of-spend budget rule. */
export async function getCampaignLifetimeSpend(
  gateway: TikTokGateway,
  advertiserId: string,
  campaignId: string,
): Promise<number | null> {
  const data = await gateway.callTool("report_integrated_get", {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: ["campaign_id"],
    metrics: ["spend"],
    query_lifetime: true,
    filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([campaignId]) }],
    page_size: 10,
  });
  return mapMetricRows(data, "campaign_id").get(campaignId)?.spend ?? null;
}
