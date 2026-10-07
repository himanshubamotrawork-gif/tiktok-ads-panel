import { TikTokError } from "./tiktok.errors";
import { mapCampaign } from "./tiktok.mappers";
import { fetchAllPages } from "./tiktok.service";
import type { CampaignModel, OperationStatusAction, TikTokGateway } from "./tiktok.types";

/** Upgraded Smart+ ("automatic") campaigns have their own status tool. */
export function isUpgradedSmartPlus(automationType: string | null | undefined): boolean {
  return automationType === "UPGRADED_SMART_PLUS";
}

export async function listCampaigns(
  gateway: TikTokGateway,
  advertiserId: string,
  filter: { campaignIds?: string[] } = {},
): Promise<CampaignModel[]> {
  const filtering = filter.campaignIds?.length ? { campaign_ids: filter.campaignIds } : undefined;
  const rows = await fetchAllPages(
    gateway,
    "campaign_get",
    { advertiser_id: advertiserId, ...(filtering ? { filtering } : {}) },
    100,
  );
  return rows.map(mapCampaign).filter((c): c is CampaignModel => c !== null);
}

export async function getCampaign(
  gateway: TikTokGateway,
  advertiserId: string,
  campaignId: string,
): Promise<CampaignModel> {
  const [campaign] = await listCampaigns(gateway, advertiserId, { campaignIds: [campaignId] });
  if (!campaign) {
    throw new TikTokError("TIKTOK_REJECTED", `TikTok did not return campaign ${campaignId}.`, {
      tool: "campaign_get",
    });
  }
  return campaign;
}

/** Fields TikTok allows to change after creation: name and budget amount. */
export async function updateCampaign(
  gateway: TikTokGateway,
  advertiserId: string,
  campaignId: string,
  changes: { name?: string; budget?: number },
): Promise<void> {
  await gateway.callTool("campaign_update", {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    ...(changes.name !== undefined ? { campaign_name: changes.name } : {}),
    ...(changes.budget !== undefined ? { budget: changes.budget } : {}),
  });
}

export async function setCampaignStatus(
  gateway: TikTokGateway,
  advertiserId: string,
  campaignId: string,
  action: OperationStatusAction,
  automationType?: string | null,
): Promise<void> {
  const tool = isUpgradedSmartPlus(automationType) ? "smart_plus_campaign_status_update" : "campaign_status_update";
  await gateway.callTool(tool, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: action,
  });
}
