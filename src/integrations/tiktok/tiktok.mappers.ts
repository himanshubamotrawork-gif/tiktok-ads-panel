import { TikTokError, errorFromEnvelope } from "./tiktok.errors";
import type {
  AdAccountModel,
  AdGroupModel,
  AdModel,
  BusinessCenterModel,
  CampaignModel,
  EntityStatus,
  Metrics,
  Raw,
} from "./tiktok.types";

// ---------- response envelope ----------

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(result: ToolResultLike): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * Unwraps an MCP tool result into the `data` of the TikTok envelope
 * `{ code, message, request_id, data }`. A non-zero code becomes a TikTokError.
 */
export function parseToolResult<T = Raw>(tool: string, result: ToolResultLike): T {
  const text = textOf(result);
  let payload: unknown = result.structuredContent;
  if (!isRecord(payload)) {
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
  }
  if (!isRecord(payload)) {
    throw new TikTokError(
      result.isError ? "TIKTOK_REJECTED" : "UNKNOWN",
      text || "TikTok returned a response that could not be read.",
      { tool, tiktokMessage: text || undefined },
    );
  }
  const code = typeof payload.code === "number" ? payload.code : undefined;
  const message = typeof payload.message === "string" ? payload.message : "";
  const requestId = typeof payload.request_id === "string" ? payload.request_id : undefined;
  if (code !== undefined && code !== 0) throw errorFromEnvelope(tool, code, message, requestId);
  if (code === undefined && result.isError) {
    throw new TikTokError("TIKTOK_REJECTED", message || text, { tool, tiktokMessage: message || text });
  }
  return (payload.data ?? {}) as T;
}

// ---------- primitives ----------

export function str(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (typeof value === "number") return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && value !== "-") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function listOf(data: unknown, key = "list"): Raw[] {
  if (!isRecord(data)) return [];
  const list = data[key];
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

export function totalPages(data: unknown): number {
  if (!isRecord(data) || !isRecord(data.page_info)) return 1;
  return num(data.page_info.total_page) ?? 1;
}

// ---------- status normalization ----------

/**
 * Maps TikTok's delivery status onto the internal model. TikTok reports a detailed
 * `secondary_status` (for example CAMPAIGN_STATUS_DISABLE, ADGROUP_STATUS_AUDIT_DENY,
 * AD_STATUS_DELIVERY_OK) and a coarse `operation_status` (ENABLE / DISABLE). The
 * original value is always stored alongside as externalStatus.
 */
export function normalizeStatus(
  secondaryStatus: string | null | undefined,
  operationStatus: string | null | undefined,
): EntityStatus {
  const s = (secondaryStatus ?? "").toUpperCase();
  if (s) {
    if (s.includes("DELETE")) return "DISABLED";
    if (s.includes("AUDIT_DENY") || s.includes("REJECT") || s.includes("PUNISH")) return "REJECTED";
    if (s.includes("AUDIT")) return "UNDER_REVIEW";
    if (s.includes("DISABLE") || s.includes("FROZEN")) return "PAUSED";
    if (s.includes("NOT_START") || s.includes("PENDING") || s.includes("CREATE")) return "PENDING";
    if (s.includes("BUDGET_EXCEED") || s.includes("BALANCE_EXCEED") || s.includes("TIME_DONE") || s.includes("DONE")) {
      return "DISABLED";
    }
    if (s.includes("DELIVERY_OK") || s.endsWith("_ENABLE") || s === "ENABLE") return "ACTIVE";
  }
  const op = (operationStatus ?? "").toUpperCase();
  if (s === "" && op === "ENABLE") return "ACTIVE";
  if (s === "" && op === "DISABLE") return "PAUSED";
  return "UNKNOWN";
}

// ---------- entities ----------

export function mapBusinessCenter(raw: Raw): BusinessCenterModel | null {
  // /bc/get/ returns each item as { bc_info: {...}, user_role, ... }; tolerate a flat item too.
  const info = isRecord(raw.bc_info) ? raw.bc_info : raw;
  const id = str(info.bc_id);
  if (!id) return null;
  return {
    externalBcId: id,
    name: str(info.name) ?? id,
    type: str(info.type),
    status: str(info.status),
    userRole: str(raw.user_role),
    raw,
  };
}

export function mapAdAccount(raw: Raw): AdAccountModel | null {
  const id = str(raw.advertiser_id) ?? str(raw.asset_id);
  if (!id) return null;
  return {
    externalAdvertiserId: id,
    name: str(raw.name) ?? str(raw.advertiser_name) ?? str(raw.asset_name) ?? id,
    currency: str(raw.currency),
    timezone: str(raw.display_timezone) ?? str(raw.timezone),
    status: str(raw.status) ?? str(raw.advertiser_status),
    raw,
  };
}

export function mapCampaign(raw: Raw): CampaignModel | null {
  const id = str(raw.campaign_id);
  if (!id) return null;
  const secondary = str(raw.secondary_status);
  const operation = str(raw.operation_status);
  return {
    externalCampaignId: id,
    advertiserId: str(raw.advertiser_id) ?? "",
    name: str(raw.campaign_name) ?? id,
    objective: str(raw.objective_type),
    status: normalizeStatus(secondary, operation),
    externalStatus: secondary ?? operation,
    operationStatus: operation,
    budgetMode: str(raw.budget_mode),
    budget: num(raw.budget),
    budgetOptimizeOn: bool(raw.budget_optimize_on),
    automationType: str(raw.campaign_automation_type),
    createTime: str(raw.create_time),
    modifyTime: str(raw.modify_time),
    raw,
  };
}

const TARGETING_KEYS = [
  "location_ids",
  "zipcode_ids",
  "gender",
  "age_groups",
  "languages",
  "operating_systems",
  "placement_type",
  "placements",
  "interest_category_ids",
  "audience_ids",
  "excluded_audience_ids",
  "device_price_ranges",
  "network_types",
];

export function mapAdGroup(raw: Raw): AdGroupModel | null {
  const id = str(raw.adgroup_id);
  if (!id) return null;
  const secondary = str(raw.secondary_status);
  const operation = str(raw.operation_status);
  const targeting: Raw = {};
  for (const key of TARGETING_KEYS) {
    const value = raw[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    targeting[key] = value;
  }
  return {
    externalAdGroupId: id,
    externalCampaignId: str(raw.campaign_id) ?? "",
    name: str(raw.adgroup_name) ?? id,
    status: normalizeStatus(secondary, operation),
    externalStatus: secondary ?? operation,
    operationStatus: operation,
    budgetMode: str(raw.budget_mode),
    budget: num(raw.budget),
    scheduledBudget: num(raw.scheduled_budget),
    bidStrategy: str(raw.bid_type),
    optimizationGoal: str(raw.optimization_goal),
    targeting,
    raw,
  };
}

export function mapAd(raw: Raw): AdModel | null {
  // Upgraded Smart+ ads are identified by ad_id_v2 / smart_plus_ad_id.
  const id = str(raw.ad_id) ?? str(raw.smart_plus_ad_id) ?? str(raw.ad_id_v2);
  if (!id) return null;
  const secondary = str(raw.secondary_status);
  const operation = str(raw.operation_status);
  return {
    externalAdId: id,
    externalAdGroupId: str(raw.adgroup_id) ?? "",
    externalCampaignId: str(raw.campaign_id),
    name: str(raw.ad_name) ?? id,
    status: normalizeStatus(secondary, operation),
    externalStatus: secondary ?? operation,
    operationStatus: operation,
    adFormat: str(raw.ad_format),
    adText: str(raw.ad_text),
    callToAction: str(raw.call_to_action),
    landingPageUrl: str(raw.landing_page_url),
    raw,
  };
}

/**
 * Maps one row of a synchronous report. Rows have the shape
 * `{ dimensions: {...}, metrics: {...} }`; metric values arrive as strings.
 */
export function mapMetrics(metrics: unknown): Metrics {
  const m = isRecord(metrics) ? metrics : {};
  return {
    spend: num(m.spend),
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    ctr: num(m.ctr),
    conversions: num(m.conversion),
    costPerConversion: num(m.cost_per_conversion),
  };
}

export function mapMetricRows(data: unknown, idDimension: string): Map<string, Metrics> {
  const out = new Map<string, Metrics>();
  for (const row of listOf(data)) {
    const id = isRecord(row.dimensions) ? str(row.dimensions[idDimension]) : null;
    if (id) out.set(id, mapMetrics(row.metrics));
  }
  return out;
}
