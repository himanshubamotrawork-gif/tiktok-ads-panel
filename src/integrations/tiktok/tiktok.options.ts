// Choices the wizard offers, loaded from TikTok rather than hardcoded: locations,
// languages, interests, audiences, Instant Forms, pixels, CTAs, identities and Spark
// codes. The MCP tool definitions describe the requests but not every response field, so
// parsing here accepts the field names TikTok's API uses and ignores rows it cannot read.
// Settings → Diagnostics shows the real responses for checking.

import { listOf, str } from "./tiktok.mappers";
import type { Raw, TikTokGateway } from "./tiktok.types";

export interface Option {
  id: string;
  label: string;
  /** Extra context shown next to the label, e.g. "City · California". */
  detail?: string;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First array of objects found under any of the given keys. */
function rows(data: unknown, keys: string[]): Raw[] {
  for (const key of keys) {
    const list = listOf(data, key);
    if (list.length) return list;
  }
  return [];
}

function first(raw: Raw, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(raw[key]);
    if (value) return value;
  }
  return null;
}

function options(list: Raw[], idKeys: string[], labelKeys: string[], detail?: (raw: Raw) => string | undefined): Option[] {
  const out: Option[] = [];
  for (const raw of list) {
    const id = first(raw, idKeys);
    if (!id) continue;
    out.push({ id, label: first(raw, labelKeys) ?? id, detail: detail?.(raw) });
  }
  return out;
}

export interface GeoContext {
  advertiserId: string;
  objective: string;
  promotionType?: string;
}

/** Countries and regions TikTok offers for the objective. */
export async function listCountries(gateway: TikTokGateway, ctx: GeoContext): Promise<Option[]> {
  const data = await gateway.callTool("tool_region_get", {
    advertiser_id: ctx.advertiserId,
    placements: ["PLACEMENT_TIKTOK"],
    objective_type: ctx.objective,
    level_range: "TO_COUNTRY",
    ...(ctx.promotionType ? { promotion_type: ctx.promotionType } : {}),
  });
  return options(rows(data, ["region_info", "list"]), ["location_id", "geo_id"], ["name"]).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export type GeoLevel = "COUNTRY" | "PROVINCE" | "CITY" | "DISTRICT" | "DMA";

/** Searches locations by name at any level (region, city, district, DMA). */
export async function searchLocations(
  gateway: TikTokGateway,
  ctx: GeoContext,
  keyword: string,
  levels: GeoLevel[],
): Promise<Option[]> {
  const data = await gateway.callTool("tool_targeting_search", {
    advertiser_id: ctx.advertiserId,
    objective_type: ctx.objective,
    placements: ["PLACEMENT_TIKTOK"],
    search_type: "FUZZY_SEARCH",
    keywords: [keyword],
    geo_types: levels,
    ...(ctx.promotionType ? { promotion_type: ctx.promotionType } : {}),
  });
  return options(rows(data, ["targeting_tag_list", "geo_list", "list"]), ["geo_id", "location_id", "id"], ["name", "description"], (raw) => {
    const level = first(raw, ["geo_type", "level", "type"]);
    const parent = first(raw, ["region_code", "country_code", "parent_name"]);
    return [level, parent].filter(Boolean).join(" · ") || undefined;
  });
}

export async function listLanguages(gateway: TikTokGateway, advertiserId: string): Promise<Option[]> {
  const data = await gateway.callTool("tool_language_get", { advertiser_id: advertiserId });
  return options(rows(data, ["languages", "list"]), ["code", "language_code"], ["name", "language_name"]);
}

export async function listInterests(gateway: TikTokGateway, advertiserId: string): Promise<Option[]> {
  const data = await gateway.callTool("tool_interest_category_get", {
    advertiser_id: advertiserId,
    version: 2,
    placements: ["PLACEMENT_TIKTOK"],
  });
  // Top-level categories only; sub-categories are not built yet.
  return options(
    rows(data, ["interest_categories", "list"]).filter((raw) => raw.level === undefined || Number(raw.level) === 1),
    ["interest_category_id", "id"],
    ["interest_category_name", "name"],
  );
}

export async function listAudiences(gateway: TikTokGateway, advertiserId: string): Promise<Option[]> {
  const data = await gateway.callTool("dmp_custom_audience_list_get", { advertiser_id: advertiserId, page_size: 100 });
  return options(rows(data, ["list"]), ["audience_id"], ["name"], (raw) => first(raw, ["audience_type"]) ?? undefined);
}

export async function listInstantForms(gateway: TikTokGateway, advertiserId: string): Promise<Option[]> {
  const data = await gateway.callTool("page_get", {
    advertiser_id: advertiserId,
    business_type: "LEAD_GEN",
    status: "PUBLISHED",
    page_size: 100,
  });
  return options(rows(data, ["list"]), ["page_id"], ["title", "page_name", "name"]);
}

export interface PixelOption extends Option {
  events: Option[];
}

export async function listPixels(gateway: TikTokGateway, advertiserId: string): Promise<PixelOption[]> {
  const data = await gateway.callTool("pixel_list_get", { advertiser_id: advertiserId, page_size: 20 });
  const out: PixelOption[] = [];
  for (const raw of rows(data, ["pixels", "list"])) {
    const id = first(raw, ["pixel_id"]);
    if (!id) continue;
    const events = options(
      Array.isArray(raw.events) ? raw.events.filter(isRecord) : [],
      ["optimization_event", "event_type", "event_code"],
      ["name", "event_type", "optimization_event"],
    );
    out.push({ id, label: first(raw, ["pixel_name", "name"]) ?? id, detail: first(raw, ["pixel_code"]) ?? undefined, events });
  }
  return out;
}

/** Standard CTA values TikTok recommends for landing-page ads. */
export async function listCallToActions(gateway: TikTokGateway, advertiserId: string): Promise<Option[]> {
  const data = await gateway.callTool("creative_cta_recommend_get", {
    advertiser_id: advertiserId,
    asset_type: "CTA_NORMAL",
    content_type: "LANDING_PAGE",
  });
  const list = rows(data, ["recommend_assets", "cta_list", "list"]);
  return options(list, ["asset_content", "call_to_action"], ["asset_content", "call_to_action"]).map((o) => ({
    ...o,
    label: o.label.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
  }));
}

export interface IdentityOption {
  identityId: string;
  identityType: string;
  displayName: string;
  identityAuthorizedBcId: string | null;
}

export async function listIdentities(gateway: TikTokGateway, advertiserId: string): Promise<IdentityOption[]> {
  const data = await gateway.callTool("identity_get", { advertiser_id: advertiserId, page_size: 100 });
  return rows(data, ["identity_list", "list"])
    .map((raw) => ({
      identityId: str(raw.identity_id) ?? "",
      identityType: str(raw.identity_type) ?? "",
      displayName: str(raw.display_name) ?? str(raw.identity_id) ?? "",
      identityAuthorizedBcId: str(raw.identity_authorized_bc_id),
    }))
    .filter((i) => i.identityId && i.identityType);
}

export interface SparkPost {
  tiktokItemId: string;
  identityId: string;
  identityType: "AUTH_CODE";
  displayName: string | null;
  caption: string | null;
}

/** TikTok asks for "+" in a Spark code to be sent as "%2B". */
const encodeSparkCode = (code: string) => code.trim().replace(/\+/g, "%2B");

/**
 * Applies a creator's Spark code to the ad account and returns the post it authorizes.
 * Applying the code is a write on the ad account; reading the post is not.
 */
export async function redeemSparkCode(gateway: TikTokGateway, advertiserId: string, code: string): Promise<SparkPost> {
  const authCode = encodeSparkCode(code);
  await gateway.callTool("tt_video_authorize_apply", { advertiser_id: advertiserId, auth_code: authCode });
  const data = await gateway.callTool("tt_video_info_get", { advertiser_id: advertiserId, auth_code: authCode });
  const item = isRecord(data.item_info) ? data.item_info : data;
  const user = isRecord(data.user_info) ? data.user_info : {};
  const tiktokItemId = first(item, ["item_id"]);
  const identityId = first(user, ["identity_id"]) ?? first(item, ["identity_id"]) ?? first(data, ["identity_id"]);
  if (!tiktokItemId || !identityId) {
    throw new Error("TikTok accepted the Spark code but did not return the post details needed to build the ad.");
  }
  return {
    tiktokItemId,
    identityId,
    identityType: "AUTH_CODE",
    displayName: first(user, ["display_name", "tiktok_name"]),
    caption: first(item, ["text", "caption"]),
  };
}
