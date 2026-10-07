"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { disconnect } from "@/integrations/tiktok/tiktok.oauth";
import { prisma } from "@/lib/db";
import { clearSession, setSession } from "@/lib/session";
import { requireContext } from "../context";

export interface FormState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const registration = credentials.extend({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  workspace: z.string().trim().min(1, "Enter a workspace name.").max(80),
});

const firstError = (error: z.ZodError) => error.issues[0]?.message ?? "Check the form and try again.";

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = registration.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { email, password, name, workspace } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "An account with this email already exists." };
  }
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      memberships: { create: { role: "OWNER", workspace: { create: { name: workspace } } } },
    },
    include: { memberships: true },
  });
  await setSession({ userId: user.id, workspaceId: user.memberships[0]!.workspaceId });
  redirect("/campaigns");
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { memberships: { orderBy: { createdAt: "asc" } } },
  });
  const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  const membership = user?.memberships[0];
  if (!user || !valid || !membership) return { error: "Incorrect email or password." };
  await setSession({ userId: user.id, workspaceId: membership.workspaceId });
  redirect("/campaigns");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function switchWorkspaceAction(form: FormData) {
  const ctx = await requireContext();
  const workspaceId = String(form.get("workspaceId") ?? "");
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: ctx.userId, workspaceId } },
  });
  if (membership) await setSession({ userId: ctx.userId, workspaceId });
  redirect("/campaigns");
}

/** Adds an existing user to the current workspace so they share its TikTok connection. */
export async function addMemberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireContext();
  if (ctx.role !== "OWNER") return { error: "Only a workspace owner can add members." };
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (!user) return { error: "No account uses this email yet. Ask them to register first." };
  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: ctx.workspaceId } },
    create: { userId: user.id, workspaceId: ctx.workspaceId, role: "MEMBER" },
    update: {},
  });
  return { message: `${user.name} can now use this workspace.` };
}

export async function disconnectTikTokAction() {
  const ctx = await requireContext();
  if (ctx.role === "OWNER") await disconnect(ctx.workspaceId);
  redirect("/settings");
}
