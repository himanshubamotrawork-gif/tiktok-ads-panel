import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { OperationContext } from "./operations/runner";

export interface AppContext extends OperationContext {
  userEmail: string;
  workspaceName: string;
  role: "OWNER" | "MEMBER";
}

/** Resolves the signed-in user and their active workspace, or returns null. */
export async function getContext(): Promise<AppContext | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: session.userId, workspaceId: session.workspaceId } },
    include: { user: true, workspace: true },
  });
  if (!membership) return null;
  return {
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    userName: membership.user.name,
    userEmail: membership.user.email,
    workspaceName: membership.workspace.name,
    role: membership.role,
  };
}

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Ad account row for an external advertiser ID, only if it belongs to the workspace. */
export async function requireAdAccount(workspaceId: string, advertiserId: string) {
  const account = await prisma.adAccount.findUnique({
    where: { workspaceId_externalAdvertiserId: { workspaceId, externalAdvertiserId: advertiserId } },
  });
  if (!account) throw new Error("This ad account is not available in your workspace. Refresh the ad account list.");
  return account;
}
