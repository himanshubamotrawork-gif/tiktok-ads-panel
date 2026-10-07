"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BID_STRATEGY_LABELS,
  UNBUILT_CAMPAIGN_TYPES,
  ageLabel,
  campaignTypeGroups,
  getCampaignType,
  type AudienceControl,
  type CampaignTypeConfig,
} from "@/integrations/tiktok/tiktok.capabilities";
import { buildPlan, validateDraft, type AudienceDraft, type CampaignDraft, type CreativeDraft } from "@/integrations/tiktok/tiktok.draft";
import type { GeoLevel, SparkPost } from "@/integrations/tiktok/tiktok.options";
import { formatBudget, formatMoney } from "@/lib/format";
import { dateToLocalInput, localInputToTikTokTime } from "@/lib/tiktok-time";
import {
  createCampaignAction,
  loadCampaignOptionsAction,
  searchLocationsAction,
  type CampaignOptions,
  type CreateCampaignResult,
} from "@/server/actions/campaign-builder";
import { setCampaignsDeliveryAction } from "@/server/actions/tiktok";
import type { AdAccountRow } from "@/server/dto";
import { Dialog } from "../ui/dialog";
import { Button, ErrorBanner, Field, InfoBanner } from "../ui/primitives";
import { AudienceFields } from "./audience-fields";
import { BudgetEditor } from "./budget-editor";
import { SparkCodeField } from "./spark-code-field";

const STEPS = ["Campaign type", "Destination", "Audience", "Budget and bidding", "Ad", "Review"] as const;

// Goals whose billing event on the manual path is taken from TikTok convention rather
// than a tool definition. See docs/tiktok-campaign-capability-matrix.md, section 2.
const UNVERIFIED_MANUAL_BILLING = new Set(["FOLLOWERS", "PAGE_VISIT", "LEAD_GENERATION"]);

const SPARK_POST_IDENTITIES = new Set(["TT_USER", "BC_AUTH_TT"]);

const EMPTY_AUDIENCE: AudienceDraft = {
  mode: "CUSTOM",
  locationIds: [],
  ageGroups: [],
  smartAge: "OVER_EIGHTEEN",
  gender: "GENDER_UNLIMITED",
  languages: [],
  os: "",
  interestCategoryIds: [],
  audienceIds: [],
  excludedAudienceIds: [],
};

interface FormState {
  typeId: string;
  name: string;
  adGroupName: string;
  destinationId: string;
  optimizationGoal: string;
  audience: AudienceDraft;
  budgetLevel: "CAMPAIGN" | "ADGROUP";
  budgetType: "DAILY" | "LIFETIME";
  budgetAmount: string;
  startLocal: string;
  endLocal: string;
  strategy: "BID_TYPE_NO_BID" | "BID_TYPE_CUSTOM";
  bidAmount: string;
  pacing: "PACING_MODE_SMOOTH" | "PACING_MODE_FAST";
  frequency: string;
  frequencySchedule: string;
  withAd: boolean;
  source: CreativeDraft["source"];
  adName: string;
  /** "identityType:identityId" of the identity picked from TikTok's list. */
  identityKey: string;
  tiktokItemId: string;
  videoId: string;
  coverImageId: string;
  adText: string;
  landingPageUrl: string;
  pageId: string;
  pixelId: string;
  optimizationEvent: string;
  callToAction: string;
  ctaPortfolioId: string;
}

function initialForm(): FormState {
  return {
    typeId: "",
    name: "",
    adGroupName: "",
    destinationId: "",
    optimizationGoal: "",
    audience: EMPTY_AUDIENCE,
    budgetLevel: "ADGROUP",
    budgetType: "DAILY",
    budgetAmount: "",
    startLocal: dateToLocalInput(new Date(Date.now() + 10 * 60_000)),
    endLocal: "",
    strategy: "BID_TYPE_NO_BID",
    bidAmount: "",
    pacing: "PACING_MODE_SMOOTH",
    frequency: "",
    frequencySchedule: "",
    withAd: true,
    source: "SPARK_CODE",
    adName: "",
    identityKey: "",
    tiktokItemId: "",
    videoId: "",
    coverImageId: "",
    adText: "",
    landingPageUrl: "",
    pageId: "",
    pixelId: "",
    optimizationEvent: "",
    callToAction: "",
    ctaPortfolioId: "",
  };
}

const optionalNumber = (value: string) => (value.trim() === "" ? undefined : Number(value));

function Choice({
  selected,
  onSelect,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`rounded-md border p-3 text-left text-sm transition ${selected ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
    >
      <span className="block font-medium text-slate-900">{title}</span>
      {children && <span className="mt-1 block text-xs text-slate-600">{children}</span>}
    </button>
  );
}

function ListError({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{children}</p>;
}

/**
 * Create-campaign wizard. It only edits a CampaignDraft: which controls appear comes from
 * tiktok.capabilities, validation and the MCP arguments come from tiktok.draft, and the
 * campaign is always created paused by the server.
 */
export function CreateWizard({
  account,
  bcName,
  bcId,
  writesEnabled,
}: {
  account: AdAccountRow;
  bcName: string | null;
  bcId: string | null;
  /** Mirrors the server's write switch. The server refuses writes regardless of this. */
  writesEnabled: boolean;
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<CampaignOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({});
  const [sparkPost, setSparkPost] = useState<SparkPost | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCampaignResult | null>(null);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchOutcome, setLaunchOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const loadId = useRef(0);

  const set = useCallback((patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch })), []);
  const currency = account.currency;
  const type = getCampaignType(form.typeId);
  const destination = type?.destinations.find((d) => d.id === form.destinationId);
  const optimization = destination?.optimizations.find((o) => o.goal === form.optimizationGoal);
  const automatic = type?.automation === "AUTOMATIC";
  const back = `/campaigns?account=${account.id}${bcId ? `&bc=${bcId}` : ""}`;

  function chooseType(next: CampaignTypeConfig) {
    const firstDestination = next.destinations[0];
    setSparkPost(null);
    set({
      typeId: next.id,
      destinationId: firstDestination?.id ?? "",
      optimizationGoal: firstDestination?.optimizations[0]?.goal ?? "",
      audience: { ...form.audience, mode: next.automation === "AUTOMATIC" ? "AUTOMATIC" : "CUSTOM" },
      budgetLevel: next.campaignBudgetDefault ? "CAMPAIGN" : "ADGROUP",
      strategy: "BID_TYPE_NO_BID",
      source: form.source === "LIBRARY_VIDEO" && !next.creative.library ? "SPARK_CODE" : form.source,
      identityKey: "",
      pageId: "",
      pixelId: "",
      optimizationEvent: "",
      callToAction: "",
    });
  }

  function chooseDestination(id: string) {
    const next = type?.destinations.find((d) => d.id === id);
    set({ destinationId: id, optimizationGoal: next?.optimizations[0]?.goal ?? "", pageId: "", pixelId: "", optimizationEvent: "" });
  }

  const loadOptions = useCallback(async () => {
    if (!form.typeId || !form.destinationId) return;
    const id = ++loadId.current;
    setOptionsLoading(true);
    setOptionsError(null);
    const loaded = await loadCampaignOptionsAction(account.id, form.typeId, form.destinationId);
    if (id !== loadId.current) return;
    setOptionsLoading(false);
    if (loaded.ok) setOptions(loaded.data);
    else {
      setOptions(null);
      setOptionsError(loaded.error);
    }
  }, [account.id, form.typeId, form.destinationId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const identities = useMemo(() => {
    const all = options?.identities ?? [];
    if (form.source === "SPARK_POST") return all.filter((i) => SPARK_POST_IDENTITIES.has(i.identityType));
    if (form.source === "LIBRARY_VIDEO") return all.filter((i) => i.identityType === "CUSTOMIZED_USER");
    return [];
  }, [options, form.source]);

  const draft = useMemo<CampaignDraft>(() => {
    const identity = identities.find((i) => `${i.identityType}:${i.identityId}` === form.identityKey);
    let creative: CreativeDraft | undefined;
    if (form.withAd) {
      const base = { adName: form.adName, source: form.source, adText: form.adText || undefined };
      creative =
        form.source === "SPARK_CODE"
          ? { ...base, identityType: "AUTH_CODE", identityId: sparkPost?.identityId ?? "", tiktokItemId: sparkPost?.tiktokItemId }
          : {
              ...base,
              identityType: (identity?.identityType ?? (form.source === "SPARK_POST" ? "TT_USER" : "CUSTOMIZED_USER")) as CreativeDraft["identityType"],
              identityId: identity?.identityId ?? "",
              identityAuthorizedBcId: identity?.identityAuthorizedBcId ?? undefined,
              ...(form.source === "SPARK_POST"
                ? { tiktokItemId: form.tiktokItemId.trim() || undefined }
                : { videoId: form.videoId.trim() || undefined, coverImageId: form.coverImageId.trim() || undefined }),
            };
    }
    const custom = form.strategy === "BID_TYPE_CUSTOM";
    return {
      advertiserId: account.id,
      typeId: form.typeId,
      name: form.name,
      adGroupName: form.adGroupName,
      destinationId: form.destinationId,
      optimizationGoal: form.optimizationGoal,
      audience: form.audience,
      budget: { level: form.budgetLevel, type: form.budgetType, amount: Number(form.budgetAmount) },
      schedule: { startTime: localInputToTikTokTime(form.startLocal), endTime: localInputToTikTokTime(form.endLocal) || undefined },
      bidding: {
        strategy: form.strategy,
        bidAmount: custom ? Number(form.bidAmount) : undefined,
        pacing: form.pacing,
        frequency: type?.frequencyCap ? optionalNumber(form.frequency) : undefined,
        frequencySchedule: type?.frequencyCap ? optionalNumber(form.frequencySchedule) : undefined,
      },
      creative,
      destination: {
        landingPageUrl: form.landingPageUrl.trim() || undefined,
        pageId: form.pageId || undefined,
        pixelId: form.pixelId || undefined,
        optimizationEvent: form.optimizationEvent || undefined,
        callToAction: form.callToAction || undefined,
        ctaPortfolioId: form.ctaPortfolioId.trim() || undefined,
      },
    };
  }, [account.id, form, identities, sparkPost, type]);

  const problem = useMemo(() => validateDraft(draft), [draft]);
  const plan = useMemo(() => (step === STEPS.length - 1 && !problem ? buildPlan(draft) : null), [step, problem, draft]);

  async function searchLocations(keyword: string, levels: GeoLevel[]) {
    if (!type) return { ok: false as const, error: "Choose a campaign type first." };
    return searchLocationsAction(account.id, type.objective, destination?.promotionType, keyword, levels);
  }

  async function create() {
    setSubmitting(true);
    setSubmitError(null);
    const created = await createCampaignAction(draft);
    setSubmitting(false);
    if (created.ok) setResult(created.data);
    else setSubmitError(created.error);
  }

  async function launch() {
    if (!result?.campaignId) return;
    setLaunching(true);
    const outcome = await setCampaignsDeliveryAction(account.id, [result.campaignId], "resume");
    setLaunching(false);
    setConfirmLaunch(false);
    const row = outcome.ok ? outcome.data[0] : undefined;
    if (!outcome.ok) setLaunchOutcome({ ok: false, message: outcome.error });
    else setLaunchOutcome({ ok: row?.ok === true, message: row?.message ?? "TikTok did not report a result for this campaign." });
  }

  const header = (
    <div>
      <Link href={back} className="text-sm text-brand-600 hover:underline">
        ← Campaigns
      </Link>
      <h1 className="mt-2 text-lg font-semibold text-slate-900">Create campaign</h1>
      <p className="mt-1 text-xs text-slate-500">
        Ad Account: <span className="font-medium text-slate-700">{account.name}</span> ({account.id})
        {bcName && <> · Business Center: {bcName}</>}
        {currency && <> · {currency}</>}
      </p>
    </div>
  );

  // ---------- result ----------

  if (result) {
    const detail = result.campaignId ? `/campaigns/${result.campaignId}?account=${account.id}${bcId ? `&bc=${bcId}` : ""}` : null;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {header}
        <div className={`card space-y-3 p-5 text-sm ${result.verified ? "" : "border-amber-300"}`}>
          <p className="text-base font-semibold text-slate-900">{result.verified ? "Campaign created and paused" : "Campaign creation was not confirmed"}</p>
          <p className="text-slate-700">{result.message}</p>
          <dl className="grid grid-cols-[160px_1fr] gap-y-1">
            <dt className="text-slate-500">Campaign ID</dt>
            <dd className="text-slate-900">{result.campaignId ?? "Not available"}</dd>
            <dt className="text-slate-500">TikTok status</dt>
            <dd className="text-slate-900">{result.status ?? "Not available"}</dd>
            <dt className="text-slate-500">Ad</dt>
            <dd className="text-slate-900">{result.hasAd ? "Created" : "None — add an ad in TikTok Ads Manager before launching"}</dd>
          </dl>
          {launchOutcome &&
            (launchOutcome.ok ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">{launchOutcome.message}</p>
            ) : (
              <ErrorBanner>{launchOutcome.message}</ErrorBanner>
            ))}
          <div className="flex flex-wrap gap-2 pt-1">
            {detail && (
              <Link href={detail} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Open campaign
              </Link>
            )}
            <Link href={back} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back to campaigns
            </Link>
            {result.verified && result.campaignId && result.hasAd && !launchOutcome?.ok && (
              <Button variant="primary" onClick={() => setConfirmLaunch(true)}>
                Launch campaign
              </Button>
            )}
          </div>
        </div>

        <Dialog
          open={confirmLaunch}
          title="Launch this campaign?"
          onClose={() => !launching && setConfirmLaunch(false)}
          footer={
            <>
              <Button onClick={() => setConfirmLaunch(false)} disabled={launching}>
                Cancel
              </Button>
              <Button variant="primary" onClick={launch} loading={launching}>
                Launch
              </Button>
            </>
          }
        >
          <p>
            Enable <span className="font-medium text-slate-900">{draft.name.trim()}</span> in {account.name}? Once TikTok approves the ad it can start
            delivering and spending{" "}
            <span className="font-medium text-slate-900">
              {formatBudget(draft.budget.amount, draft.budget.type === "LIFETIME" ? "BUDGET_MODE_TOTAL" : "BUDGET_MODE_DAY", currency)}
            </span>
            . The result is checked against TikTok before it is shown here.
          </p>
        </Dialog>
      </div>
    );
  }

  // ---------- steps ----------

  const audienceControls: AudienceControl[] = !type ? [] : form.audience.mode === "AUTOMATIC" ? type.automaticAudience ?? type.audience : type.audience;
  const dailyMode = type?.dailyBudgetMode ?? "BUDGET_MODE_DAY";
  const budgetMode = form.budgetType === "LIFETIME" ? "BUDGET_MODE_TOTAL" : dailyMode;
  const pixel = options?.pixels.find((p) => p.id === form.pixelId);
  const last = step === STEPS.length - 1;

  const locationNames = form.audience.locationIds.map(
    (id) => options?.countries.find((c) => c.id === id)?.label ?? locationLabels[id] ?? `Location ${id}`,
  );
  const review: [string, string][] = !type || !destination
    ? []
    : [
        ["Ad account", `${account.name} (${account.id})`],
        ["Campaign type", `${type.group} — ${automatic ? "Automatic (Smart+)" : "Manual"}`],
        ["Campaign name", draft.name.trim() || "Not set"],
        ["Ad group name", draft.adGroupName.trim() || "Not set"],
        ["Destination", destination.label],
        ["Optimization goal", optimization?.label ?? "Not set"],
        ["Audience", form.audience.mode === "AUTOMATIC" ? "Automatic — TikTok finds the audience" : "Custom"],
        ["Locations", locationNames.length ? locationNames.join(", ") : "None selected"],
        ...(audienceControls.includes("age")
          ? [["Age", form.audience.ageGroups.length ? form.audience.ageGroups.map(ageLabel).join(", ") : "All ages TikTok allows"] as [string, string]]
          : []),
        [
          "Budget",
          `${formatBudget(draft.budget.amount || null, budgetMode, currency)} — ${form.budgetLevel === "CAMPAIGN" ? "campaign budget" : "ad group budget"}`,
        ],
        ["Schedule (UTC)", `${draft.schedule.startTime || "Not set"} → ${draft.schedule.endTime ?? "no end time"}`],
        [
          "Bidding",
          form.strategy === "BID_TYPE_CUSTOM"
            ? `${BID_STRATEGY_LABELS.BID_TYPE_CUSTOM?.label}: ${formatMoney(Number(form.bidAmount) || null, currency)}`
            : (BID_STRATEGY_LABELS.BID_TYPE_NO_BID?.label ?? "Maximum delivery"),
        ],
        [
          "Ad",
          !form.withAd
            ? "None — the campaign is created without an ad"
            : `${draft.creative?.adName.trim() || "Not named"} · ${form.source === "LIBRARY_VIDEO" ? "Library video" : "Spark Ad"}`,
        ],
        ["Status after creation", "Paused. Nothing delivers until you launch it."],
      ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {header}

      {!writesEnabled && (
        <InfoBanner>
          Changes to TikTok are switched off on this deployment. You can fill in and review a campaign, but it cannot be created, and Spark codes
          cannot be applied, until the checks in Settings → Diagnostics have been run and <code>TIKTOK_WRITES_ENABLED=true</code> is set.
        </InfoBanner>
      )}

      <ol className="flex flex-wrap gap-1 border-b border-slate-200">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              disabled={!type && index > 0}
              onClick={() => setStep(index)}
              aria-current={step === index ? "step" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-300 ${step === index ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {optionsError && step > 0 && (
        <ErrorBanner action={<Button onClick={loadOptions}>Try again</Button>}>{optionsError} The choices TikTok provides could not be loaded.</ErrorBanner>
      )}

      {step === 0 && (
        <div className="card space-y-5 p-5">
          {campaignTypeGroups().map(({ group, types }) => (
            <div key={group}>
              <p className="label">{group}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {types.map((t) => (
                  <Choice
                    key={t.id}
                    selected={form.typeId === t.id}
                    onSelect={() => chooseType(t)}
                    title={types.length > 1 ? `${group} — ${t.automation === "AUTOMATIC" ? "Automatic (Smart+)" : "Manual"}` : t.label}
                  >
                    {t.description}
                  </Choice>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Not available in this panel yet</p>
            <ul className="mt-1 list-disc pl-4">
              {UNBUILT_CAMPAIGN_TYPES.map((u) => (
                <li key={u.label}>
                  {u.label}: {u.reason}
                </li>
              ))}
            </ul>
          </div>
          <InfoBanner>
            These campaign types are built from TikTok&apos;s MCP tool definitions and have not yet been confirmed by creating a live campaign. TikTok
            may reject a setting; if it does, its message is shown and whatever was created stays paused.
          </InfoBanner>
        </div>
      )}

      {type && destination && step === 1 && (
        <div className="card space-y-4 p-5">
          <Field label="Campaign name">
            <input className="input" value={form.name} maxLength={512} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Ad group name">
            <input className="input" value={form.adGroupName} maxLength={512} onChange={(e) => set({ adGroupName: e.target.value })} />
          </Field>
          <div>
            <p className="label">Destination</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {type.destinations.map((d) => (
                <Choice key={d.id} selected={form.destinationId === d.id} onSelect={() => chooseDestination(d.id)} title={d.label}>
                  {d.description}
                </Choice>
              ))}
            </div>
          </div>
          <Field label="Optimization goal">
            <select className="input" value={form.optimizationGoal} onChange={(e) => set({ optimizationGoal: e.target.value, pixelId: "", optimizationEvent: "" })}>
              {destination.optimizations.map((o) => (
                <option key={o.goal} value={o.goal}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {!automatic && optimization && UNVERIFIED_MANUAL_BILLING.has(optimization.goal) && (
            <InfoBanner>
              Not verified: the billing event sent for this goal ({optimization.billingEvent}) follows TikTok convention and is not spelled out in the
              MCP tool definition. TikTok may reject it.
            </InfoBanner>
          )}
          {!automatic && (type.objective === "WEB_CONVERSIONS" || destination.id === "WEBSITE_FORM") && (
            <p className="text-xs text-slate-500">
              Conversion (pixel event) optimization is not offered for manual campaigns because the MCP&apos;s ad group tool does not list it. It is
              available on the automatic (Smart+) type.
            </p>
          )}

          {destination.landingPage !== "none" && (
            <Field
              label={destination.landingPage === "required" ? "Landing page URL" : "Landing page URL (optional)"}
              hint={form.withAd ? undefined : "Used by the ad. It is only sent when an ad is created."}
            >
              <input className="input" type="url" placeholder="https://" value={form.landingPageUrl} onChange={(e) => set({ landingPageUrl: e.target.value })} />
            </Field>
          )}
          {destination.fields.includes("instantForm") && (
            <Field label="Instant Form">
              {options?.errors.instantForms ? (
                <ListError>{options.errors.instantForms}</ListError>
              ) : (
                <select className="input" value={form.pageId} disabled={optionsLoading} onChange={(e) => set({ pageId: e.target.value })}>
                  <option value="">{optionsLoading ? "Loading…" : options?.instantForms.length ? "Select a form" : "No published Instant Forms found"}</option>
                  {options?.instantForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {optimization?.needsPixel &&
            (options?.errors.pixels ? (
              <ListError>{options.errors.pixels}</ListError>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Pixel">
                  <select className="input" value={form.pixelId} disabled={optionsLoading} onChange={(e) => set({ pixelId: e.target.value, optimizationEvent: "" })}>
                    <option value="">{optionsLoading ? "Loading…" : options?.pixels.length ? "Select a pixel" : "No pixels found"}</option>
                    {options?.pixels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Event to optimize for">
                  <select className="input" value={form.optimizationEvent} disabled={!pixel} onChange={(e) => set({ optimizationEvent: e.target.value })}>
                    <option value="">{pixel && pixel.events.length === 0 ? "This pixel has no events" : "Select an event"}</option>
                    {pixel?.events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ))}
        </div>
      )}

      {type && step === 2 && (
        <div className="card space-y-4 p-5">
          {type.automaticAudience && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice selected={form.audience.mode === "AUTOMATIC"} onSelect={() => set({ audience: { ...form.audience, mode: "AUTOMATIC" } })} title="Automatic audience">
                TikTok finds the audience. Only location, minimum age, language, device and exclusions apply.
              </Choice>
              <Choice selected={form.audience.mode === "CUSTOM"} onSelect={() => set({ audience: { ...form.audience, mode: "CUSTOM" } })} title="Custom audience">
                You set the full targeting yourself.
              </Choice>
            </div>
          )}
          <AudienceFields
            controls={audienceControls}
            value={form.audience}
            onChange={(patch) => setForm((f) => ({ ...f, audience: { ...f.audience, ...patch } }))}
            options={{
              countries: options?.countries ?? [],
              languages: options?.languages ?? [],
              interests: options?.interests ?? [],
              audiences: options?.audiences ?? [],
              errors: options?.errors ?? {},
            }}
            loading={optionsLoading}
            onSearchLocations={searchLocations}
            locationLabels={locationLabels}
            onLocationLabel={(id, label) => setLocationLabels((labels) => ({ ...labels, [id]: label }))}
          />
        </div>
      )}

      {type && optimization && step === 3 && (
        <div className="card space-y-4 p-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice selected={form.budgetLevel === "CAMPAIGN"} onSelect={() => set({ budgetLevel: "CAMPAIGN" })} title="Campaign budget">
              TikTok distributes one budget across the campaign (campaign budget optimization).
            </Choice>
            <Choice selected={form.budgetLevel === "ADGROUP"} onSelect={() => set({ budgetLevel: "ADGROUP" })} title="Ad group budget">
              The budget is set on the ad group.
            </Choice>
          </div>
          <BudgetEditor
            level={form.budgetLevel === "CAMPAIGN" ? "campaign" : "adgroup"}
            mode={budgetMode}
            currency={currency}
            value={form.budgetAmount}
            onChange={(budgetAmount) => set({ budgetAmount })}
            modes={[dailyMode, "BUDGET_MODE_TOTAL"]}
            onModeChange={(mode) => set({ budgetType: mode === "BUDGET_MODE_TOTAL" ? "LIFETIME" : "DAILY" })}
          />
          <p className="-mt-2 text-xs text-slate-500">
            TikTok enforces a minimum budget per currency. The MCP does not expose it, so it cannot be checked here before sending.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" hint="Your local time. Sent to TikTok as UTC.">
              <input className="input" type="datetime-local" value={form.startLocal} onChange={(e) => set({ startLocal: e.target.value })} />
            </Field>
            <Field label={form.budgetType === "LIFETIME" ? "End time (required for a lifetime budget)" : "End time (optional)"}>
              <input className="input" type="datetime-local" value={form.endLocal} onChange={(e) => set({ endLocal: e.target.value })} />
            </Field>
          </div>

          <div>
            <p className="label">Bidding strategy</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {type.bidStrategies.map((s) => (
                <Choice key={s} selected={form.strategy === s} onSelect={() => set({ strategy: s })} title={BID_STRATEGY_LABELS[s]?.label ?? s}>
                  {BID_STRATEGY_LABELS[s]?.description}
                </Choice>
              ))}
            </div>
          </div>
          {form.strategy === "BID_TYPE_CUSTOM" && (
            <Field
              label={`${optimization.bidLabel}${currency ? ` (${currency})` : ""}`}
              hint={automatic ? "For automatic campaigns a cost cap needs a daily budget." : undefined}
            >
              <input className="input w-48" type="number" min="0" step="0.01" value={form.bidAmount} onChange={(e) => set({ bidAmount: e.target.value })} />
            </Field>
          )}
          {type.pacing && form.budgetLevel === "ADGROUP" && (
            <Field label="Delivery pacing">
              <select className="input w-64" value={form.pacing} onChange={(e) => set({ pacing: e.target.value as FormState["pacing"] })}>
                <option value="PACING_MODE_SMOOTH">Standard — spread evenly</option>
                <option value="PACING_MODE_FAST">Accelerated — spend as fast as possible</option>
              </select>
            </Field>
          )}
          {type.frequencyCap && (
            <div>
              <p className="label">Frequency cap (optional)</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                Show at most
                <input className="input w-24" type="number" min="1" max="1000" value={form.frequency} onChange={(e) => set({ frequency: e.target.value })} />
                times every
                <input className="input w-20" type="number" min="1" max="30" value={form.frequencySchedule} onChange={(e) => set({ frequencySchedule: e.target.value })} />
                days
              </div>
            </div>
          )}
        </div>
      )}

      {type && destination && step === 4 && (
        <div className="card space-y-4 p-5">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={form.withAd} onChange={(e) => set({ withAd: e.target.checked })} />
            Create an ad now
          </label>
          {!form.withAd ? (
            <p className="text-sm text-slate-600">The campaign and ad group will be created without an ad. Add one in TikTok Ads Manager before launching.</p>
          ) : (
            <>
              <Field label="Ad name">
                <input className="input" value={form.adName} maxLength={512} onChange={(e) => set({ adName: e.target.value })} />
              </Field>
              <div>
                <p className="label">Creative</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Choice selected={form.source === "SPARK_CODE"} onSelect={() => set({ source: "SPARK_CODE", identityKey: "" })} title="Spark code">
                    A creator&apos;s post, authorized with a code.
                  </Choice>
                  <Choice selected={form.source === "SPARK_POST"} onSelect={() => set({ source: "SPARK_POST", identityKey: "" })} title="Linked account post">
                    A post from a TikTok account linked to this ad account.
                  </Choice>
                  {type.creative.library && (
                    <Choice selected={form.source === "LIBRARY_VIDEO"} onSelect={() => set({ source: "LIBRARY_VIDEO", identityKey: "" })} title="Library video">
                      A video already uploaded to the asset library.
                    </Choice>
                  )}
                </div>
              </div>

              {form.source === "SPARK_CODE" && (
                <SparkCodeField advertiserId={account.id} post={sparkPost} onResolved={(post) => setSparkPost(post)} onClear={() => setSparkPost(null)} />
              )}

              {form.source !== "SPARK_CODE" && (
                <Field label={form.source === "SPARK_POST" ? "TikTok account" : "Custom identity"}>
                  {options?.errors.identities ? (
                    <ListError>{options.errors.identities}</ListError>
                  ) : (
                    <select className="input" value={form.identityKey} disabled={optionsLoading} onChange={(e) => set({ identityKey: e.target.value })}>
                      <option value="">
                        {optionsLoading ? "Loading…" : identities.length ? "Select an identity" : "TikTok returned no matching identities for this ad account"}
                      </option>
                      {identities.map((i) => (
                        <option key={`${i.identityType}:${i.identityId}`} value={`${i.identityType}:${i.identityId}`}>
                          {i.displayName} ({i.identityType})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {form.source === "SPARK_POST" && (
                <Field label="TikTok post ID" hint="A post picker is not built yet, so the post ID is entered by hand.">
                  <input className="input" inputMode="numeric" value={form.tiktokItemId} onChange={(e) => set({ tiktokItemId: e.target.value })} />
                </Field>
              )}
              {form.source === "LIBRARY_VIDEO" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Video ID">
                      <input className="input" value={form.videoId} onChange={(e) => set({ videoId: e.target.value })} />
                    </Field>
                    <Field label="Cover image ID">
                      <input className="input" value={form.coverImageId} onChange={(e) => set({ coverImageId: e.target.value })} />
                    </Field>
                  </div>
                  <InfoBanner>
                    Uploading creatives is not built yet, so the IDs of existing assets are entered by hand. TikTok no longer allows non-Spark video ads on
                    the TikTok placement for new ad accounts, so it may reject this ad.
                  </InfoBanner>
                </>
              )}
              <Field label={form.source === "LIBRARY_VIDEO" ? "Ad text" : "Ad text (optional)"} hint="At most 100 characters, no emoji.">
                <input className="input" value={form.adText} maxLength={100} onChange={(e) => set({ adText: e.target.value })} />
              </Field>

              {type.cta === "TEXT" &&
                (options?.errors.callToActions ? (
                  <ListError>{options.errors.callToActions} The ad will be created without a call to action.</ListError>
                ) : (
                  <Field label="Call to action (optional)" hint="Choices come from TikTok. Not verified against a live response yet.">
                    <select className="input w-64" value={form.callToAction} disabled={optionsLoading} onChange={(e) => set({ callToAction: e.target.value })}>
                      <option value="">{optionsLoading ? "Loading…" : "None"}</option>
                      {options?.callToActions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              {type.cta === "PORTFOLIO" && (
                <Field
                  label="Dynamic CTA portfolio ID"
                  hint="Required by TikTok for automatic campaigns. The MCP cannot list CTA portfolios, so copy the ID from TikTok Ads Manager."
                >
                  <input className="input w-64" value={form.ctaPortfolioId} onChange={(e) => set({ ctaPortfolioId: e.target.value })} />
                </Field>
              )}
              {destination.tiktokPageCategory === "PROFILE_PAGE" && (
                <p className="text-xs text-slate-500">This ad sends people to the profile of the TikTok account it runs as.</p>
              )}
            </>
          )}
        </div>
      )}

      {type && last && (
        <div className="card space-y-4 p-5">
          {submitError && <ErrorBanner>{submitError}</ErrorBanner>}
          {problem ? <ErrorBanner>{problem}</ErrorBanner> : <p className="text-sm text-slate-700">Check the settings below. The campaign is created paused.</p>}
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            {review.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-6 border-b border-slate-100 pb-2">
                <dt className="shrink-0 text-slate-500">{label}</dt>
                <dd className="text-right text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          {plan && (
            <details className="rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              <summary className="cursor-pointer font-medium">Exactly what will be sent to TikTok</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(plan, null, 2)}</pre>
            </details>
          )}
          <p className="text-xs text-slate-500">
            Not verified against live TikTok yet: this request is built from the MCP tool definitions. After creating, the panel re-reads the campaign
            from TikTok and reports only what TikTok shows.
          </p>
        </div>
      )}

      <div className="flex justify-between">
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submitting}>
          Back
        </Button>
        {last ? (
          <Button
            variant="primary"
            onClick={create}
            loading={submitting}
            disabled={!!problem || !writesEnabled}
            title={!writesEnabled ? "Changes to TikTok are switched off on this deployment" : undefined}
          >
            Create campaign (paused)
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!type}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
