"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { refreshAdAccountsAction, refreshBusinessCentersAction } from "@/server/actions/tiktok";
import type { AdAccountRow, BusinessCenterRow } from "@/server/dto";
import { Button, ErrorBanner } from "../ui/primitives";

const ALL = "__all__";

/**
 * Business Center and ad account selectors. The selection lives in the URL, so every
 * campaign page operates on exactly the account shown here.
 */
export function AccountBar({
  businessCenters,
  accounts,
  selectedBc,
  selectedAccount,
  connected,
  children,
}: {
  businessCenters: BusinessCenterRow[];
  accounts: AdAccountRow[];
  selectedBc: string | null;
  selectedAccount: string | null;
  connected: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoLoaded = useRef(false);

  const go = useCallback(
    (bc: string | null, account: string | null) => {
      const params = new URLSearchParams();
      if (bc) params.set("bc", bc);
      if (account) params.set("account", account);
      router.push(`/campaigns${params.size ? `?${params}` : ""}`);
    },
    [router],
  );

  const refresh = useCallback(
    async (bc: string | null) => {
      setBusy(true);
      setError(null);
      const centers = await refreshBusinessCentersAction();
      const accountsResult = centers.ok ? await refreshAdAccountsAction(bc) : null;
      setBusy(false);
      if (!centers.ok) setError(centers.error);
      else if (accountsResult && !accountsResult.ok) setError(accountsResult.error);
      router.refresh();
    },
    [router],
  );

  // First visit after connecting: nothing is cached yet, so load from TikTok once.
  useEffect(() => {
    if (connected && !autoLoaded.current && businessCenters.length === 0 && accounts.length === 0) {
      autoLoaded.current = true;
      void refresh(null);
    }
  }, [connected, businessCenters.length, accounts.length, refresh]);

  async function selectBc(value: string) {
    const bc = value === ALL ? null : value;
    setBusy(true);
    setError(null);
    const result = await refreshAdAccountsAction(bc);
    setBusy(false);
    if (!result.ok) setError(result.error);
    go(bc, null);
  }

  const bc = businessCenters.find((b) => b.id === selectedBc);
  const account = accounts.find((a) => a.id === selectedAccount);

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="block w-64">
          <span className="label">Business Center</span>
          <select className="input" value={selectedBc ?? ALL} disabled={!connected || busy} onChange={(e) => selectBc(e.target.value)}>
            <option value={ALL}>All accessible ad accounts</option>
            {businessCenters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block w-72">
          <span className="label">Ad Account</span>
          <select
            className="input"
            value={selectedAccount ?? ""}
            disabled={!connected || busy || accounts.length === 0}
            onChange={(e) => go(selectedBc, e.target.value || null)}
          >
            <option value="">{accounts.length ? "Select Ad Account" : "No ad accounts loaded"}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => refresh(selectedBc)} loading={busy} disabled={!connected}>
          Refresh accounts
        </Button>
        <div className="ml-auto flex items-end gap-2">{children}</div>
      </div>

      {!connected && (
        <ErrorBanner
          action={
            <Link href="/settings" className="whitespace-nowrap font-medium underline">
              Open Settings
            </Link>
          }
        >
          This workspace is not connected to TikTok, so nothing can be loaded or changed.
        </ErrorBanner>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {(bc || account) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-slate-600">
          {bc && (
            <span>
              Business Center: <span className="font-medium text-slate-900">{bc.name}</span> <span className="text-slate-400">({bc.id})</span>
              {bc.userRole && ` · Your role: ${bc.userRole}`}
              {bc.status && ` · ${bc.status}`}
            </span>
          )}
          {account && (
            <span>
              Ad Account: <span className="font-medium text-slate-900">{account.name}</span> <span className="text-slate-400">({account.id})</span>
              {` · Currency: ${account.currency ?? "Not available"} · Time zone: ${account.timezone ?? "Not available"} · Status: ${account.status ?? "Not available"}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
