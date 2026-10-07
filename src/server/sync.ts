// Upserts of TikTok state into PostgreSQL. The database is a cache of what TikTok last
// reported; TikTok stays authoritative.

import type { Prisma } from "@prisma/client";
import type {
  AdAccountModel,
  AdGroupModel,
  AdModel,
  BusinessCenterModel,
  CampaignModel,
} from "@/integrations/tiktok/tiktok.types";
import { prisma } from "@/lib/db";

const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

export async function upsertBusinessCenters(workspaceId: string, models: BusinessCenterModel[]) {
  const now = new Date();
  for (const bc of models) {
    const data = {
      name: bc.name,
      externalType: bc.type,
      status: bc.status,
      userRole: bc.userRole,
      raw: json(bc.raw),
      lastSyncedAt: now,
    };
    await prisma.businessCenter.upsert({
      where: { workspaceId_externalBcId: { workspaceId, externalBcId: bc.externalBcId } },
      create: { workspaceId, externalBcId: bc.externalBcId, ...data },
      update: data,
    });
  }
  // Business Centers the user can no longer see are removed from the cache.
  await prisma.businessCenter.deleteMany({
    where: { workspaceId, externalBcId: { notIn: models.map((bc) => bc.externalBcId) } },
  });
}

export async function upsertAdAccounts(workspaceId: string, externalBcId: string | null, models: AdAccountModel[]) {
  const now = new Date();
  const bc = externalBcId
    ? await prisma.businessCenter.findUnique({ where: { workspaceId_externalBcId: { workspaceId, externalBcId } } })
    : null;
  for (const account of models) {
    const data = {
      name: account.name,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status,
      raw: json(account.raw),
      lastSyncedAt: now,
      ...(bc ? { businessCenterId: bc.id } : {}),
    };
    await prisma.adAccount.upsert({
      where: {
        workspaceId_externalAdvertiserId: { workspaceId, externalAdvertiserId: account.externalAdvertiserId },
      },
      create: { workspaceId, externalAdvertiserId: account.externalAdvertiserId, ...data },
      update: data,
    });
  }
}

function campaignData(model: CampaignModel, now: Date) {
  return {
    name: model.name,
    objective: model.objective,
    status: model.status,
    externalStatus: model.externalStatus,
    operationStatus: model.operationStatus,
    budgetMode: model.budgetMode,
    budgetAmount: model.budget,
    budgetOptimizeOn: model.budgetOptimizeOn,
    externalCreatedAt: model.createTime,
    externalUpdatedAt: model.modifyTime,
    raw: json(model.raw),
    lastSyncedAt: now,
  };
}

export async function upsertCampaign(workspaceId: string, adAccountId: string, model: CampaignModel) {
  const data = campaignData(model, new Date());
  return prisma.campaign.upsert({
    where: { adAccountId_externalCampaignId: { adAccountId, externalCampaignId: model.externalCampaignId } },
    create: { workspaceId, adAccountId, externalCampaignId: model.externalCampaignId, ...data },
    update: data,
  });
}

/** Replaces the cached campaign list of an ad account with what TikTok returned. */
export async function replaceCampaigns(workspaceId: string, adAccountId: string, models: CampaignModel[]) {
  for (const model of models) await upsertCampaign(workspaceId, adAccountId, model);
  await prisma.campaign.deleteMany({
    where: { adAccountId, externalCampaignId: { notIn: models.map((m) => m.externalCampaignId) } },
  });
}

export async function upsertAdGroup(campaignId: string, model: AdGroupModel) {
  const data = {
    name: model.name,
    status: model.status,
    externalStatus: model.externalStatus,
    operationStatus: model.operationStatus,
    budgetMode: model.budgetMode,
    budgetAmount: model.budget,
    bidStrategy: model.bidStrategy,
    optimizationGoal: model.optimizationGoal,
    targeting: json(model.targeting),
    raw: json(model.raw),
    lastSyncedAt: new Date(),
  };
  return prisma.adGroup.upsert({
    where: { campaignId_externalAdGroupId: { campaignId, externalAdGroupId: model.externalAdGroupId } },
    create: { campaignId, externalAdGroupId: model.externalAdGroupId, ...data },
    update: data,
  });
}

/** Replaces the cached ad groups and ads of one campaign. */
export async function replaceCampaignChildren(campaignId: string, adGroups: AdGroupModel[], ads: AdModel[]) {
  const groupRows = new Map<string, string>();
  for (const model of adGroups) {
    const row = await upsertAdGroup(campaignId, model);
    groupRows.set(model.externalAdGroupId, row.id);
  }
  await prisma.adGroup.deleteMany({
    where: { campaignId, externalAdGroupId: { notIn: adGroups.map((g) => g.externalAdGroupId) } },
  });

  const now = new Date();
  for (const model of ads) {
    const adGroupId = groupRows.get(model.externalAdGroupId);
    if (!adGroupId) continue;
    const data = {
      name: model.name,
      status: model.status,
      externalStatus: model.externalStatus,
      operationStatus: model.operationStatus,
      adFormat: model.adFormat,
      adText: model.adText,
      callToAction: model.callToAction,
      landingPageUrl: model.landingPageUrl,
      raw: json(model.raw),
      lastSyncedAt: now,
    };
    await prisma.ad.upsert({
      where: { adGroupId_externalAdId: { adGroupId, externalAdId: model.externalAdId } },
      create: { adGroupId, externalAdId: model.externalAdId, ...data },
      update: data,
    });
  }
  await prisma.ad.deleteMany({
    where: { adGroupId: { in: [...groupRows.values()] }, externalAdId: { notIn: ads.map((a) => a.externalAdId) } },
  });
}
