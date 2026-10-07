import Link from "next/link";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { ErrorBanner } from "@/components/ui/primitives";
import { requireContext } from "@/server/context";
import { getActivity, getCachedAdAccounts, getCachedCampaignDetail, getConnection } from "@/server/queries";

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ account?: string; bc?: string }>;
}) {
  const ctx = await requireContext();
  const { campaignId } = await params;
  const query = await searchParams;
  const accounts = await getCachedAdAccounts(ctx.workspaceId, null);
  const account = accounts.find((a) => a.id === query.account);

  if (!account) {
    return (
      <ErrorBanner
        action={
          <Link href="/campaigns" className="font-medium underline">
            Back to campaigns
          </Link>
        }
      >
        Select an ad account first. A campaign can only be opened in the context of its ad account.
      </ErrorBanner>
    );
  }

  const [connection, cached] = await Promise.all([
    getConnection(ctx.workspaceId),
    getCachedCampaignDetail(ctx.workspaceId, account.id, campaignId),
  ]);
  const activity = cached
    ? await getActivity(ctx.workspaceId, { resourceIds: [campaignId, ...cached.adGroups.map((g) => g.id)], take: 50 })
    : [];

  return (
    <CampaignDetail
      advertiserId={account.id}
      campaignId={campaignId}
      bcId={query.bc ?? null}
      account={account}
      connected={connection.status === "CONNECTED"}
      initial={cached ? { ...cached, activity } : null}
    />
  );
}
