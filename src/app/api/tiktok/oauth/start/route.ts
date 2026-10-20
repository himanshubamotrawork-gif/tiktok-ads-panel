import { NextResponse, type NextRequest } from "next/server";
import { timed } from "@/integrations/tiktok/tiktok.http";
import { startAuthorization } from "@/integrations/tiktok/tiktok.oauth";
import { env } from "@/lib/env";
import { getContext } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts "Connect TikTok": registers this app as an MCP client if needed and sends the
// browser to TikTok's authorization page.
export async function GET(request: NextRequest) {
  // TikTok returns to a callback built from APP_URL, not from this request's origin.
  const origin = request.nextUrl.origin;
  if (origin !== env.appUrl) {
    console.warn(
      `[tiktok oauth] APP_URL (${env.appUrl}) differs from the requested origin (${origin}); TikTok will return to ${env.tiktokRedirectUri}`,
    );
  }
  const ctx = await timed("start: load session", () => getContext());
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
