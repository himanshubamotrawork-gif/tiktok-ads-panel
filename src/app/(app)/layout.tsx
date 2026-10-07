import Link from "next/link";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { prisma } from "@/lib/db";
import { logoutAction, switchWorkspaceAction } from "@/server/actions/auth";
import { requireContext } from "@/server/context";

export const dynamic = "force-dynamic";
// Server actions on these pages call TikTok; bulk actions make several calls in a row.
export const maxDuration = 60;

const NAV = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-6 px-4">
            <Link href="/campaigns" className="text-sm font-semibold text-slate-900">
              TikTok Ads Panel
            </Link>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
              {memberships.length > 1 ? (
                <form action={switchWorkspaceAction} className="flex items-center gap-1">
                  <select name="workspaceId" defaultValue={ctx.workspaceId} className="input h-8 w-44" aria-label="Workspace">
                    {memberships.map((m) => (
                      <option key={m.workspaceId} value={m.workspaceId}>
                        {m.workspace.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                    Switch
                  </button>
                </form>
              ) : (
                <span className="text-slate-500">{ctx.workspaceName}</span>
              )}
              <span className="text-slate-300">|</span>
              <span>{ctx.userName}</span>
              <form action={logoutAction}>
                <button type="submit" className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">{children}</main>
      </div>
    </ToastProvider>
  );
}
