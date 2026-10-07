import { CampaignManager } from "@/components/campaigns/campaign-manager";
import { requireContext } from "@/server/context";
import { getCachedAdAccounts, getCachedBusinessCenters, getCachedCampaigns, getConnection } from "@/server/queries";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ bc?: string; account?: string }>;
}) {
  const ctx = await requireContext();
  const params = await searchParams;
  const selectedBc = params.bc ?? null;

  const [connection, businessCenters, accounts] = await Promise.all([
    getConnection(ctx.workspaceId),
    getCachedBusinessCenters(ctx.workspaceId),
    getCachedAdAccounts(ctx.workspaceId, selectedBc),
  ]);
  // Only accept an account that belongs to the current selection.
  const selectedAccount = accounts.some((a) => a.id === params.account) ? (params.account as string) : null;
  const campaigns = selectedAccount ? await getCachedCampaigns(ctx.workspaceId, selectedAccount) : [];

  return (
    <CampaignManager
      businessCenters={businessCenters}
      accounts={accounts}
      selectedBc={selectedBc}
      selectedAccount={selectedAccount}
      connected={connection.status === "CONNECTED"}
      initialCampaigns={campaigns}
    />
  );
}
