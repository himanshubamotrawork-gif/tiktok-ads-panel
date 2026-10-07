import Link from "next/link";
import { CreateWizard } from "@/components/campaigns/create-wizard";
import { ErrorBanner } from "@/components/ui/primitives";
import { writesEnabled } from "@/server/action-utils";
import { requireContext } from "@/server/context";
import { getCachedAdAccounts, getCachedBusinessCenters, getConnection } from "@/server/queries";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; bc?: string }>;
}) {
  const ctx = await requireContext();
  const query = await searchParams;
  const [connection, accounts, businessCenters] = await Promise.all([
    getConnection(ctx.workspaceId),
    getCachedAdAccounts(ctx.workspaceId, null),
    getCachedBusinessCenters(ctx.workspaceId),
  ]);
  const account = accounts.find((a) => a.id === query.account);
  const back = (
    <Link href="/campaigns" className="font-medium underline">
      Back to campaigns
    </Link>
  );

  if (connection.status !== "CONNECTED") {
    return <ErrorBanner action={back}>Connect TikTok in Settings before creating a campaign.</ErrorBanner>;
  }
  if (!account) {
    return <ErrorBanner action={back}>Select an ad account first. A campaign is always created in a specific ad account.</ErrorBanner>;
  }
  const bc = businessCenters.find((b) => b.id === query.bc) ?? null;
  return <CreateWizard account={account} bcName={bc?.name ?? null} bcId={bc?.id ?? null} writesEnabled={writesEnabled()} />;
}
