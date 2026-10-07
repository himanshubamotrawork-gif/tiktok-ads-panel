import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { TikTokError, technicalDetails, toTikTokError } from "./tiktok.errors";
import { parseToolResult } from "./tiktok.mappers";
import { DbOAuthProvider, markReauthRequired } from "./tiktok.oauth";
import type { Raw, TikTokGateway } from "./tiktok.types";

const TOOL_TIMEOUT_MS = 45_000;

/**
 * Opens a short-lived MCP session for one request and closes it afterwards. Nothing is
 * kept in process memory between requests, which is what a serverless function needs.
 */
export async function withTikTok<T>(workspaceId: string, fn: (gateway: TikTokGateway) => Promise<T>): Promise<T> {
  const connection = await prisma.tikTokConnection.findUnique({ where: { workspaceId } });
  if (!connection?.tokensEnc) {
    throw new TikTokError(
      connection?.status === "REAUTH_REQUIRED" ? "AUTH_REQUIRED" : "NOT_CONNECTED",
      "This workspace is not connected to TikTok.",
    );
  }

  const provider = new DbOAuthProvider({ workspaceId, interactive: false });
  const transport = new StreamableHTTPClientTransport(new URL(env.tiktokMcpUrl), { authProvider: provider });
  const client = new Client({ name: "tiktok-ads-panel", version: "0.1.0" });

  const gateway: TikTokGateway = {
    async callTool<R = Raw>(name: string, args: Record<string, unknown>): Promise<R> {
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TOOL_TIMEOUT_MS });
        return parseToolResult<R>(name, result as Parameters<typeof parseToolResult>[1]);
      } catch (err) {
        const error = toTikTokError(err, name);
        console.error("[tiktok]", technicalDetails(error));
        if (error.kind === "AUTH_REQUIRED") await markReauthRequired(workspaceId, error.message);
        throw error;
      }
    },
  };

  try {
    await client.connect(transport);
  } catch (err) {
    const error = toTikTokError(err, "connect");
    console.error("[tiktok]", technicalDetails(error));
    if (error.kind === "AUTH_REQUIRED") await markReauthRequired(workspaceId, error.message);
    throw error;
  }

  try {
    return await fn(gateway);
  } finally {
    await client.close().catch(() => undefined);
  }
}
