"use client";

import { useEffect, useMemo, useState } from "react";
import type { AudienceControl } from "@/integrations/tiktok/tiktok.capabilities";
import type { AdGroupChanges } from "@/integrations/tiktok/tiktok.ad-groups";
import type { AudienceDraft } from "@/integrations/tiktok/tiktok.draft";
import type { GeoLevel } from "@/integrations/tiktok/tiktok.options";
import { localInputToTikTokTime, tikTokTimeToLocalInput } from "@/lib/tiktok-time";
import {
  editAdGroupAction,
  loadAdGroupEditOptionsAction,
  searchLocationsAction,
  type AdGroupEditOptions,
} from "@/server/actions/campaign-builder";
import type { AdGroupRow } from "@/server/dto";
import { Dialog } from "../ui/dialog";
import { Button, ErrorBanner, Field } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { AudienceFields } from "./audience-fields";

// The targeting adgroup_update can change. Smart+ ad groups are not editable here.
const CONTROLS: AudienceControl[] = ["geo", "age", "gender", "language", "os", "interests", "audiences", "exclusions"];

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function audienceOf(targeting: Record<string, unknown>): AudienceDraft {
  const os = strings(targeting.operating_systems);
  const gender = targeting.gender;
  return {
    mode: "CUSTOM",
    locationIds: strings(targeting.location_ids),
    ageGroups: strings(targeting.age_groups),
    smartAge: "OVER_EIGHTEEN",
    gender: gender === "GENDER_FEMALE" || gender === "GENDER_MALE" ? gender : "GENDER_UNLIMITED",
    languages: strings(targeting.languages),
    os: os.length === 1 && (os[0] === "ANDROID" || os[0] === "IOS") ? os[0] : "",
    interestCategoryIds: strings(targeting.interest_category_ids),
    audienceIds: strings(targeting.audience_ids),
    excludedAudienceIds: strings(targeting.excluded_audience_ids),
  };
}

const LIST_FIELDS: [keyof AdGroupChanges & keyof AudienceDraftLists, keyof AudienceDraftLists, string][] = [
  ["locationIds", "locationIds", "Locations"],
  ["ageGroups", "ageGroups", "Ages"],
  ["languages", "languages", "Languages"],
  ["interestCategoryIds", "interestCategoryIds", "Interests"],
  ["audienceIds", "audienceIds", "Included audiences"],
  ["excludedAudienceIds", "excludedAudienceIds", "Excluded audiences"],
];

type AudienceDraftLists = Pick<AudienceDraft, "locationIds" | "ageGroups" | "languages" | "interestCategoryIds" | "audienceIds" | "excludedAudienceIds">;

/**
 * Edits the ad group settings TikTok allows to change after creation: name, targeting,
 * cost cap and end time. Only what changed is sent; the server resends the rest unchanged
 * and confirms every change against a fresh read from TikTok.
 */
export function EditAdGroupDialog({
  advertiserId,
  campaignId,
  group,
  currency,
  onClose,
  onSaved,
}: {
  advertiserId: string;
  campaignId: string;
  group: AdGroupRow;
  currency: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const initial = useMemo(() => audienceOf(group.targeting), [group.targeting]);
  const initialEnd = useMemo(() => tikTokTimeToLocalInput(group.scheduleEndTime), [group.scheduleEndTime]);
  const [name, setName] = useState(group.name);
  const [audience, setAudience] = useState<AudienceDraft>(initial);
  const [bid, setBid] = useState(group.bidAmount !== null ? String(group.bidAmount) : "");
  const [endLocal, setEndLocal] = useState(initialEnd);
  const [options, setOptions] = useState<AdGroupEditOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAdGroupEditOptionsAction(advertiserId, campaignId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setOptions(result.data);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [advertiserId, campaignId]);

  const { changes, summary } = useMemo(() => {
    const changes: AdGroupChanges = {};
    const summary: [string, string][] = [];
    if (name.trim() !== group.name) {
      changes.name = name.trim();
      summary.push(["Name", `${group.name} → ${name.trim()}`]);
    }
    for (const [field, key, label] of LIST_FIELDS) {
      if (!sameSet(audience[key], initial[key])) {
        changes[field] = audience[key];
        summary.push([label, `${initial[key].length} selected → ${audience[key].length} selected`]);
      }
    }
    if (audience.gender !== initial.gender) {
      changes.gender = audience.gender;
      summary.push(["Gender", `${initial.gender.replace("GENDER_", "")} → ${audience.gender.replace("GENDER_", "")}`]);
    }
    if (audience.os !== initial.os) {
      changes.operatingSystems = audience.os ? [audience.os] : [];
      summary.push(["Device OS", `${initial.os || "iOS and Android"} → ${audience.os || "iOS and Android"}`]);
    }
    if (group.bidAmount !== null && bid.trim() !== "" && Number(bid) !== group.bidAmount) {
      changes.bidAmount = Number(bid);
      summary.push(["Cost cap", `${group.bidAmount} → ${bid}${currency ? ` ${currency}` : ""}`]);
    }
    const end = localInputToTikTokTime(endLocal);
    if (end && endLocal !== initialEnd) {
      changes.scheduleEndTime = end;
      summary.push(["End time (UTC)", `${group.scheduleEndTime ?? "none"} → ${end}`]);
    }
    return { changes, summary };
  }, [name, audience, bid, endLocal, group, initial, initialEnd, currency]);

  const problem =
    name.trim() === ""
      ? "Ad group name cannot be empty."
      : audience.locationIds.length === 0
        ? "An ad group needs at least one location."
        : changes.bidAmount !== undefined && !(changes.bidAmount > 0)
          ? "Enter a cost cap greater than 0."
          : null;

  async function searchLocations(keyword: string, levels: GeoLevel[]) {
    return searchLocationsAction(advertiserId, options?.objective ?? "", undefined, keyword, levels);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await editAdGroupAction(advertiserId, campaignId, group.id, changes);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.data.message);
    onSaved();
  }

  return (
    <Dialog
      open
      wide
      title={review ? "Review changes" : "Edit ad group"}
      onClose={() => !saving && onClose()}
      footer={
        review ? (
          <>
            <Button onClick={() => setReview(false)} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Save Changes
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={summary.length === 0 || !!problem} onClick={() => setReview(true)}>
              Review changes
            </Button>
          </>
        )
      }
    >
      {review ? (
        <div className="space-y-3">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <p>These changes will be sent to TikTok for {group.name}:</p>
          <dl className="space-y-2">
            {summary.map(([label, value]) => (
              <div key={label}>
                <dt className="label">{label}</dt>
                <dd className="text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">
            TikTok replaces the whole ad group on an update, so the current settings are resent together with these changes. This behaviour has not
            been verified against live TikTok yet; the result is checked field by field after saving.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {loadError && <ErrorBanner>{loadError} The lists TikTok provides could not be loaded.</ErrorBanner>}
          {problem && <p className="text-xs text-red-600">{problem}</p>}
          <Field label="Ad group name">
            <input className="input" value={name} maxLength={512} onChange={(e) => setName(e.target.value)} />
          </Field>
          <AudienceFields
            controls={CONTROLS}
            value={audience}
            onChange={(patch) => setAudience((a) => ({ ...a, ...patch }))}
            options={{
              countries: options?.countries ?? [],
              languages: options?.languages ?? [],
              interests: options?.interests ?? [],
              audiences: options?.audiences ?? [],
              errors: options?.errors ?? {},
            }}
            loading={loading}
            onSearchLocations={options?.objective ? searchLocations : undefined}
            locationLabels={locationLabels}
            onLocationLabel={(id, label) => setLocationLabels((labels) => ({ ...labels, [id]: label }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Cost cap${currency ? ` (${currency})` : ""}`}
              hint={group.bidAmount === null ? "This ad group does not use a cost cap, so there is no bid to change." : undefined}
            >
              <input className="input" type="number" min="0" step="0.01" value={bid} disabled={group.bidAmount === null} onChange={(e) => setBid(e.target.value)} />
            </Field>
            <Field label="End time" hint="Your local time. Sent to TikTok as UTC.">
              <input className="input" type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
            </Field>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Fixed after creation on TikTok</p>
            <p className="mt-1">Placements, optimization goal, billing event, promotion type, pixel and the start time once it has passed.</p>
            <p className="mt-1">The budget is changed with Edit Budget.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
