"use client";

import { useState } from "react";
import { runDiagnosticsAction, type DiagnosticsReport } from "@/server/actions/diagnostics";
import type { AdAccountRow } from "@/server/dto";
import { Button, ErrorBanner } from "./ui/primitives";

/**
 * Runs the read-only capability checks against one ad account and shows the shape of what
 * TikTok returned, so field names taken from convention can be confirmed. Makes no changes.
 */
export function DiagnosticsPanel({ accounts }: { accounts: AdAccountRow[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);

  async function runChecks() {
    setRunning(true);
    setError(null);
    const result = await runDiagnosticsAction(accountId);
    setRunning(false);
    if (result.ok) setReport(result.data);
    else {
      setReport(null);
      setError(result.error);
    }
  }

  if (accounts.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">Load an ad account on the Campaigns page first; the checks run against one ad account.</p>;
  }

  const failed = report?.rows.filter((r) => !r.ok).length ?? 0;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-2">
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Ad account">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.id})
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={runChecks} loading={running} disabled={!accountId}>
          Run checks
        </Button>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {report && (
        <>
          <p className="text-sm text-slate-700">
            {report.rows.length - failed} of {report.rows.length} checks returned data for ad account {report.advertiserId}.
            {failed > 0 && ` ${failed} failed.`}
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="th">Check</th>
                  <th className="th">Result</th>
                  <th className="th">What TikTok returned</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr key={`${row.tool}-${index}`}>
                    <td className="td align-top">
                      <span className="font-medium text-slate-900">{row.purpose}</span>
                      <span className="block text-xs text-slate-400">{row.tool}</span>
                    </td>
                    <td className={`td align-top ${row.ok ? "text-emerald-700" : "text-red-700"}`}>{row.ok ? "OK" : "Failed"}</td>
                    <td className="td whitespace-normal align-top text-xs">
                      {row.ok ? (
                        <>
                          <span className="block">Data keys: {row.dataKeys.length ? row.dataKeys.join(", ") : "none"}</span>
                          {row.listKey && (
                            <span className="block">
                              List &quot;{row.listKey}&quot;: {row.listLength} item{row.listLength === 1 ? "" : "s"}
                              {row.itemKeys.length > 0 && ` — item keys: ${row.itemKeys.join(", ")}`}
                            </span>
                          )}
                        </>
                      ) : (
                        row.error
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            An OK result means TikTok answered, not that the app reads every field correctly. Compare the keys above with the field names listed as
            not yet verified in docs/tiktok-campaign-capability-matrix.md.
          </p>
        </>
      )}
    </div>
  );
}
