import type { CreationPlan } from "./tiktok.draft";
import { TikTokError } from "./tiktok.errors";
import { str } from "./tiktok.mappers";
import type { Raw, TikTokGateway } from "./tiktok.types";

export interface CreatedIds {
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
}

const TOOLS = {
  MANUAL: { campaign: "campaign_create", adGroup: "adgroup_create", ad: "ad_create" },
  AUTOMATIC: { campaign: "smart_plus_campaign_create", adGroup: "smart_plus_adgroup_create", ad: "smart_plus_ad_create" },
} as const;

function requireId(tool: string, what: string, id: string | null): string {
  if (!id) throw new TikTokError("UNKNOWN", `TikTok accepted the ${what} but returned no ID.`, { tool });
  return id;
}

function adIdOf(data: Raw): string | null {
  const first = Array.isArray(data.ad_ids) ? data.ad_ids[0] : undefined;
  return str(first) ?? str(data.ad_id) ?? str(data.smart_plus_ad_id);
}

/**
 * Creates campaign → ad group → ad in that order. The campaign is created paused, so
 * nothing can deliver. IDs are written into `created` as they arrive, so a failure
 * part-way still tells the caller what exists on TikTok.
 */
export async function executeCreationPlan(gateway: TikTokGateway, plan: CreationPlan, created: CreatedIds): Promise<void> {
  const tools = TOOLS[plan.mode];

  const campaign = await gateway.callTool(tools.campaign, plan.campaign);
  created.campaignId = requireId(tools.campaign, "campaign", str(campaign.campaign_id));

  const adGroup = await gateway.callTool(tools.adGroup, { ...plan.adGroup, campaign_id: created.campaignId });
  created.adGroupId = requireId(tools.adGroup, "ad group", str(adGroup.adgroup_id));

  if (plan.ad) {
    const ad = await gateway.callTool(tools.ad, { ...plan.ad, adgroup_id: created.adGroupId });
    created.adId = requireId(tools.ad, "ad", adIdOf(ad));
  }
}
