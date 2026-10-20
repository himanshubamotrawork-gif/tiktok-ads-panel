import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { TikTokError } from "./tiktok.errors";
import { boundedFetch, OAUTH_LIMITS, timed, type OAuthLimits } from "./tiktok.http";

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth storage for the MCP SDK, backed by PostgreSQL so it works across serverless
 * invocations. The app registers itself as its own MCP client (dynamic client
 * registration); nothing is shared with any other client's authorization.
 */
export class DbOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK asks for the user to be sent to TikTok. */
  authorizationUrl: URL | null = null;
  private stateValue: string | null;

  constructor(
    private readonly opts: {
      workspaceId: string;
      userId?: string;
      /** True only inside the "Connect TikTok" route, where a browser redirect is possible. */
      interactive: boolean;
      state?: string;
      /** Start a fresh authorization even if tokens exist; the old ones stay until replaced. */
      ignoreTokens?: boolean;
    },
  ) {
    this.stateValue = opts.state ?? null;
  }

  get redirectUrl(): string {
    return env.tiktokRedirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "TikTok Ads Panel",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    this.stateValue ??= randomBytes(24).toString("base64url");
    return this.stateValue;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const row = await prisma.tikTokClientRegistration.findUnique({ where: { redirectUri: this.redirectUrl } });
    return row ? decryptJson<OAuthClientInformationMixed>(row.clientInfoEnc) : undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const clientInfoEnc = encryptJson(info);
    await prisma.tikTokClientRegistration.upsert({
      where: { redirectUri: this.redirectUrl },
      create: { redirectUri: this.redirectUrl, clientInfoEnc },
      update: { clientInfoEnc },
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (this.opts.ignoreTokens) return undefined;
    const row = await prisma.tikTokConnection.findUnique({ where: { workspaceId: this.opts.workspaceId } });
    if (!row?.tokensEnc || row.redirectUri !== this.redirectUrl) return undefined;
    return decryptJson<OAuthTokens>(row.tokensEnc);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const data = {
      tokensEnc: encryptJson(tokens),
      redirectUri: this.redirectUrl,
      status: "CONNECTED" as const,
      lastError: null,
      ...(this.opts.userId ? { connectedByUserId: this.opts.userId } : {}),
    };
    await prisma.tikTokConnection.upsert({
      where: { workspaceId: this.opts.workspaceId },
      create: { workspaceId: this.opts.workspaceId, ...data },
      update: data,
    });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.opts.interactive) {
      this.authorizationUrl = authorizationUrl;
      return;
    }
    // A background refresh failed and TikTok wants the user to sign in again.
    await markReauthRequired(this.opts.workspaceId, "TikTok requires the user to sign in again.");
    throw new TikTokError("AUTH_REQUIRED", "TikTok authorization is missing or has expired.");
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!this.opts.userId) throw new Error("A user is required to start TikTok sign-in");
    const state = this.state();
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    await prisma.oAuthState.upsert({
      where: { state },
      create: {
        state,
        workspaceId: this.opts.workspaceId,
        userId: this.opts.userId,
        codeVerifier,
        redirectUri: this.redirectUrl,
        expiresAt,
      },
      update: { codeVerifier, expiresAt },
    });
  }

  async codeVerifier(): Promise<string> {
    const row = this.stateValue ? await prisma.oAuthState.findUnique({ where: { state: this.stateValue } }) : null;
    if (!row?.codeVerifier) throw new Error("No sign-in is in progress for this state");
    return row.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "tokens") {
      await prisma.tikTokConnection.updateMany({
        where: { workspaceId: this.opts.workspaceId },
        data: { tokensEnc: null, status: "REAUTH_REQUIRED" },
      });
    }
    if (scope === "all" || scope === "client") {
      await prisma.tikTokClientRegistration.deleteMany({ where: { redirectUri: this.redirectUrl } });
    }
  }
}

export async function markReauthRequired(workspaceId: string, reason: string): Promise<void> {
  await prisma.tikTokConnection.updateMany({
    where: { workspaceId },
    data: { status: "REAUTH_REQUIRED", lastError: reason },
  });
}

/** Step 1 of "Connect TikTok": returns the TikTok page the browser must be sent to. */
export async function startAuthorization(
  workspaceId: string,
  userId: string,
  limits: OAuthLimits = OAUTH_LIMITS,
): Promise<URL> {
  await timed("start: clear expired states", () =>
    prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  );
  const provider = new DbOAuthProvider({ workspaceId, userId, interactive: true, ignoreTokens: true });
  const result = await timed("start: discovery, registration, authorization URL", () =>
    auth(provider, { serverUrl: env.tiktokMcpUrl, fetchFn: boundedFetch(limits) }),
  );
  if (result !== "REDIRECT" || !provider.authorizationUrl) {
    throw new Error("TikTok did not return an authorization page");
  }
  return provider.authorizationUrl;
}

/** Step 2: the callback. Exchanges the code for tokens and stores them encrypted. */
export async function completeAuthorization(
  state: string,
  code: string,
  limits: OAuthLimits = OAUTH_LIMITS,
): Promise<{ workspaceId: string }> {
  const row = await timed("callback: load state", () => prisma.oAuthState.findUnique({ where: { state } }));
  if (!row || row.expiresAt < new Date()) {
    throw new Error("This TikTok sign-in link has expired. Start the connection again.");
  }
  const provider = new DbOAuthProvider({
    workspaceId: row.workspaceId,
    userId: row.userId,
    interactive: true,
    state,
    ignoreTokens: true,
  });
  try {
    const result = await timed("callback: discovery and token exchange", () =>
      auth(provider, { serverUrl: env.tiktokMcpUrl, authorizationCode: code, fetchFn: boundedFetch(limits) }),
    );
    if (result !== "AUTHORIZED") throw new Error("TikTok did not complete the authorization");
  } finally {
    await prisma.oAuthState.deleteMany({ where: { state } });
  }
  return { workspaceId: row.workspaceId };
}

export async function disconnect(workspaceId: string): Promise<void> {
  await prisma.tikTokConnection.updateMany({
    where: { workspaceId },
    data: { tokensEnc: null, status: "DISCONNECTED", lastError: null },
  });
}
