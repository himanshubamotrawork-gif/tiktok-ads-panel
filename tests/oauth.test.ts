import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the three tables the sign-in uses.
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const table = (key: string) => {
    const rows = new Map<string, Row>();
    return {
      rows,
      findUnique: async ({ where }: { where: Row }) => rows.get(where[key] as string) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const id = where[key] as string;
        const row = rows.has(id) ? { ...rows.get(id), ...update } : { ...create };
        rows.set(id, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows.get(where[key] as string);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      deleteMany: async ({ where }: { where: Row }) => {
        for (const [id, row] of rows) {
          const expired = (where.expiresAt as { lt?: Date } | undefined)?.lt;
          if (expired ? (row.expiresAt as Date) < expired : row[key] === where[key]) rows.delete(id);
        }
        return { count: 0 };
      },
    };
  };
  return {
    oAuthState: table("state"),
    tikTokClientRegistration: table("redirectUri"),
    tikTokConnection: table("workspaceId"),
  };
});
vi.mock("@/lib/db", () => ({ prisma: db }));

import { boundedFetch } from "@/integrations/tiktok/tiktok.http";
import { completeAuthorization, startAuthorization } from "@/integrations/tiktok/tiktok.oauth";
import { TikTokError } from "@/integrations/tiktok/tiktok.errors";

// A fake MCP server and authorization server. These hosts and paths are test fixtures,
// not TikTok's endpoints.
const MCP_URL = "https://mcp.example.test/open_mcp/tt-ads-mcp-flat";
const AUTH = "https://auth.example.test";
const APP_URL = "https://panel.example.test";
const LIMITS = { requestMs: 100, flowMs: 1_000 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let tokenRequests: URLSearchParams[] = [];

function fakeTikTok(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const route = `${init?.method ?? "GET"} ${url.origin}${url.pathname}`;
  switch (route) {
    case "GET https://mcp.example.test/.well-known/oauth-protected-resource/open_mcp/tt-ads-mcp-flat":
      return Promise.resolve(json({ resource: MCP_URL, authorization_servers: [AUTH], scopes_supported: ["mcp:test"] }));
    case `GET ${AUTH}/.well-known/oauth-authorization-server`:
      return Promise.resolve(
        json({
          issuer: AUTH,
          authorization_endpoint: `${AUTH}/authorize`,
          token_endpoint: `${AUTH}/token`,
          registration_endpoint: `${AUTH}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
    case `POST ${AUTH}/register`: {
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(json({ client_id: "client-1", redirect_uris: body.redirect_uris }, 201));
    }
    case `POST ${AUTH}/token`:
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Promise.resolve(json({ access_token: "access-SECRET", token_type: "Bearer", refresh_token: "refresh-SECRET" }));
    default:
      return Promise.resolve(json({ error: "not_found" }, 404));
  }
}

/** Accepts the request and never answers, like an endpoint that drops the response. */
function hanging(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
}

let logs: string[] = [];

beforeAll(() => {
  process.env.APP_URL = APP_URL;
  process.env.TIKTOK_MCP_URL = MCP_URL;
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

beforeEach(() => {
  logs = [];
  tokenRequests = [];
  for (const t of Object.values(db)) t.rows.clear();
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("boundedFetch", () => {
  it("gives up on a request that never answers", async () => {
    vi.stubGlobal("fetch", hanging);
    const started = Date.now();
    const err = await boundedFetch(LIMITS)(`${MCP_URL}?x=1`).catch((e) => e);
    expect(err).toBeInstanceOf(TikTokError);
    expect(err.kind).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("stops the whole flow at the flow limit even when each request is within its own limit", async () => {
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(json({})), 80);
        init?.signal?.addEventListener("abort", () => (clearTimeout(timer), reject(init.signal!.reason)));
      }),
    );
    const fetchFn = boundedFetch({ requestMs: 100, flowMs: 200 });
    await fetchFn(MCP_URL);
    await fetchFn(MCP_URL);
    await expect(fetchFn(MCP_URL)).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("reports a network failure instead of a TypeError the SDK would swallow", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })));
    const err = await boundedFetch(LIMITS)(MCP_URL).catch((e) => e);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err).toMatchObject({ kind: "NETWORK" });
    expect(err.message).toContain("ECONNRESET");
  });

  it("logs host and path but never the query string", async () => {
    vi.stubGlobal("fetch", fakeTikTok);
    await boundedFetch(LIMITS)(`${AUTH}/authorize?code=CODE-SECRET&state=STATE-SECRET`);
    expect(logs.join("\n")).toContain("GET auth.example.test/authorize -> 404");
    expect(logs.join("\n")).not.toContain("SECRET");
  });
});

// Real Node fetch against a local server, to check that aborts reach the socket.
describe("boundedFetch with a real connection", () => {
  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const closed: string[] = [];
    const server = createServer((req, res) => {
      req.socket.on("close", () => closed.push(req.url!));
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const stop = () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    };
    return { base, closed, stop };
  }

  it("times out while reading a body that never finishes", async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"partial":');
    });
    try {
      const started = Date.now();
      const response = await boundedFetch(LIMITS)(`${server.base}/meta`);
      expect(response.status).toBe(200);
      await expect(response.json()).rejects.toMatchObject({ name: "TimeoutError" });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await server.stop();
    }
  });

  it("aborts the outstanding request when the flow limit is reached", async () => {
    const server = await serve(() => undefined); // never answers
    try {
      const fetchFn = boundedFetch({ requestMs: 5_000, flowMs: 150 });
      const started = Date.now();
      await expect(fetchFn(`${server.base}/slow`)).rejects.toMatchObject({ kind: "TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(1_000);
      await vi.waitFor(() => expect(server.closed).toContain("/slow"));
      // Anything sent after the flow limit fails at once.
      const again = Date.now();
      await expect(fetchFn(`${server.base}/later`)).rejects.toMatchObject({ kind: "TIMEOUT" });
      expect(Date.now() - again).toBeLessThan(100);
    } finally {
      await server.stop();
    }
  });
});

describe("TikTok sign-in", () => {
  it("returns an error instead of hanging when discovery never answers", async () => {
    vi.stubGlobal("fetch", hanging);
    const started = Date.now();
    await expect(startAuthorization("ws1", "u1", LIMITS)).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(logs.join("\n")).toContain("start: discovery, registration, authorization URL failed");
  });

  it("uses the APP_URL callback, state and PKCE consistently from start to callback", async () => {
    vi.stubGlobal("fetch", fakeTikTok);

    const url = await startAuthorization("ws1", "u1", LIMITS);
    const params = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH}/authorize`);
    expect(params.get("redirect_uri")).toBe(`${APP_URL}/api/tiktok/oauth/callback`);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("resource")).toBe(MCP_URL);
    const state = params.get("state")!;
    expect(db.oAuthState.rows.get(state)).toMatchObject({ workspaceId: "ws1", userId: "u1" });

    await completeAuthorization(state, "CODE-SECRET", LIMITS);

    const token = tokenRequests[0]!;
    expect(token.get("code")).toBe("CODE-SECRET");
    expect(token.get("redirect_uri")).toBe(`${APP_URL}/api/tiktok/oauth/callback`);
    const challenge = createHash("sha256").update(token.get("code_verifier")!).digest("base64url");
    expect(challenge).toBe(params.get("code_challenge"));
    expect(db.oAuthState.rows.has(state)).toBe(false);
    expect(db.tikTokConnection.rows.get("ws1")).toMatchObject({ status: "CONNECTED" });
    expect(String(db.tikTokConnection.rows.get("ws1")!.tokensEnc)).not.toContain("SECRET");
    expect(logs.join("\n")).not.toContain("SECRET");
    expect(logs.join("\n")).not.toContain(token.get("code_verifier")!);
  });

  it("rejects a callback whose state is unknown", async () => {
    vi.stubGlobal("fetch", fakeTikTok);
    await expect(completeAuthorization("forged", "CODE-SECRET", LIMITS)).rejects.toThrow(/expired/);
    expect(tokenRequests).toHaveLength(0);
  });
});
