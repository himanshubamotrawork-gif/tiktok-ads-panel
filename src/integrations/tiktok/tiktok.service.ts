import { listOf, mapAdAccount, mapBusinessCenter, str, totalPages } from "./tiktok.mappers";
import type { AdAccountModel, BusinessCenterModel, Raw, TikTokGateway } from "./tiktok.types";

const MAX_PAGES = 20;

/** Reads every page of a paginated TikTok list tool, up to MAX_PAGES. */
export async function fetchAllPages(
  gateway: TikTokGateway,
  tool: string,
  args: Record<string, unknown>,
  pageSize: number,
  listKey = "list",
): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await gateway.callTool(tool, { ...args, page, page_size: pageSize });
    const batch = listOf(data, listKey);
    rows.push(...batch);
    if (page >= totalPages(data) || batch.length === 0) break;
  }
  return rows;
}

export async function getConnectedUser(gateway: TikTokGateway) {
  const data = await gateway.callTool("user_info_get", {});
  return { externalUserId: str(data.core_user_id), displayName: str(data.display_name) };
}

export async function listBusinessCenters(gateway: TikTokGateway): Promise<BusinessCenterModel[]> {
  const rows = await fetchAllPages(gateway, "bc_get", {}, 50);
  return rows.map(mapBusinessCenter).filter((bc): bc is BusinessCenterModel => bc !== null);
}

/**
 * Ad accounts in a Business Center that the connected user can access, enriched with
 * currency, time zone and status from advertiser_info_get.
 */
export async function listAdAccounts(gateway: TikTokGateway, bcId: string): Promise<AdAccountModel[]> {
  const assets = await fetchAllPages(gateway, "bc_asset_get", { bc_id: bcId, asset_type: "ADVERTISER" }, 50);
  const base = assets.map(mapAdAccount).filter((a): a is AdAccountModel => a !== null);
  return enrichAdAccounts(gateway, base);
}

/** Ad accounts the token is authorized for, regardless of Business Center. */
export async function listAuthorizedAdAccounts(gateway: TikTokGateway): Promise<AdAccountModel[]> {
  const data = await gateway.callTool("auth_advertiser_get", {});
  const base = listOf(data).map(mapAdAccount).filter((a): a is AdAccountModel => a !== null);
  return enrichAdAccounts(gateway, base);
}

const INFO_FIELDS = ["advertiser_id", "name", "currency", "timezone", "display_timezone", "status", "country", "role", "owner_bc_id"];

async function enrichAdAccounts(gateway: TikTokGateway, accounts: AdAccountModel[]): Promise<AdAccountModel[]> {
  const byId = new Map(accounts.map((a) => [a.externalAdvertiserId, a]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gateway.callTool("advertiser_info_get", {
      advertiser_ids: ids.slice(i, i + 50),
      fields: INFO_FIELDS,
    });
    for (const raw of listOf(data)) {
      const detailed = mapAdAccount(raw);
      if (!detailed) continue;
      const existing = byId.get(detailed.externalAdvertiserId);
      byId.set(detailed.externalAdvertiserId, {
        ...detailed,
        name: detailed.name === detailed.externalAdvertiserId && existing ? existing.name : detailed.name,
        raw: { ...(existing?.raw ?? {}), ...raw },
      });
    }
  }
  return [...byId.values()];
}
