import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TikTokError } from "./tiktok.errors";

export interface OAuthLimits {
  /** Longest a single request to TikTok may take, including reading its body. */
  requestMs: number;
  /** Longest the whole sign-in step (discovery, registration, token exchange) may take. */
  flowMs: number;
}

// The MCP SDK sends its OAuth requests without any timeout, so a TikTok endpoint that
// accepts the connection but never answers would hold the request open until the
// platform kills the function. These bounds keep the sign-in routes answering.
export const OAUTH_LIMITS: OAuthLimits = { requestMs: 10_000, flowMs: 25_000 };

/** Method, host and path only. Query strings and bodies can carry state, codes or tokens. */
export function describeRequest(input: string | URL | Request, init?: RequestInit): string {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return `${method} ${url.host}${url.pathname}`;
}

function log(message: string) {
  console.info(`[tiktok oauth] ${message}`);
}

/** Runs one step of the sign-in and logs how long it took. Never logs values. */
export async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    log(`${step} ok ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    const name = err instanceof Error ? err.name : typeof err;
    log(`${step} failed ${Date.now() - started}ms (${name})`);
    throw err;
  }
}

/**
 * A fetch for the MCP SDK's OAuth helpers that gives up after `limits.requestMs` per request
 * and `limits.flowMs` in total, and logs each request without its query string or body.
 * The signal also covers reading the response body, which the SDK does after this returns.
 */
export function boundedFetch(limits: OAuthLimits = OAUTH_LIMITS): FetchLike {
  const flow = AbortSignal.timeout(limits.flowMs);
  return async (input, init) => {
    const where = describeRequest(input, init);
    const signals = [flow, AbortSignal.timeout(limits.requestMs)];
    if (init?.signal) signals.push(init.signal);
    const started = Date.now();
    try {
      const response = await fetch(input, { ...init, signal: AbortSignal.any(signals) });
      log(`${where} -> ${response.status} ${Date.now() - started}ms`);
      return response;
    } catch (err) {
      const ms = Date.now() - started;
      if (signals.some((s) => s.aborted && (s.reason as Error | undefined)?.name === "TimeoutError")) {
        log(`${where} -> timed out ${ms}ms`);
        throw new TikTokError("TIMEOUT", `TikTok did not respond in time (${where}, ${ms}ms).`, { cause: where });
      }
      const e = err as { message?: string; cause?: { code?: string } };
      const reason = e?.cause?.code ?? e?.message ?? "unknown error";
      log(`${where} -> failed ${ms}ms (${reason})`);
      // Rethrown as a TikTokError rather than a TypeError: the SDK treats a TypeError as a
      // browser CORS failure and silently moves on, which hides why discovery failed.
      throw new TikTokError("NETWORK", `Could not reach TikTok (${where}): ${reason}.`, { cause: reason });
    }
  };
}
