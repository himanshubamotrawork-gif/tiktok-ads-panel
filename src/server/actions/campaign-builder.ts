"use server";

// Server actions behind the create-campaign wizard and the ad group editor.

import { getCampaignType } from "@/integrations/tiktok/tiktok.capabilities";
import { withTikTok } from "@/integrations/tiktok/tiktok.client";
import { buildPlan, type CampaignDraft } from "@/integrations/tiktok/tiktok.draft";
import { describeFailure, TikTokError } from "@/integrations/tiktok/tiktok.errors";
import type { AdGroupChanges } from "@/integrations/tiktok/tiktok.ad-groups";
import {
  listAudiences,
  listCallToActions,
  listCountries,
  listIdentities,
  listInstantForms,
  listInterests,
  listLanguages,
  listPixels,
  redeemSparkCode,
  searchLocations,
  type GeoLevel,
  type IdentityOption,
  type Option,
  type PixelOption,
  type SparkPost,
} from "@/integrations/tiktok/tiktok.options";
import { prisma } from "@/lib/db";
import { assertWritesEnabled, run } from "../action-utils";
import { requireAdAccount, requireContext } from "../context";
import type { ActionResult } from "../dto";
import { prismaOperationStore as store } from "../operations/store.prisma";
import { replaceCampaignChildren, upsertAdGroup, upsertCampaign } from "../sync";
import { createCampaignPaused, editAdGroup } from "../workflows";

export interface CampaignOptions {
  countries: Option[];
  languages: Option[];
  interests: Option[];
  audiences: Option[];
  identities: IdentityOption[];
  instantForms: Option[];
  pixels: PixelOption[];
  callToActions: Option[];
  /** Per-list load failures. A missing list never blocks the lists that did load. */
  errors: Partial<Record<Exclude<keyof CampaignOptions, "errors">, string>>;
}

type ListKey = Exclude<keyof CampaignOptions, "errors">;

async function loadLists(
  loaders: Partial<{ [K in ListKey]: () => Promise<CampaignOptions[K]> }>,
): Promise<CampaignOptions> {
  const result: CampaignOptions = {
    countries: [],
    languages: [],
    interests: [],
    audiences: [],
    identities: [],
    instantForms: [],
    pixels: [],
    callToActions: [],
    errors: {},
  };
  // One at a time: these share a single MCP session and TikTok rate-limits per account.
  for (const key of Object.keys(loaders) as ListKey[]) {
    try {
      (result[key] as unknown) = await loaders[key]!();
    } catch (err) {
      result.errors[key] = describeFailure("Loading this list", err);
    }
  }
  return result;
}

/** Loads only the choices the selected campaign type and destination actually use. */
export async function loadCampaignOptionsAction(
  advertiserId: string,
  typeId: string,
  destinationId: string,
): Promise<ActionResult<CampaignOptions>> {
  const ctx = await requireContext();
  return run("Loading campaign options", async () => {
    await requireAdAccount(ctx.workspaceId, advertiserId);
    const type = getCampaignType(typeId);
    const destination = type?.destinations.find((d) => d.id === destinationId);
    if (!type || !destination) throw new Error("Choose a campaign type first.");
    const controls = new Set([...type.audience, ...(type.automaticAudience ?? [])]);
    const geo = { advertiserId, objective: type.objective, promotionType: destination.promotionType };

    return withTikTok(ctx.workspaceId, (gateway) =>
      loadLists({
        countries: () => listCountries(gateway, geo),
        ...(controls.has("language") ? { languages: () => listLanguages(gateway, advertiserId) } : {}),
        ...(controls.has("interests") ? { interests: () => listInterests(gateway, advertiserId) } : {}),
        ...(controls.has("audiences") || controls.has("exclusions") ? { audiences: () => listAudiences(gateway, advertiserId) } : {}),
        identities: () => listIdentities(gateway, advertiserId),
        ...(destination.fields.includes("instantForm") ? { instantForms: () => listInstantForms(gateway, advertiserId) } : {}),
        ...(destination.optimizations.some((o) => o.needsPixel) ? { pixels: () => listPixels(gateway, advertiserId) } : {}),
        ...(type.cta === "TEXT" ? { callToActions: () => listCallToActions(gateway, advertiserId) } : {}),
      }),
    );
  });
}

/** Region, city, district or DMA search for the location picker. */
export async function searchLocationsAction(
  advertiserId: string,
  objective: string,
  promotionType: string | undefined,
  keyword: string,
  levels: GeoLevel[],
): Promise<ActionResult<Option[]>> {
  const ctx = await requireContext();
  return run("Searching locations", async () => {
    await requireAdAccount(ctx.workspaceId, advertiserId);
    const query = keyword.trim();
    if (query.length < 2) return [];
    return withTikTok(ctx.workspaceId, (gateway) => searchLocations(gateway, { advertiserId, objective, promotionType }, query, levels));
  });
}

/**
 * Applies a Spark code to the ad account and returns the post it unlocks. This changes
 * the ad account (it registers the authorization), so it respects the write switch.
 */
export async function redeemSparkCodeAction(advertiserId: string, code: string): Promise<ActionResult<SparkPost>> {
  const ctx = await requireContext();
  return run("Applying the Spark code", async () => {
    assertWritesEnabled();
    await requireAdAccount(ctx.workspaceId, advertiserId);
    if (!code.trim()) throw new Error("Enter a Spark code.");
    return withTikTok(ctx.workspaceId, (gateway) => redeemSparkCode(gateway, advertiserId, code));
  });
}

export interface CreateCampaignResult {
  campaignId: string | null;
  /** True only when TikTok's own data confirms the campaign exists and is paused. */
  verified: boolean;
  message: string;
  status: string | null;
  hasAd: boolean;
}

/** Creates the campaign paused. Launching is a separate action the user confirms afterwards. */
export async function createCampaignAction(draft: CampaignDraft): Promise<ActionResult<CreateCampaignResult>> {
  const ctx = await requireContext();
  return run("Campaign creation", async () => {
    assertWritesEnabled();
    const account = await requireAdAccount(ctx.workspaceId, draft.advertiserId);
    let plan;
    try {
      plan = buildPlan(draft);
    } catch (err) {
      throw new TikTokError("INVALID_REQUEST", err instanceof Error ? err.message : "The campaign settings are not valid.");
    }
    const result = await withTikTok(ctx.workspaceId, (gateway) => createCampaignPaused(gateway, store, ctx, plan));
    if (result.campaign) {
      const row = await upsertCampaign(ctx.workspaceId, account.id, result.campaign);
      await replaceCampaignChildren(row.id, result.adGroups ?? [], result.ads ?? []);
    }
    return {
      campaignId: result.resourceId ?? null,
      verified: result.ok,
      message: result.message,
      status: result.campaign?.externalStatus ?? null,
      hasAd: (result.ads?.length ?? 0) > 0,
    };
  });
}

export interface AdGroupEditOptions {
  countries: Option[];
  languages: Option[];
  interests: Option[];
  audiences: Option[];
  errors: CampaignOptions["errors"];
  objective: string | null;
}

export async function loadAdGroupEditOptionsAction(
  advertiserId: string,
  campaignId: string,
): Promise<ActionResult<AdGroupEditOptions>> {
  const ctx = await requireContext();
  return run("Loading targeting options", async () => {
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const campaign = await prisma.campaign.findUnique({
      where: { adAccountId_externalCampaignId: { adAccountId: account.id, externalCampaignId: campaignId } },
    });
    const objective = campaign?.objective ?? null;
    const lists = await withTikTok(ctx.workspaceId, (gateway) =>
      loadLists({
        ...(objective ? { countries: () => listCountries(gateway, { advertiserId, objective }) } : {}),
        languages: () => listLanguages(gateway, advertiserId),
        interests: () => listInterests(gateway, advertiserId),
        audiences: () => listAudiences(gateway, advertiserId),
      }),
    );
    return {
      countries: lists.countries,
      languages: lists.languages,
      interests: lists.interests,
      audiences: lists.audiences,
      errors: lists.errors,
      objective,
    };
  });
}

export async function editAdGroupAction(
  advertiserId: string,
  campaignId: string,
  adGroupId: string,
  changes: AdGroupChanges,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  return run("Ad group edit", async () => {
    assertWritesEnabled();
    const account = await requireAdAccount(ctx.workspaceId, advertiserId);
    const result = await withTikTok(ctx.workspaceId, (gateway) =>
      editAdGroup(gateway, store, ctx, { advertiserId, campaignId, adGroupId, changes }),
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
