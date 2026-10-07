"use server";

// Server actions: the only entry points the UI uses for TikTok. Each one resolves the
// signed-in user's workspace, talks to TikTok through the integration layer, updates
// the PostgreSQL cache and returns plain data.

import { listAds } from "@/integrations/tiktok/tiktok.ads";
import { listAdGroups } from "@/integrations/tiktok/tiktok.ad-groups";
import { getCampaign, isUpgradedSmartPlus, listCampaigns } from "@/integrations/tiktok/tiktok.campaigns";
import { withTikTok } from "@/integrations/tiktok/tiktok.client";
import { describeFailure, TikTokError } from "@/integrations/tiktok/tiktok.errors";
import { getMetrics, type DateRange } from "@/integrations/tiktok/tiktok.reporting";
import {
  getConnectedUser,
  listAdAccounts,
  listAuthorizedAdAccounts,
  listBusinessCenters,
} from "@/integrations/tiktok/tiktok.service";
import type { Metrics } from "@/integrations/tiktok/tiktok.types";
import { prisma } from "@/lib/db";
import { assertWritesEnabled, run } from "../action-utils";
import { requireAdAccount, requireContext } from "../context";
import type {
  ActionResult,
  AdAccountRow,
  BulkResultRow,
  BusinessCenterRow,
  CampaignDetailData,
  CampaignListData,
  MetricsById,
} from "../dto";
import { BULK_CONCURRENCY, runBulk } from "../operations/bulk";
import { prismaOperationStore as store } from "../operations/store.prisma";
import { getActivity, getCachedAdAccounts, getCachedBusinessCenters, getCachedCampaignDetail, getCachedCampaigns } from "../queries";
import { replaceCampaignChildren, replaceCampaigns, upsertAdAccounts, upsertAdGroup, upsertBusinessCenters, upsertCampaign } from "../sync";
import { changeAdGroupBudget, editCampaign, setCampaignDelivery } from "../workflows";

const MAX_BULK = 50;

async function metricsOrError(
  fn: () => Promise<Map<string, Metrics>>,
): Promise<{ metrics: MetricsById; metricsError: string | null }> {
  try {
    return { metrics: Object.fromEntries(await fn()), metricsError: null };
  } catch (err) {
    return { metrics: {}, metricsError: describeFailure("Loading performance data", err) };
  }
}

// ---------- discovery ----------

export async function refreshBusinessCentersAction(): Promise<ActionResult<BusinessCenterRow[]>> {
  const ctx = await requireContext();
  return run("Loading Business Centers", async () => {
    await withTikTok(ctx.workspaceId, async (gateway) => {
      const [centers, user] = await Promise.all([listBusinessCenters(gateway), getConnectedUser(gateway)]);
      await upsertBusinessCenters(ctx.workspaceId, centers);
      await prisma.tikTokConnection.update({ where: { workspaceId: ctx.workspaceId }, data: user });
    });
    return getCachedBusinessCenters(ctx.workspaceId);
  });
}

/** With a Business Center: its ad accounts. Without: every ad account the connection can use. */
export async function refreshAdAccountsAction(bcId: string | null): Promise<ActionResult<AdAccountRow[]>> {
  const ctx = await requireContext();
  return run("Loading ad accounts", async () => {
    await withTikTok(ctx.workspaceId, async (gateway) => {
      const accounts = bcId ? await listAdAccounts(gateway, bcId) : await listAuthorizedAdAccounts(gateway);
      await upsertAdAccounts(ctx.workspaceId, bcId, accounts);
    });
    return getCachedAdAccounts(ctx.workspaceId, bcId);
  });
}

// ---------- campaigns ----------

export async function refreshCampaignsAction(advertiserId: string, range: DateRange): Promise<ActionResult<CampaignListData>> {
  const ctx = await requireContext();
  return run("Loading campaigns", async () => {
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const report = await withTikTok(ctx.workspaceId, async (gateway) => {
      const campaigns = await listCampaigns(gateway, advertiserId);
      await replaceCampaigns(ctx.workspaceId, account.id, campaigns);
      return metricsOrError(() => getMetrics(gateway, advertiserId, "campaign", range));
    });
    return { campaigns: await getCachedCampaigns(ctx.workspaceId, advertiserId), ...report };
  });
}

/** Performance only, for a changed date range. Campaign rows stay as cached. */
export async function loadCampaignMetricsAction(
  advertiserId: string,
  range: DateRange,
): Promise<ActionResult<MetricsById>> {
  const ctx = await requireContext();
  return run("Loading performance data", async () => {
    await requireAdAccount(ctx.workspaceId, advertiserId);
    return withTikTok(ctx.workspaceId, async (gateway) =>
      Object.fromEntries(await getMetrics(gateway, advertiserId, "campaign", range)),
    );
  });
}

export async function refreshCampaignDetailAction(
  advertiserId: string,
  campaignId: string,
  range: DateRange,
): Promise<ActionResult<CampaignDetailData>> {
  const ctx = await requireContext();
  return run("Loading the campaign", async () => {
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const report = await withTikTok(ctx.workspaceId, async (gateway) => {
      const campaign = await getCampaign(gateway, advertiserId, campaignId);
      const automationType = isUpgradedSmartPlus(campaign.automationType) ? campaign.automationType : null;
      const adGroups = await listAdGroups(gateway, advertiserId, { campaignIds: [campaignId], automationType });
      const ads = await listAds(gateway, advertiserId, { campaignIds: [campaignId], automationType });
      const row = await upsertCampaign(ctx.workspaceId, account.id, campaign);
      await replaceCampaignChildren(row.id, adGroups, ads);

      const filter = { campaignIds: [campaignId] };
      const campaignReport = await metricsOrError(() => getMetrics(gateway, advertiserId, "campaign", range, filter));
      const adReport = await metricsOrError(() => getMetrics(gateway, advertiserId, "ad", range, filter));
      return {
        campaignMetrics: campaignReport.metrics[campaignId] ?? null,
        adMetrics: adReport.metrics,
        metricsError: campaignReport.metricsError ?? adReport.metricsError,
      };
    });
    const detail = await getCachedCampaignDetail(ctx.workspaceId, advertiserId, campaignId);
    if (!detail) throw new Error("The campaign could not be loaded.");
    const activity = await getActivity(ctx.workspaceId, {
      resourceIds: [campaignId, ...detail.adGroups.map((g) => g.id)],
      take: 50,
    });
    return { ...detail, ...report, activity };
  });
}

// ---------- pause / resume (single and bulk) ----------

export async function setCampaignsDeliveryAction(
  advertiserId: string,
  campaignIds: string[],
  action: "pause" | "resume",
): Promise<ActionResult<BulkResultRow[]>> {
  const ctx = await requireContext();
  return run(action === "pause" ? "Campaign pause" : "Campaign resume", async () => {
    assertWritesEnabled();
    const ids = [...new Set(campaignIds)];
    if (ids.length === 0) throw new Error("Select at least one campaign.");
    if (ids.length > MAX_BULK) throw new Error(`Select at most ${MAX_BULK} campaigns at a time.`);
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const known = await prisma.campaign.findMany({
      where: { adAccountId: account.id, externalCampaignId: { in: ids } },
      select: { externalCampaignId: true, name: true },
    });
    const names = new Map(known.map((c) => [c.externalCampaignId, c.name]));

    return withTikTok(ctx.workspaceId, async (gateway) => {
      const results = await runBulk(
        ids,
        BULK_CONCURRENCY,
        async (campaignId) => {
          const result = await setCampaignDelivery(gateway, store, ctx, {
            advertiserId,
            campaignId,
            action,
            campaignName: names.get(campaignId),
          });
          if (result.campaign) await upsertCampaign(ctx.workspaceId, account.id, result.campaign);
          return result;
        },
        (result) => result.ok,
      );
      return results.map((r) => ({
        campaignId: r.item,
        name: r.result?.campaign?.name ?? names.get(r.item) ?? r.item,
        ok: r.ok,
        message: r.result?.message ?? r.error ?? "Unknown result.",
      }));
    });
  });
}

// ---------- edit and budgets ----------

export async function editCampaignAction(
  advertiserId: string,
  campaignId: string,
  changes: { name?: string; budget?: number },
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  return run("Campaign edit", async () => {
    assertWritesEnabled();
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const result = await withTikTok(ctx.workspaceId, (gateway) =>
      editCampaign(gateway, store, ctx, { advertiserId, campaignId, ...changes }),
    );
    if (result.campaign) await upsertCampaign(ctx.workspaceId, account.id, result.campaign);
    if (!result.ok) throw new TikTokError("VERIFICATION_MISMATCH", result.message);
    return { message: result.message };
  });
}

export async function changeAdGroupBudgetAction(
  advertiserId: string,
  campaignId: string,
  adGroupId: string,
  newBudget: number,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  return run("Ad group budget change", async () => {
    assertWritesEnabled();
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const result = await withTikTok(ctx.workspaceId, (gateway) =>
      changeAdGroupBudget(gateway, store, ctx, { advertiserId, campaignId, adGroupId, newBudget }),
    );
    if (result.adGroup) {
      const campaign = await prisma.campaign.findUnique({
        where: { adAccountId_externalCampaignId: { adAccountId: account.id, externalCampaignId: campaignId } },
      });
      if (campaign) await upsertAdGroup(campaign.id, result.adGroup);
    }
    if (!result.ok) throw new TikTokError("VERIFICATION_MISMATCH", result.message);
    return { message: result.message };
  });
}
