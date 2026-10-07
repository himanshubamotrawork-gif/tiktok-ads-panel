// Reads from the PostgreSQL cache. Used for the first paint; "Refresh" goes to TikTok.

import { prisma } from "@/lib/db";
import {
  toActivityRow,
  toAdAccountRow,
  toAdGroupRow,
  toAdRow,
  toBusinessCenterRow,
  toCampaignRow,
  type ActivityRow,
  type AdAccountRow,
  type AdGroupRow,
  type AdRow,
  type BusinessCenterRow,
  type CampaignRow,
} from "./dto";

export async function getConnection(workspaceId: string) {
  const row = await prisma.tikTokConnection.findUnique({ where: { workspaceId } });
  return {
    status: row?.status ?? ("DISCONNECTED" as const),
    displayName: row?.displayName ?? null,
    externalUserId: row?.externalUserId ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function getCachedBusinessCenters(workspaceId: string): Promise<BusinessCenterRow[]> {
  const rows = await prisma.businessCenter.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  return rows.map(toBusinessCenterRow);
}

export async function getCachedAdAccounts(workspaceId: string, externalBcId: string | null): Promise<AdAccountRow[]> {
  const rows = await prisma.adAccount.findMany({
    where: { workspaceId, ...(externalBcId ? { businessCenter: { externalBcId } } : {}) },
    orderBy: { name: "asc" },
  });
  return rows.map(toAdAccountRow);
}

export async function getCachedCampaigns(workspaceId: string, advertiserId: string): Promise<CampaignRow[]> {
  const rows = await prisma.campaign.findMany({
    where: { workspaceId, adAccount: { externalAdvertiserId: advertiserId } },
    orderBy: { externalCreatedAt: "desc" },
  });
  return rows.map(toCampaignRow);
}

export async function getCachedCampaignDetail(
  workspaceId: string,
  advertiserId: string,
  campaignId: string,
): Promise<{ campaign: CampaignRow; adGroups: AdGroupRow[]; ads: AdRow[] } | null> {
  const row = await prisma.campaign.findFirst({
    where: { workspaceId, externalCampaignId: campaignId, adAccount: { externalAdvertiserId: advertiserId } },
    include: { adGroups: { orderBy: { name: "asc" }, include: { ads: { orderBy: { name: "asc" } } } } },
  });
  if (!row) return null;
  return {
    campaign: toCampaignRow(row),
    adGroups: row.adGroups.map(toAdGroupRow),
    ads: row.adGroups.flatMap((g) => g.ads.map((a) => toAdRow({ ...a, adGroup: g }))),
  };
}

export async function getActivity(
  workspaceId: string,
  filter: { resourceIds?: string[]; take?: number } = {},
): Promise<ActivityRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: { workspaceId, ...(filter.resourceIds ? { resourceId: { in: filter.resourceIds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 100,
  });
  return rows.map(toActivityRow);
}
