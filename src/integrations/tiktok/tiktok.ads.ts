import { mapAd } from "./tiktok.mappers";
import { fetchAllPages } from "./tiktok.service";
import type { AdModel, TikTokGateway } from "./tiktok.types";

export async function listAds(
  gateway: TikTokGateway,
  advertiserId: string,
  filter: { campaignIds?: string[]; adGroupIds?: string[]; adIds?: string[]; automationType?: string | null },
): Promise<AdModel[]> {
  const filtering: Record<string, unknown> = {};
  if (filter.campaignIds?.length) filtering.campaign_ids = filter.campaignIds;
  if (filter.adGroupIds?.length) filtering.adgroup_ids = filter.adGroupIds;
  if (filter.adIds?.length) filtering.ad_ids = filter.adIds;
  if (filter.automationType) filtering.campaign_automation_type = filter.automationType;
  const rows = await fetchAllPages(gateway, "ad_get", { advertiser_id: advertiserId, filtering }, 100);
  return rows.map(mapAd).filter((a): a is AdModel => a !== null);
}
