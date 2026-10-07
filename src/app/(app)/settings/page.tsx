import { AddMemberForm } from "@/components/add-member-form";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ErrorBanner } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { writesEnabled } from "@/server/action-utils";
import { disconnectTikTokAction } from "@/server/actions/auth";
import { requireContext } from "@/server/context";
import { getCachedAdAccounts, getConnection } from "@/server/queries";

const STATUS: Record<string, { label: string; className: string }> = {
  CONNECTED: { label: "Connected", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REAUTH_REQUIRED: { label: "Reconnect required", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  DISCONNECTED: { label: "Not connected", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const ctx = await requireContext();
  const params = await searchParams;
  const connection = await getConnection(ctx.workspaceId);
  const members = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const accounts = await getCachedAdAccounts(ctx.workspaceId, null);
  const writes = writesEnabled();
  const status = STATUS[connection.status] ?? STATUS.DISCONNECTED!;
  const owner = ctx.role === "OWNER";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-lg font-semibold text-slate-900">Settings</h1>

      {params.error && <ErrorBanner>{params.error}</ErrorBanner>}
      {params.connected && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          TikTok authorized this workspace. Open Campaigns and refresh to load your Business Centers.
        </div>
      )}

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">TikTok connection</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.className}`}>{status.label}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          This workspace connects to the official TikTok for Business MCP. You sign in on TikTok and choose what to
          share; no TikTok API key or developer app is used, and the authorization is stored encrypted on the server.
        </p>
        <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">TikTok user</dt>
          <dd className="text-slate-800">{connection.displayName ?? "Not available"}</dd>
          <dt className="text-slate-500">Last updated</dt>
          <dd className="text-slate-800">{connection.updatedAt ? new Date(connection.updatedAt).toLocaleString() : "Never"}</dd>
          {connection.lastError && (
            <>
              <dt className="text-slate-500">Last problem</dt>
              <dd className="text-amber-700">{connection.lastError}</dd>
            </>
          )}
        </dl>
        {owner ? (
          <div className="mt-4 flex gap-2">
            <a
              href="/api/tiktok/oauth/start"
              className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
            >
              {connection.status === "CONNECTED" ? "Reconnect TikTok" : "Connect TikTok"}
            </a>
            {connection.status !== "DISCONNECTED" && (
              <form action={disconnectTikTokAction}>
                <button type="submit" className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Disconnect
                </button>
              </form>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Only a workspace owner can connect or disconnect TikTok.</p>
        )}
      </section>

      <section id="diagnostics" className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Diagnostics</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${writes ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}
          >
            {writes ? "Changes to TikTok: on" : "Changes to TikTok: off"}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Read-only checks that call each TikTok tool this panel reads from and show what came back. They make no changes on TikTok. Run them on
          this deployment before setting <code>TIKTOK_WRITES_ENABLED=true</code>; until then every create, edit, pause and resume is refused by the
          server.
        </p>
        {connection.status === "CONNECTED" ? (
          <DiagnosticsPanel accounts={accounts} />
        ) : (
          <p className="mt-3 text-sm text-slate-500">Connect TikTok to run the checks.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Members of {ctx.workspaceName}</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium text-slate-800">{m.user.name}</span>{" "}
                <span className="text-slate-500">{m.user.email}</span>
              </span>
              <span className="text-xs text-slate-500">{m.role === "OWNER" ? "Owner" : "Member"}</span>
            </li>
          ))}
        </ul>
        {owner && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-slate-500">Add someone who already has an account. They will share this TikTok connection.</p>
            <AddMemberForm />
          </div>
        )}
      </section>
    </div>
  );
}
