"use client";

import { useState } from "react";
import type { SparkPost } from "@/integrations/tiktok/tiktok.options";
import { redeemSparkCodeAction } from "@/server/actions/campaign-builder";
import { Button } from "../ui/primitives";

/**
 * Turns a Spark code into the TikTok post it authorizes. The code can come from typing
 * today, and from a Spark Code Bank picker later: a picker only needs to call
 * `applyCode` with the chosen code, so nothing else in the wizard changes.
 */
export function SparkCodeField({
  advertiserId,
  post,
  onResolved,
  onClear,
}: {
  advertiserId: string;
  post: SparkPost | null;
  onResolved: (post: SparkPost, code: string) => void;
  onClear: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyCode(value: string) {
    setBusy(true);
    setError(null);
    const result = await redeemSparkCodeAction(advertiserId, value);
    setBusy(false);
    if (result.ok) onResolved(result.data, value);
    else setError(result.error);
  }

  if (post) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <p className="font-medium text-emerald-900">Spark code accepted</p>
        <p className="mt-1 text-emerald-900">
          {post.displayName ? `Post by ${post.displayName}` : "TikTok post"} · ID {post.tiktokItemId}
        </p>
        {post.caption && <p className="mt-1 truncate text-xs text-emerald-800">{post.caption}</p>}
        <button type="button" className="mt-2 text-xs font-medium text-emerald-900 underline" onClick={onClear}>
          Use a different code
        </button>
      </div>
    );
  }

  return (
    <div>
      <span className="label">Spark code</span>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Paste the code the creator generated in TikTok"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button onClick={() => applyCode(code)} loading={busy} disabled={!code.trim()}>
          Use code
        </Button>
        <Button disabled title="Coming in a later phase">
          Spark Code Bank
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-xs text-slate-500">
        Using a code registers the creator&apos;s authorization on this ad account. It does not create an ad or spend anything.
      </p>
    </div>
  );
}
