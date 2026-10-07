"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { presetRange, type DateRangeValue } from "@/lib/date-range";
import { budgetModeLabel, formatBudget, formatMoney, formatNumber, formatPercent, titleCase } from "@/lib/format";
import { changeAdGroupBudgetAction, refreshCampaignDetailAction, setCampaignsDeliveryAction } from "@/server/actions/tiktok";
import type { AdAccountRow, AdGroupRow, CampaignDetailData } from "@/server/dto";
import { Dialog } from "../ui/dialog";
import { Button, EmptyState, ErrorBanner, InfoBanner, Skeleton } from "../ui/primitives";
import { StatusBadge } from "../ui/status-badge";
import { useToast } from "../ui/toast";
import { ActivityList } from "./activity-list";
import { BudgetEditor } from "./budget-editor";
import { DateRangePicker } from "./date-range-picker";
import { EditAdGroupDialog } from "./edit-ad-group-dialog";
import { EditCampaignDialog } from "./edit-campaign-dialog";

const TABS = ["Overview", "Performance", "Ad Groups", "Ads", "Activity"] as const;
type Tab = (typeof TABS)[number];

function targetingSummary(targeting: Record<string, unknown>): string {
  const parts: string[] = [];
  const count = (key: string, label: string) => {
    const value = targeting[key];
    if (Array.isArray(value) && value.length) parts.push(`${value.length} ${label}${value.length > 1 ? "s" : ""}`);
  };
  count("location_ids", "location");
  if (typeof targeting.gender === "string") parts.push(titleCase(targeting.gender.replace("GENDER_", "")));
  if (Array.isArray(targeting.age_groups) && targeting.age_groups.length) {
    parts.push(targeting.age_groups.map((a) => String(a).replace("AGE_", "").replace("_", "–")).join(", "));
  }
  count("languages", "language");
  if (Array.isArray(targeting.operating_systems) && targeting.operating_systems.length) {
    parts.push(targeting.operating_systems.join(", "));
  }
  count("interest_category_ids", "interest");
  count("audience_ids", "audience");
  return parts.length ? parts.join(" · ") : "Not available";
}

export function CampaignDetail({
  advertiserId,
  campaignId,
  bcId,
  account,
  connected,
  initial,
}: {
  advertiserId: string;
  campaignId: string;
  bcId: string | null;
  account: AdAccountRow;
  connected: boolean;
  initial: Pick<CampaignDetailData, "campaign" | "adGroups" | "ads" | "activity"> | null;
}) {
  const toast = useToast();
  const currency = account.currency;
  const [data, setData] = useState<CampaignDetailData | null>(
    initial ? { ...initial, campaignMetrics: null, adMetrics: {}, metricsError: null } : null,
  );
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [range, setRange] = useState<DateRangeValue>(() => presetRange("last7"));
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"pause" | "resume" | null>(null);
  const [working, setWorking] = useState(false);
  const [budgetGroup, setBudgetGroup] = useState<AdGroupRow | null>(null);
  const [editGroup, setEditGroup] = useState<AdGroupRow | null>(null);
  const [groupBudget, setGroupBudget] = useState("");
  const [groupBudgetError, setGroupBudgetError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await refreshCampaignDetailAction(advertiserId, campaignId, rangeRef.current);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
    setMetricsLoaded(result.data.metricsError === null);
  }, [advertiserId, campaignId]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  async function runDelivery() {
    if (!confirm) return;
    setWorking(true);
    const result = await setCampaignsDeliveryAction(advertiserId, [campaignId], confirm);
    setWorking(false);
    setConfirm(null);
    const row = result.ok ? result.data[0] : undefined;
    if (!result.ok) toast.error(result.error);
    else if (row?.ok) toast.success(row.message);
    else toast.error(row?.message ?? "The campaign could not be updated.");
    await refresh();
  }

  async function saveGroupBudget() {
    if (!budgetGroup) return;
    const amount = Number(groupBudget);
    if (!Number.isFinite(amount) || amount <= 0) {
      setGroupBudgetError("Budget must be a number greater than 0.");
      return;
    }
    setWorking(true);
    setGroupBudgetError(null);
    const result = await changeAdGroupBudgetAction(advertiserId, campaignId, budgetGroup.id, amount);
    setWorking(false);
    if (!result.ok) {
      setGroupBudgetError(result.error);
      return;
    }
    toast.success(result.data.message);
    setBudgetGroup(null);
    await refresh();
  }

  const back = `/campaigns?account=${advertiserId}${bcId ? `&bc=${bcId}` : ""}`;

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href={back} className="text-sm text-brand-600 hover:underline">
          ← Campaigns
        </Link>
        {error ? (
          <ErrorBanner action={<Button onClick={refresh}>Try again</Button>}>{error}</ErrorBanner>
        ) : !connected ? (
          <ErrorBanner>This workspace is not connected to TikTok, and this campaign has not been loaded before.</ErrorBanner>
        ) : (
          <div className="card space-y-3 p-5">
            <Skeleton className="h-6 w-72" />
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </div>
    );
  }

  const { campaign, adGroups, ads, campaignMetrics: m, adMetrics, activity } = data;
  const paused = campaign.operationStatus === "DISABLE";
  const cbo = campaign.budgetOptimizeOn === true;
  const noData = metricsLoaded ? "No data" : data.metricsError ? "Not available" : "…";
  const groupName = (id: string) => adGroups.find((g) => g.id === id)?.name ?? id;

  const overview: [string, React.ReactNode][] = [
    ["Campaign name", campaign.name],
    ["Campaign ID", campaign.id],
    ["Objective", titleCase(campaign.objective)],
    ["Status", <StatusBadge key="s" status={campaign.status} externalStatus={campaign.externalStatus} />],
    ["TikTok status", campaign.externalStatus ?? "Not available"],
    ["Budget mode", budgetModeLabel(campaign.budgetMode)],
    ["Budget", campaign.budgetMode === "BUDGET_MODE_INFINITE" ? "Set on ad groups" : formatBudget(campaign.budget, campaign.budgetMode, currency)],
    [
      "Campaign budget optimization",
      campaign.budgetOptimizeOn === null ? "Not available" : cbo ? "On — TikTok distributes the campaign budget across ad groups" : "Off — each ad group has its own budget",
    ],
    ["Created", campaign.createdAt ?? "Not available"],
    ["Updated", campaign.updatedAt ?? "Not available"],
  ];

  const performance: [string, string][] = [
    ["Spend", m ? formatMoney(m.spend, currency) : noData],
    ["Impressions", m ? formatNumber(m.impressions) : noData],
    ["Clicks", m ? formatNumber(m.clicks) : noData],
    ["CTR", m ? formatPercent(m.ctr) : noData],
    ["Conversions", m ? formatNumber(m.conversions) : noData],
    ["Cost per conversion", m ? (m.costPerConversion === null ? "No data" : formatMoney(m.costPerConversion, currency)) : noData],
  ];

  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm text-brand-600 hover:underline">
        ← Campaigns
      </Link>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-lg font-semibold text-slate-900">{campaign.name}</h1>
            <StatusBadge status={campaign.status} externalStatus={campaign.externalStatus} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Ad Account: <span className="font-medium text-slate-700">{account.name}</span> ({account.id}) · Campaign ID {campaign.id}
          </p>
        </div>
        <Button onClick={refresh} loading={loading} disabled={!connected}>
          Refresh
        </Button>
        <Button onClick={() => setEditing(true)} disabled={!connected}>
          Edit
        </Button>
        <Button variant="primary" onClick={() => setConfirm(paused ? "resume" : "pause")} disabled={!connected}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      {error && <ErrorBanner action={<Button onClick={refresh}>Try again</Button>}>{error} Showing the last saved copy.</ErrorBanner>}

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t}
            {t === "Ad Groups" && ` (${adGroups.length})`}
            {t === "Ads" && ` (${ads.length})`}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="card p-4">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {overview.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2 text-sm">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {tab === "Performance" && (
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <DateRangePicker
              disabled={loading}
              onChange={(next) => {
                setRange(next);
                rangeRef.current = next;
                setMetricsLoaded(false);
                void refresh();
              }}
            />
            <p className="text-xs text-slate-500">
              {range.startDate} to {range.endDate}, in the ad account&apos;s time zone
            </p>
          </div>
          {data.metricsError && <InfoBanner>{data.metricsError}</InfoBanner>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {performance.map(([label, value]) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            CPA is shown as cost per conversion. ROAS is not shown because it depends on purchase-value events that this report does not include.
          </p>
        </div>
      )}

      {tab === "Ad Groups" && (
        <div className="space-y-3">
          <div className="card flex items-center justify-between p-4 text-sm">
            <div>
              <p className="font-semibold text-slate-800">Campaign budget</p>
              <p className="text-slate-600">
                {campaign.budgetMode === "BUDGET_MODE_INFINITE" ? "None — budgets are set on each ad group below" : formatBudget(campaign.budget, campaign.budgetMode, currency)}
              </p>
            </div>
            <Button onClick={() => setEditing(true)} disabled={!connected || campaign.budgetMode === "BUDGET_MODE_INFINITE"}>
              Edit Budget
            </Button>
          </div>
          {cbo && (
            <InfoBanner>
              Campaign budget optimization is on. TikTok distributes the campaign budget across these ad groups automatically, so ad group budgets
              cannot be edited.
            </InfoBanner>
          )}
          <div className="card overflow-x-auto">
            {adGroups.length === 0 ? (
              <EmptyState title="No ad groups">This campaign has no ad groups on TikTok.</EmptyState>
            ) : (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="th">Ad group</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Budget</th>
                    <th className="th">Bid strategy</th>
                    <th className="th">Optimization goal</th>
                    <th className="th">Targeting</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {adGroups.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="td">
                        <span className="font-medium text-slate-900">{g.name}</span>
                        <span className="block text-xs text-slate-400">{g.id}</span>
                      </td>
                      <td className="td">
                        <StatusBadge status={g.status} externalStatus={g.externalStatus} />
                      </td>
                      <td className="td text-right">
                        {cbo ? <span className="text-slate-500">Managed by campaign</span> : formatBudget(g.budget, g.budgetMode, currency)}
                        {g.scheduledBudget !== null && !cbo && g.scheduledBudget !== g.budget && (
                          <span className="block text-xs text-amber-700">Scheduled: {formatBudget(g.scheduledBudget, g.budgetMode, currency)}</span>
                        )}
                      </td>
                      <td className="td">{g.bidStrategy ?? "Not available"}</td>
                      <td className="td">{titleCase(g.optimizationGoal)}</td>
                      <td className="td max-w-sm truncate" title={targetingSummary(g.targeting)}>
                        {targetingSummary(g.targeting)}
                      </td>
                      <td className="td space-x-2 text-right">
                        <Button
                          disabled={!connected || campaign.automatic}
                          title={campaign.automatic ? "Editing ad groups of automatic (Smart+) campaigns is not available in this panel yet" : undefined}
                          onClick={() => setEditGroup(g)}
                        >
                          Edit
                        </Button>
                        <Button
                          disabled={!connected || cbo}
                          title={cbo ? "Managed by the campaign budget" : undefined}
                          onClick={() => {
                            setBudgetGroup(g);
                            setGroupBudget(g.budget !== null ? String(g.budget) : "");
                            setGroupBudgetError(null);
                          }}
                        >
                          Edit Budget
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "Ads" && (
        <div className="card overflow-x-auto">
          {ads.length === 0 ? (
            <EmptyState title="No ads">This campaign has no ads on TikTok.</EmptyState>
          ) : (
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="th">Ad</th>
                  <th className="th">Status</th>
                  <th className="th">Ad group</th>
                  <th className="th">Creative</th>
                  <th className="th">Destination</th>
                  <th className="th text-right">Spend</th>
                  <th className="th text-right">Impressions</th>
                  <th className="th text-right">Clicks</th>
                  <th className="th text-right">CTR</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const am = adMetrics[ad.id];
                  return (
                    <tr key={ad.id} className="hover:bg-slate-50">
                      <td className="td">
                        <span className="font-medium text-slate-900">{ad.name}</span>
                        <span className="block text-xs text-slate-400">{ad.id}</span>
                      </td>
                      <td className="td">
                        <StatusBadge status={ad.status} externalStatus={ad.externalStatus} />
                      </td>
                      <td className="td">{groupName(ad.adGroupId)}</td>
                      <td className="td max-w-xs">
                        <span>{titleCase(ad.adFormat)}</span>
                        <span className="block truncate text-xs text-slate-500" title={ad.adText ?? undefined}>
                          {ad.adText ?? "No ad text"}
                        </span>
                      </td>
                      <td className="td max-w-xs">
                        <span className="block truncate" title={ad.landingPageUrl ?? undefined}>
                          {ad.landingPageUrl ?? "Not available"}
                        </span>
                        <span className="text-xs text-slate-500">{ad.callToAction ? `CTA: ${titleCase(ad.callToAction)}` : ""}</span>
                      </td>
                      <td className="td text-right tabular-nums">{am ? formatMoney(am.spend, currency) : noData}</td>
                      <td className="td text-right tabular-nums">{am ? formatNumber(am.impressions) : noData}</td>
                      <td className="td text-right tabular-nums">{am ? formatNumber(am.clicks) : noData}</td>
                      <td className="td text-right tabular-nums">{am ? formatPercent(am.ctr) : noData}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "Activity" && (
        <div className="card">
          <ActivityList rows={activity} />
        </div>
      )}

      <Dialog
        open={confirm !== null}
        title={confirm === "pause" ? "Pause this campaign?" : "Resume this campaign?"}
        onClose={() => !working && setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runDelivery} loading={working}>
              {confirm === "pause" ? "Pause" : "Resume"}
            </Button>
          </>
        }
      >
        <p>
          {confirm === "pause" ? "Pause" : "Resume"} <span className="font-medium text-slate-900">{campaign.name}</span> in {account.name}? This changes the
          live campaign on TikTok. The result is checked against TikTok before it is shown here.
        </p>
      </Dialog>

      <Dialog
        open={budgetGroup !== null}
        title="Edit ad group budget"
        onClose={() => !working && setBudgetGroup(null)}
        footer={
          <>
            <Button onClick={() => setBudgetGroup(null)} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveGroupBudget} loading={working} disabled={groupBudget.trim() === "" || Number(groupBudget) === budgetGroup?.budget}>
              Save Changes
            </Button>
          </>
        }
      >
        {budgetGroup && (
          <div className="space-y-3">
            <p className="font-medium text-slate-900">{budgetGroup.name}</p>
            <BudgetEditor
              level="adgroup"
              mode={budgetGroup.budgetMode}
              current={budgetGroup.budget}
              currency={currency}
              value={groupBudget}
              onChange={setGroupBudget}
              error={groupBudgetError}
            />
            {groupBudget.trim() !== "" && Number(groupBudget) !== budgetGroup.budget && (
              <p>
                <span className="text-slate-500 line-through">{formatBudget(budgetGroup.budget, budgetGroup.budgetMode, currency)}</span> →{" "}
                <span className="font-medium text-slate-900">{formatBudget(Number(groupBudget), budgetGroup.budgetMode, currency)}</span>
              </p>
            )}
          </div>
        )}
      </Dialog>

      {editGroup && (
        <EditAdGroupDialog
          advertiserId={advertiserId}
          campaignId={campaignId}
          group={editGroup}
          currency={currency}
          onClose={() => setEditGroup(null)}
          onSaved={() => {
            setEditGroup(null);
            void refresh();
          }}
        />
      )}

      {editing && (
        <EditCampaignDialog
          campaign={campaign}
          advertiserId={advertiserId}
          currency={currency}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
