import { NextResponse, type NextRequest } from "next/server";
import { completeAuthorization } from "@/integrations/tiktok/tiktok.oauth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TikTok redirects here after the user approves. The code is exchanged server-side and
// the tokens are stored encrypted; nothing is passed on to the browser.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const settings = (key: "error" | "connected", value: string) =>
    NextResponse.redirect(`${env.appUrl}/settings?${key}=${encodeURIComponent(value)}`);

  const denied = params.get("error");
  if (denied) return settings("error", `TikTok did not authorize the connection: ${params.get("error_description") ?? denied}`);

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return settings("error", "TikTok returned an incomplete response. Start the connection again.");

  try {
    await completeAuthorization(state, code);
    return settings("connected", "1");
  } catch (err) {
    console.error("[tiktok oauth callback]", err);
    return settings("error", err instanceof Error ? err.message : "TikTok sign-in could not be completed.");
  }
}
