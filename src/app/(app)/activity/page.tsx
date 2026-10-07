import { ActivityList } from "@/components/campaigns/activity-list";
import { requireContext } from "@/server/context";
import { getActivity } from "@/server/queries";

export default async function ActivityPage() {
  const ctx = await requireContext();
  const rows = await getActivity(ctx.workspaceId, { take: 200 });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Activity</h1>
        <p className="text-sm text-slate-500">The latest 200 changes sent to TikTok from this workspace, with their verified result.</p>
      </div>
      <div className="card">
        <ActivityList rows={rows} showResource />
      </div>
    </div>
  );
}
