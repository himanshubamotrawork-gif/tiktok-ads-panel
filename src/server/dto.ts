// Plain serializable shapes passed from the server to client components.

import type { Ad, AdGroup, ActivityLog, AdAccount, BusinessCenter, Campaign } from "@prisma/client";
import type { EntityStatus, Metrics } from "@/integrations/tiktok/tiktok.types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface BusinessCenterRow {
  id: string;
  name: string;
  status: string | null;
  userRole: string | null;
  lastSyncedAt: string;
}

export interface AdAccountRow {
  id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  lastSyncedAt: string;
}

export interface CampaignRow {
  id: string;
  name: string;
  objective: string | null;
  status: EntityStatus;
  externalStatus: string | null;
  operationStatus: string | null;
  budgetMode: string | null;
  budget: number | null;
  budgetOptimizeOn: boolean | null;
  /** True for TikTok's automatic (Upgraded Smart+) campaigns. */
  automatic: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string;
}

export interface AdGroupRow {
  id: string;
  name: string;
  status: EntityStatus;
  externalStatus: string | null;
  budgetMode: string | null;
  budget: number | null;
  scheduledBudget: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  targeting: Record<string, unknown>;
  /** Current cost cap, when the ad group uses one. */
  bidAmount: number | null;
  scheduleEndTime: string | null;
}

export interface AdRow {
  id: string;
  adGroupId: string;
  name: string;
  status: EntityStatus;
  externalStatus: string | null;
  adFormat: string | null;
  adText: string | null;
  callToAction: string | null;
  landingPageUrl: string | null;
}

export interface ActivityRow {
  id: string;
  userName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  before: unknown;
  after: unknown;
  result: string;
  message: string | null;
  createdAt: string;
}

export type MetricsById = Record<string, Metrics>;

export interface CampaignListData {
  campaigns: CampaignRow[];
  metrics: MetricsById;
  /** Set when campaigns loaded but the performance report did not. */
  metricsError: string | null;
}

export interface CampaignDetailData {
  campaign: CampaignRow;
  adGroups: AdGroupRow[];
  ads: AdRow[];
  campaignMetrics: Metrics | null;
  adMetrics: MetricsById;
  metricsError: string | null;
  activity: ActivityRow[];
}

export interface BulkResultRow {
  campaignId: string;
  name: string;
  ok: boolean;
  message: string;
}

const positive = (value: unknown): number | null => (typeof value === "number" && value > 0 ? value : null);

const dec = (value: { toNumber(): number } | null): number | null => (value === null ? null : value.toNumber());

export const toBusinessCenterRow = (bc: BusinessCenter): BusinessCenterRow => ({
  id: bc.externalBcId,
  name: bc.name,
  status: bc.status,
  userRole: bc.userRole,
  lastSyncedAt: bc.lastSyncedAt.toISOString(),
});

export const toAdAccountRow = (a: AdAccount): AdAccountRow => ({
  id: a.externalAdvertiserId,
  name: a.name,
  currency: a.currency,
  timezone: a.timezone,
  status: a.status,
  lastSyncedAt: a.lastSyncedAt.toISOString(),
});

export const toCampaignRow = (c: Campaign): CampaignRow => ({
  id: c.externalCampaignId,
  name: c.name,
  objective: c.objective,
  status: c.status,
  externalStatus: c.externalStatus,
  operationStatus: c.operationStatus,
  budgetMode: c.budgetMode,
  budget: dec(c.budgetAmount),
  budgetOptimizeOn: c.budgetOptimizeOn,
  automatic: (c.raw as Record<string, unknown> | null)?.campaign_automation_type === "UPGRADED_SMART_PLUS",
  createdAt: c.externalCreatedAt,
  updatedAt: c.externalUpdatedAt,
  lastSyncedAt: c.lastSyncedAt.toISOString(),
});

export const toAdGroupRow = (g: AdGroup): AdGroupRow => {
  const raw = (g.raw ?? {}) as Record<string, unknown>;
  const scheduled = typeof raw.scheduled_budget === "number" ? raw.scheduled_budget : null;
  return {
    id: g.externalAdGroupId,
    name: g.name,
    status: g.status,
    externalStatus: g.externalStatus,
    budgetMode: g.budgetMode,
    budget: dec(g.budgetAmount),
    scheduledBudget: scheduled,
    bidStrategy: g.bidStrategy,
    optimizationGoal: g.optimizationGoal,
    targeting: (g.targeting ?? {}) as Record<string, unknown>,
    bidAmount: g.bidStrategy === "BID_TYPE_CUSTOM" ? positive(raw.conversion_bid_price) ?? positive(raw.bid_price) : null,
    scheduleEndTime: typeof raw.schedule_end_time === "string" ? raw.schedule_end_time : null,
  };
};

export const toAdRow = (a: Ad & { adGroup: { externalAdGroupId: string } }): AdRow => ({
  id: a.externalAdId,
  adGroupId: a.adGroup.externalAdGroupId,
  name: a.name,
  status: a.status,
  externalStatus: a.externalStatus,
  adFormat: a.adFormat,
  adText: a.adText,
  callToAction: a.callToAction,
  landingPageUrl: a.landingPageUrl,
});

export const toActivityRow = (a: ActivityLog): ActivityRow => ({
  id: a.id,
  userName: a.userName,
  action: a.action,
  resourceType: a.resourceType,
  resourceId: a.resourceId,
  resourceName: a.resourceName,
  before: a.before,
  after: a.after,
  result: a.result,
  message: a.message,
  createdAt: a.createdAt.toISOString(),
});
