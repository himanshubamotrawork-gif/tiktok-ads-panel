import type { CampaignDraft } from "@/integrations/tiktok/tiktok.draft";
import { TikTokError } from "@/integrations/tiktok/tiktok.errors";
import type { Raw, TikTokGateway } from "@/integrations/tiktok/tiktok.types";
import type {
  ActivityEntry,
  NewOperation,
  OperationContext,
  OperationStatus,
  OperationStore,
} from "@/server/operations/runner";

export const ctx: OperationContext = { workspaceId: "ws1", userId: "u1", userName: "Himanshu" };
export const ADVERTISER = "700001";

export class MemoryStore implements OperationStore {
  operations: (NewOperation & { id: string; status: OperationStatus; error?: string; technicalError?: string })[] = [];
  activity: ActivityEntry[] = [];

  async createOperation(input: NewOperation) {
    const id = `op${this.operations.length + 1}`;
    this.operations.push({ ...input, id, status: "QUEUED" });
    return id;
  }
  async markRunning(id: string) {
    this.find(id).status = "RUNNING";
  }
  async complete(id: string, status: OperationStatus, error?: string, technicalError?: string) {
    Object.assign(this.find(id), { status, error, technicalError });
  }
  async setResource(id: string, resourceId: string) {
    this.find(id).resourceId = resourceId;
  }
  async logActivity(entry: ActivityEntry) {
    this.activity.push(entry);
  }
  private find(id: string) {
    const op = this.operations.find((o) => o.id === id);
    if (!op) throw new Error(`unknown operation ${id}`);
    return op;
  }
}

/**
 * In-memory stand-in for the TikTok MCP. It implements just enough of the real tools'
 * request and response shapes to exercise the workflows. No network, no real writes.
 */
export class FakeTikTok implements TikTokGateway {
  campaigns = new Map<string, Raw>();
  adGroups = new Map<string, Raw>();
  ads = new Map<string, Raw>();
  calls: { name: string; args: Record<string, unknown> }[] = [];
  /** Tools that should throw the given error when called. */
  failures = new Map<string, Error>();
  /** When true, status updates are accepted but silently not applied. */
  ignoreStatusUpdates = false;
  /** When true, a campaign asked to be created paused comes back enabled. */
  ignorePausedOnCreate = false;
  /** When true, adgroup_update is accepted but silently not applied. */
  ignoreAdGroupUpdates = false;
  spend = new Map<string, number>();
  private nextId = 1000;

  addCampaign(raw: Raw) {
    this.campaigns.set(String(raw.campaign_id), { advertiser_id: ADVERTISER, ...raw });
  }
  addAdGroup(raw: Raw) {
    this.adGroups.set(String(raw.adgroup_id), { advertiser_id: ADVERTISER, ...raw });
  }

  async callTool<T = Raw>(name: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ name, args });
    const failure = this.failures.get(name);
    if (failure) throw failure;
    return this.handle(name, args) as T;
  }

  private page(list: Raw[]) {
    return { list, page_info: { page: 1, page_size: 100, total_number: list.length, total_page: 1 } };
  }

  private handle(name: string, args: Record<string, unknown>): Raw {
    const filtering = (args.filtering ?? {}) as Record<string, string[] | undefined>;
    switch (name) {
      case "campaign_get": {
        const ids = filtering.campaign_ids;
        return this.page([...this.campaigns.values()].filter((c) => !ids || ids.includes(String(c.campaign_id))));
      }
      case "adgroup_get": {
        return this.page(
          [...this.adGroups.values()].filter(
            (g) =>
              (!filtering.adgroup_ids || filtering.adgroup_ids.includes(String(g.adgroup_id))) &&
              (!filtering.campaign_ids || filtering.campaign_ids.includes(String(g.campaign_id))),
          ),
        );
      }
      case "ad_get": {
        return this.page(
          [...this.ads.values()].filter(
            (a) => !filtering.campaign_ids || filtering.campaign_ids.includes(String(a.campaign_id)),
          ),
        );
      }
      case "campaign_status_update": {
        if (!this.ignoreStatusUpdates) {
          for (const id of args.campaign_ids as string[]) {
            const campaign = this.require(this.campaigns, id);
            campaign.operation_status = args.operation_status;
            campaign.secondary_status =
              args.operation_status === "ENABLE" ? "CAMPAIGN_STATUS_ENABLE" : "CAMPAIGN_STATUS_DISABLE";
          }
        }
        return { campaign_ids: args.campaign_ids };
      }
      case "campaign_update": {
        const campaign = this.require(this.campaigns, String(args.campaign_id));
        if (args.campaign_name !== undefined) campaign.campaign_name = args.campaign_name;
        if (args.budget !== undefined) campaign.budget = args.budget;
        return { campaign_id: args.campaign_id };
      }
      case "campaign_create":
      case "smart_plus_campaign_create": {
        const id = String(this.nextId++);
        const paused = args.operation_status === "DISABLE" && !this.ignorePausedOnCreate;
        this.addCampaign({
          campaign_id: id,
          campaign_name: args.campaign_name,
          objective_type: args.objective_type,
          budget_mode: args.budget_mode,
          budget: args.budget ?? 0,
          budget_optimize_on: args.budget_optimize_on ?? false,
          operation_status: paused ? "DISABLE" : "ENABLE",
          secondary_status: paused ? "CAMPAIGN_STATUS_DISABLE" : "CAMPAIGN_STATUS_ENABLE",
          ...(name === "smart_plus_campaign_create" ? { campaign_automation_type: "UPGRADED_SMART_PLUS" } : {}),
        });
        return { campaign_id: id };
      }
      case "smart_plus_ad_create": {
        const id = String(this.nextId++);
        const adGroup = this.require(this.adGroups, String(args.adgroup_id));
        this.ads.set(id, {
          smart_plus_ad_id: id,
          ad_name: args.ad_name,
          adgroup_id: args.adgroup_id,
          campaign_id: adGroup.campaign_id,
          operation_status: "ENABLE",
          secondary_status: "AD_STATUS_AUDIT",
        });
        return { smart_plus_ad_id: id };
      }
      case "adgroup_update": {
        const adGroup = this.require(this.adGroups, String(args.adgroup_id));
        if (!this.ignoreAdGroupUpdates) {
          const fields = { ...args };
          delete fields.advertiser_id;
          delete fields.adgroup_id;
          Object.assign(adGroup, fields);
        }
        return { adgroup_id: args.adgroup_id };
      }
      case "adgroup_create":
      case "smart_plus_adgroup_create": {
        const id = String(this.nextId++);
        this.addAdGroup({
          ...args,
          adgroup_id: id,
          operation_status: "ENABLE",
          secondary_status: "ADGROUP_STATUS_CAMPAIGN_DISABLE",
        });
        return { adgroup_id: id };
      }
      case "ad_create": {
        const id = String(this.nextId++);
        const adGroup = this.require(this.adGroups, String(args.adgroup_id));
        const creative = (args.creatives as Raw[])[0] ?? {};
        this.ads.set(id, {
          ...creative,
          ad_id: id,
          adgroup_id: args.adgroup_id,
          campaign_id: adGroup.campaign_id,
          operation_status: "ENABLE",
          secondary_status: "AD_STATUS_AUDIT",
        });
        return { ad_ids: [id] };
      }
      case "adgroup_budget_update": {
        for (const item of (args.budget as Raw[] | undefined) ?? []) {
          this.require(this.adGroups, String(item.adgroup_id)).budget = item.budget;
        }
        for (const item of (args.scheduled_budget as Raw[] | undefined) ?? []) {
          this.require(this.adGroups, String(item.adgroup_id)).scheduled_budget = item.scheduled_budget;
        }
        return {};
      }
      case "report_integrated_get": {
        const list = [...this.spend.entries()].map(([id, spend]) => ({
          dimensions: { campaign_id: id },
          metrics: { spend: String(spend) },
        }));
        return this.page(list);
      }
      default:
        throw new Error(`FakeTikTok: unhandled tool ${name}`);
    }
  }

  private require(map: Map<string, Raw>, id: string): Raw {
    const item = map.get(id);
    if (!item) throw new TikTokError("TIKTOK_REJECTED", `Object ${id} does not exist`);
    return item;
  }

  toolNames() {
    return this.calls.map((c) => c.name);
  }
}

/** A valid manual Traffic draft with an ad-group budget and a Spark Ad. */
export function trafficDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    advertiserId: ADVERTISER,
    typeId: "TRAFFIC:MANUAL",
    name: "New Campaign",
    adGroupName: "Ad Group 1",
    destinationId: "WEBSITE",
    optimizationGoal: "CLICK",
    audience: {
      mode: "CUSTOM",
      locationIds: ["6252001"],
      ageGroups: [],
      smartAge: "OVER_EIGHTEEN",
      gender: "GENDER_UNLIMITED",
      languages: [],
      os: "",
      interestCategoryIds: [],
      audienceIds: [],
      excludedAudienceIds: [],
    },
    budget: { level: "ADGROUP", type: "DAILY", amount: 50 },
    schedule: { startTime: "2026-10-08 00:00:00" },
    bidding: { strategy: "BID_TYPE_NO_BID", pacing: "PACING_MODE_SMOOTH" },
    creative: { adName: "Ad 1", source: "SPARK_POST", identityType: "TT_USER", identityId: "id1", tiktokItemId: "7000000000000000001" },
    destination: { landingPageUrl: "https://example.com", callToAction: "LEARN_MORE" },
    ...overrides,
  };
}

/** A valid automatic (Smart+) website-sales draft optimizing for a pixel event. */
export function smartPlusDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  const base = trafficDraft();
  return {
    ...base,
    typeId: "WEB_CONVERSIONS:AUTOMATIC",
    optimizationGoal: "CONVERT",
    audience: { ...base.audience, mode: "AUTOMATIC" },
    budget: { level: "CAMPAIGN", type: "DAILY", amount: 50 },
    creative: { adName: "Ad 1", source: "SPARK_CODE", identityType: "AUTH_CODE", identityId: "auth1", tiktokItemId: "7000000000000000001" },
    destination: { landingPageUrl: "https://example.com", pixelId: "px1", optimizationEvent: "SHOPPING", ctaPortfolioId: "cta9" },
    ...overrides,
  };
}

export function activeCampaign(overrides: Raw = {}): Raw {
  return {
    campaign_id: "c1",
    campaign_name: "Test Campaign",
    objective_type: "TRAFFIC",
    budget_mode: "BUDGET_MODE_DAY",
    budget: 50,
    budget_optimize_on: true,
    operation_status: "ENABLE",
    secondary_status: "CAMPAIGN_STATUS_ENABLE",
    ...overrides,
  };
}
