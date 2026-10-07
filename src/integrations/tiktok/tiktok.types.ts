// Types for the TikTok integration layer. Field names mirror what the official TikTok
// for Business MCP tools accept and return; nothing here is invented beyond that.

export type EntityStatus =
  | "ACTIVE"
  | "PAUSED"
  | "PENDING"
  | "UNDER_REVIEW"
  | "REJECTED"
  | "DISABLED"
  | "UNKNOWN";

export type OperationStatusAction = "ENABLE" | "DISABLE";

export type BudgetMode =
  | "BUDGET_MODE_INFINITE"
  | "BUDGET_MODE_TOTAL"
  | "BUDGET_MODE_DYNAMIC_DAILY_BUDGET"
  | "BUDGET_MODE_DAY";

export type Raw = Record<string, unknown>;

/** The single seam between the application and the MCP. */
export interface TikTokGateway {
  /** Calls an MCP tool and returns the `data` part of the TikTok response envelope. */
  callTool<T = Raw>(name: string, args: Record<string, unknown>): Promise<T>;
}

export interface BusinessCenterModel {
  externalBcId: string;
  name: string;
  type: string | null;
  status: string | null;
  userRole: string | null;
  raw: Raw;
}

export interface AdAccountModel {
  externalAdvertiserId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  raw: Raw;
}

export interface CampaignModel {
  externalCampaignId: string;
  advertiserId: string;
  name: string;
  objective: string | null;
  status: EntityStatus;
  externalStatus: string | null;
  operationStatus: string | null;
  budgetMode: string | null;
  budget: number | null;
  budgetOptimizeOn: boolean | null;
  /** TikTok campaign_automation_type, e.g. MANUAL or UPGRADED_SMART_PLUS. */
  automationType: string | null;
  createTime: string | null;
  modifyTime: string | null;
  raw: Raw;
}

export interface AdGroupModel {
  externalAdGroupId: string;
  externalCampaignId: string;
  name: string;
  status: EntityStatus;
  externalStatus: string | null;
  operationStatus: string | null;
  budgetMode: string | null;
  budget: number | null;
  scheduledBudget: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  targeting: Raw;
  raw: Raw;
}

export interface AdModel {
  externalAdId: string;
  externalAdGroupId: string;
  externalCampaignId: string | null;
  name: string;
  status: EntityStatus;
  externalStatus: string | null;
  operationStatus: string | null;
  adFormat: string | null;
  adText: string | null;
  callToAction: string | null;
  landingPageUrl: string | null;
  raw: Raw;
}

export interface Metrics {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  conversions: number | null;
  costPerConversion: number | null;
}

export const EMPTY_METRICS: Metrics = {
  spend: null,
  impressions: null,
  clicks: null,
  ctr: null,
  conversions: null,
  costPerConversion: null,
};
