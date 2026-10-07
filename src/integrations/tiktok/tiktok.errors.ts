export type TikTokErrorKind =
  | "NOT_CONNECTED"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "INVALID_REQUEST"
  | "INVALID_BUDGET"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "TIKTOK_REJECTED"
  | "VERIFICATION_MISMATCH"
  | "UNKNOWN";

export interface TikTokErrorDetails {
  tool?: string;
  code?: number | string;
  requestId?: string;
  tiktokMessage?: string;
  cause?: string;
}

export class TikTokError extends Error {
  constructor(
    public readonly kind: TikTokErrorKind,
    message: string,
    public readonly details: TikTokErrorDetails = {},
  ) {
    super(message);
    this.name = "TikTokError";
  }
}

// TikTok response-envelope codes we can classify with confidence. Anything else is
// reported as a TikTok rejection together with the message TikTok returned.
const CODE_KINDS: Record<number, TikTokErrorKind> = {
  40001: "INVALID_REQUEST",
  40002: "PERMISSION_DENIED",
  40100: "RATE_LIMITED",
  40104: "AUTH_REQUIRED",
  40105: "AUTH_REQUIRED",
};

export function errorFromEnvelope(
  tool: string,
  code: number,
  message: string,
  requestId?: string,
): TikTokError {
  let kind = CODE_KINDS[code] ?? "TIKTOK_REJECTED";
  if (kind === "INVALID_REQUEST" && /budget/i.test(message)) kind = "INVALID_BUDGET";
  return new TikTokError(kind, message || `TikTok returned code ${code}`, {
    tool,
    code,
    requestId,
    tiktokMessage: message,
  });
}

const NETWORK_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
];

/** Converts anything thrown while talking to the MCP into a TikTokError. */
export function toTikTokError(err: unknown, tool?: string): TikTokError {
  if (err instanceof TikTokError) return err;
  const e = err as { name?: string; message?: string; code?: unknown; cause?: { code?: unknown } };
  const message = e?.message ?? String(err);
  const code = e?.code ?? e?.cause?.code;
  if (e?.name === "UnauthorizedError" || /unauthorized|invalid_token|invalid_grant/i.test(message)) {
    return new TikTokError("AUTH_REQUIRED", "TikTok authorization is missing or has expired.", {
      tool,
      cause: message,
    });
  }
  if (code === -32001 || e?.name === "AbortError" || /timed? ?out/i.test(message)) {
    return new TikTokError("TIMEOUT", "TikTok did not respond in time.", { tool, cause: message });
  }
  if (typeof code === "string" && NETWORK_CODES.includes(code)) {
    return new TikTokError("NETWORK", "Could not reach TikTok.", { tool, cause: `${code}: ${message}` });
  }
  if (/fetch failed|network|not connected|ECONNREFUSED/i.test(message)) {
    return new TikTokError("NETWORK", "Could not reach TikTok.", { tool, cause: message });
  }
  return new TikTokError("UNKNOWN", message, { tool, cause: message });
}

function suffix(e: TikTokError): string {
  return e.details.tiktokMessage ? `: ${e.details.tiktokMessage}` : "";
}

const REASONS: Record<TikTokErrorKind, (e: TikTokError) => string> = {
  NOT_CONNECTED: () => "this workspace is not connected to TikTok. Connect TikTok in Settings",
  AUTH_REQUIRED: () => "the TikTok authorization has expired. Reconnect TikTok in Settings",
  PERMISSION_DENIED: (e) => `the connected TikTok user does not have permission for this${suffix(e)}`,
  INVALID_REQUEST: (e) => `TikTok rejected the configuration${suffix(e)}`,
  INVALID_BUDGET: (e) => `TikTok rejected the budget${suffix(e)}`,
  RATE_LIMITED: () => "TikTok is rate limiting requests. Wait a moment and try again",
  TIMEOUT: () =>
    "TikTok did not respond in time. The change may or may not have been applied; refresh to check",
  NETWORK: () => "TikTok could not be reached",
  TIKTOK_REJECTED: (e) => `TikTok rejected the request${suffix(e)}`,
  VERIFICATION_MISMATCH: (e) => e.message,
  UNKNOWN: (e) => `of an unexpected error${e.message ? `: ${e.message}` : ""}`,
};

/** User-facing sentence, e.g. "Campaign pause failed because TikTok could not be reached." */
export function describeFailure(action: string, err: unknown): string {
  const e = toTikTokError(err);
  if (e.kind === "VERIFICATION_MISMATCH") return e.message;
  return `${action} failed because ${REASONS[e.kind](e)}.`;
}

/** Compact technical record for server logs and the operation row. Never includes tokens. */
export function technicalDetails(err: unknown): string {
  const e = toTikTokError(err);
  return JSON.stringify({ kind: e.kind, message: e.message, ...e.details });
}
