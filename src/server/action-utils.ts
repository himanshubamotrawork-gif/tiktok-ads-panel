import { describeFailure, TikTokError } from "@/integrations/tiktok/tiktok.errors";
import type { ActionResult } from "./dto";

/** Runs a server action body and turns any failure into a sentence the user can act on. */
export async function run<T>(label: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // Validation errors raised before anything is sent already read as full sentences.
    if (err instanceof TikTokError && !err.details.tool && !err.details.code && err.kind.startsWith("INVALID")) {
      return { ok: false, error: err.message };
    }
    if (err instanceof TikTokError) return { ok: false, error: describeFailure(label, err) };
    console.error(`[action] ${label}`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export const writesEnabled = () => process.env.TIKTOK_WRITES_ENABLED === "true";

/**
 * Every action that changes something on TikTok calls this first. Writes stay off until
 * the live read-only capability checks have been done on the deployment.
 */
export function assertWritesEnabled(): void {
  if (!writesEnabled()) {
    throw new Error(
      "Changes to TikTok are switched off on this deployment. Run the checks in Settings → Diagnostics, then set TIKTOK_WRITES_ENABLED=true to allow them.",
    );
  }
}
