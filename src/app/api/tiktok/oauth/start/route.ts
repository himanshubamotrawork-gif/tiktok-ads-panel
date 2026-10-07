import { NextResponse } from "next/server";
import { startAuthorization } from "@/integrations/tiktok/tiktok.oauth";
import { env } from "@/lib/env";
import { getContext } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts "Connect TikTok": registers this app as an MCP client if needed and sends the
// browser to TikTok's authorization page.
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(`${env.appUrl}/login`);
  if (ctx.role !== "OWNER") {
    return NextResponse.redirect(`${env.appUrl}/settings?error=${encodeURIComponent("Only a workspace owner can connect TikTok.")}`);
  }
  try {
    const url = await startAuthorization(ctx.workspaceId, ctx.userId);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[tiktok oauth start]", err);
    const reason = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${env.appUrl}/settings?error=${encodeURIComponent(`Could not start TikTok sign-in: ${reason}`)}`,
    );
  }
}
