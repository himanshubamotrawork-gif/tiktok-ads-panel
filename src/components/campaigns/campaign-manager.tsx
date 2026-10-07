"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { presetRange, type DateRangeValue } from "@/lib/date-range";
import { formatBudget, formatMoney, formatNumber, formatPercent, titleCase } from "@/lib/format";
import { loadCampaignMetricsAction, refreshCampaignsAction, setCampaignsDeliveryAction } from "@/server/actions/tiktok";
import type { AdAccountRow, BulkResultRow, BusinessCenterRow, CampaignRow, MetricsById } from "@/server/dto";
import { Dialog } from "../ui/dialog";
import { ActionMenu } from "../ui/menu";
import { Button, EmptyState, ErrorBanner, InfoBanner, TableSkeleton } from "../ui/primitives";
import { StatusBadge } from "../ui/status-badge";
import { useToast } from "../ui/toast";
import { AccountBar } from "./account-bar";
import { DateRangePicker } from "./date-range-picker";
import { EditCampaignDialog } from "./edit-campaign-dialog";

type Delivery = "pause" | "resume";

const STATUS_FILTERS = ["ACTIVE", "PAUSED", "PENDING", "UNDER_REVIEW", "REJECTED", "DISABLED", "UNKNOWN"] as const;

export function CampaignManager({
  businessCenters,
  accounts,
  selectedBc,
  selectedAccount,
  connected,
  initialCampaigns,
}: {
  businessCenters: BusinessCenterRow[];
  accounts: AdAccountRow[];
  selectedBc: string | null;
  selectedAccount: string | null;
  connected: boolean;
  initialCampaigns: CampaignRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const account = accounts.find((a) => a.id === selectedAccount) ?? null;
  const currency = account?.currency ?? null;

  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [metrics, setMetrics] = useState<MetricsById>({});
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(initialCampaigns[0]?.lastSyncedAt ?? null);

  const [range, setRange] = useState<DateRangeValue>(() => presetRange("last7"));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [confirm, setConfirm] = useState<{ action: Delivery; ids: string[] } | null>(null);
  const [working, setWorking] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ action: Delivery; rows: BulkResultRow[] } | null>(null);
  const [editing, setEditing] = useState<CampaignRow | null>(null);

  const rangeRef = useRef(range);
  rangeRef.current = range;

  const refresh = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);
    const result = await refreshCampaignsAction(selectedAccount, rangeRef.current);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCampaigns(result.data.campaigns);
    setMetrics(result.data.metrics);
    setMetricsError(result.data.metricsError);
    setMetricsLoaded(result.data.metricsError === null);
    setSyncedAt(new Date().toISOString());
  }, [selectedAccount]);

  // The database is only a cache: always fetch the current state from TikTok on open.
  useEffect(() => {
    setCampaigns(initialCampaigns);
    setSelected(new Set());
    setMetrics({});
    setMetricsLoaded(false);
    if (selectedAccount && connected) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, connected]);

  async function changeRange(next: DateRangeValue) {
    setRange(next);
    if (!selectedAccount || !connected) return;
    setMetricsLoaded(false);
    const result = await loadCampaignMetricsAction(selectedAccount, next);
    if (result.ok) {
      setMetrics(result.data);
      setMetricsError(null);
      setMetricsLoaded(true);
    } else {
      setMetrics({});
      setMetricsError(result.error);
    }
  }

  const objectives = useMemo(
    () => [...new Set(campaigns.map((c) => c.objective).filter((o): o is string => !!o))].sort(),
    [campaigns],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return campaigns.filter(
      (c) =>
        (!query || c.name.toLowerCase().includes(query) || c.id.includes(query)) &&
        (!statusFilter || c.status === statusFilter) &&
        (!objectiveFilter || c.objective === objectiveFilter),
    );
  }, [campaigns, search, statusFilter, objectiveFilter]);

  const visibleSelected = visible.filter((c) => selected.has(c.id));
  const allSelected = visible.length > 0 && visibleSelected.length === visible.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runDelivery() {
    if (!confirm || !selectedAccount) return;
    const { action, ids } = confirm;
    setWorking(true);
    const result = await setCampaignsDeliveryAction(selectedAccount, ids, action);
    setWorking(false);
    setConfirm(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (ids.length === 1) {
      const row = result.data[0];
      if (row?.ok) toast.success(row.message);
      else toast.error(row?.message ?? "The campaign could not be updated.");
    } else {
      setBulkResults({ action, rows: result.data });
    }
    setSelected(new Set());
    await refresh();
  }

  const metric = (id: string) => metrics[id];
  const noData = metricsLoaded ? "No data" : metricsError ? "Not available" : "…";
  const cell = (value: string | undefined) => value ?? noData;

  return (
    <div className="space-y-4">
      <AccountBar
        businessCenters={businessCenters}
        accounts={accounts}
        selectedBc={selectedBc}
        selectedAccount={selectedAccount}
        connected={connected}
      >
        <Button onClick={refresh} loading={loading} disabled={!selectedAccount || !connected}>
          Refresh
        </Button>
        {selectedAccount && connected ? (
          <Link
            href={`/campaigns/new?account=${selectedAccount}${selectedBc ? `&bc=${selectedBc}` : ""}`}
            className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
          >
            Create Campaign
          </Link>
        ) : (
          <Button variant="primary" disabled>
            Create Campaign
          </Button>
        )}
      </AccountBar>

      {!selectedAccount ? (
        <div className="card">
          <EmptyState title="Select an ad account">
            Choose a Business Center and an ad account above. Every campaign action runs against the selected account.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card flex flex-wrap items-end gap-3 p-3">
            <label className="block w-64">
              <span className="label">Search</span>
              <input className="input" placeholder="Campaign name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="block w-40">
              <span className="label">Status</span>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-44">
              <span className="label">Objective</span>
              <select className="input" value={objectiveFilter} onChange={(e) => setObjectiveFilter(e.target.value)}>
                <option value="">All objectives</option>
                {objectives.map((o) => (
                  <option key={o} value={o}>
                    {titleCase(o)}
                  </option>
                ))}
              </select>
            </label>
            <DateRangePicker onChange={changeRange} disabled={loading} />
            <div className="ml-auto text-right text-xs text-slate-500">
              {visible.length} of {campaigns.length} campaigns
              <br />
              {syncedAt ? `Synced with TikTok ${new Date(syncedAt).toLocaleTimeString()}` : "Not synced yet"}
            </div>
          </div>

          {error && (
            <ErrorBanner action={<Button onClick={refresh}>Try again</Button>}>
              {error} {campaigns.length > 0 && "The table shows the last saved copy, which may be out of date."}
            </ErrorBanner>
          )}
          {metricsError && <InfoBanner>{metricsError} Campaign settings are current; performance columns are unavailable.</InfoBanner>}

          {visibleSelected.length > 0 && (
            <div className="flex items-center gap-3 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm">
              <span className="font-medium text-brand-700">{visibleSelected.length} selected</span>
              <Button onClick={() => setConfirm({ action: "pause", ids: visibleSelected.map((c) => c.id) })}>Pause</Button>
              <Button onClick={() => setConfirm({ action: "resume", ids: visibleSelected.map((c) => c.id) })}>Resume</Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <div className="card overflow-hidden">
            {loading && campaigns.length === 0 ? (
              <TableSkeleton columns={9} />
            ) : campaigns.length === 0 ? (
              <EmptyState title={error ? "Campaigns could not be loaded" : "No campaigns in this ad account"}>
                {error ? "Fix the problem above and try again." : "Create a campaign to get started. Campaigns created in TikTok Ads Manager appear here after a refresh."}
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState title="No campaigns match these filters">Change the search, status or objective filter.</EmptyState>
            ) : (
              <div className={`max-h-[calc(100vh-330px)] overflow-auto ${loading ? "opacity-60" : ""}`}>
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="th w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((c) => c.id)))}
                        />
                      </th>
                      <th className="th">Campaign</th>
                      <th className="th">Status</th>
                      <th className="th">Objective</th>
                      <th className="th text-right">Budget</th>
                      <th className="th text-right">Spend</th>
                      <th className="th text-right">Impressions</th>
                      <th className="th text-right">Clicks</th>
                      <th className="th text-right">CTR</th>
                      <th className="th text-right">Conversions</th>
                      <th className="th">Created</th>
                      <th className="th">Updated</th>
                      <th className="th w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const m = metric(c.id);
                      const href = `/campaigns/${c.id}?account=${selectedAccount}${selectedBc ? `&bc=${selectedBc}` : ""}`;
                      const paused = c.operationStatus === "DISABLE";
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="td">
                            <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                          </td>
                          <td className="td max-w-xs">
                            <Link href={href} className="block truncate font-medium text-slate-900 hover:text-brand-600 hover:underline">
                              {c.name}
                            </Link>
                            <span className="text-xs text-slate-400">{c.id}</span>
                          </td>
                          <td className="td">
                            <StatusBadge status={c.status} externalStatus={c.externalStatus} />
                          </td>
                          <td className="td">{titleCase(c.objective)}</td>
                          <td className="td text-right">
                            {c.budgetMode === "BUDGET_MODE_INFINITE" ? (
                              <span className="text-slate-500" title="Budgets are set on the ad groups">
                                Ad group budgets
                              </span>
                            ) : (
                              formatBudget(c.budget, c.budgetMode, currency)
                            )}
                          </td>
                          <td className="td text-right tabular-nums">{cell(m ? formatMoney(m.spend, currency) : undefined)}</td>
                          <td className="td text-right tabular-nums">{cell(m ? formatNumber(m.impressions) : undefined)}</td>
                          <td className="td text-right tabular-nums">{cell(m ? formatNumber(m.clicks) : undefined)}</td>
                          <td className="td text-right tabular-nums">{cell(m ? formatPercent(m.ctr) : undefined)}</td>
                          <td className="td text-right tabular-nums">{cell(m ? formatNumber(m.conversions) : undefined)}</td>
                          <td className="td text-xs text-slate-500">{c.createdAt ?? "Not available"}</td>
                          <td className="td text-xs text-slate-500">{c.updatedAt ?? "Not available"}</td>
                          <td className="td">
                            <ActionMenu
                              label={`Actions for ${c.name}`}
                              items={[
                                { label: "View", onSelect: () => router.push(href) },
                                { label: "Edit", onSelect: () => setEditing(c) },
                                { label: "Pause", disabled: paused, hint: paused ? "Already paused" : undefined, onSelect: () => setConfirm({ action: "pause", ids: [c.id] }) },
                                { label: "Resume", disabled: !paused, hint: !paused ? "Not paused" : undefined, onSelect: () => setConfirm({ action: "resume", ids: [c.id] }) },
                                { label: "Budget", onSelect: () => setEditing(c) },
                                { label: "Refresh", onSelect: () => void refresh() },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Dialog
        open={confirm !== null}
        title={confirm?.action === "pause" ? "Pause campaigns?" : "Resume campaigns?"}
        onClose={() => !working && setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runDelivery} loading={working}>
              {confirm?.action === "pause" ? "Pause" : "Resume"}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-2">
            <p>
              {confirm.ids.length === 1
                ? `${confirm.action === "pause" ? "Pause" : "Resume"} this campaign?`
                : `You are about to ${confirm.action} ${confirm.ids.length} campaigns.`}
            </p>
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-slate-600">
              {confirm.ids.map((id) => (
                <li key={id}>{campaigns.find((c) => c.id === id)?.name ?? id}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Ad account: {account?.name ?? selectedAccount}. This changes the live campaign{confirm.ids.length > 1 ? "s" : ""} on TikTok. The result
              is checked against TikTok before it is shown here.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={bulkResults !== null}
        wide
        title={bulkResults?.action === "pause" ? "Pause results" : "Resume results"}
        onClose={() => setBulkResults(null)}
        footer={<Button onClick={() => setBulkResults(null)}>Close</Button>}
      >
        {bulkResults && (
          <div className="space-y-3">
            <p>
              {bulkResults.rows.filter((r) => r.ok).length} succeeded, {bulkResults.rows.filter((r) => !r.ok).length} failed.
            </p>
            <ul className="divide-y divide-slate-100">
              {bulkResults.rows.map((r) => (
                <li key={r.campaignId} className="flex gap-3 py-2">
                  <span className={`mt-0.5 text-xs font-semibold ${r.ok ? "text-emerald-600" : "text-red-600"}`}>{r.ok ? "Success" : "Failed"}</span>
                  <span>
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className="block text-xs text-slate-500">{r.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>

      {editing && selectedAccount && (
        <EditCampaignDialog
          campaign={editing}
          advertiserId={selectedAccount}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
