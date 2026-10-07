"use client";

import { useMemo, useState } from "react";
import { AGE_GROUPS, SMART_AGE_OPTIONS, ageLabel, type AudienceControl } from "@/integrations/tiktok/tiktok.capabilities";
import type { AudienceDraft } from "@/integrations/tiktok/tiktok.draft";
import type { GeoLevel, Option } from "@/integrations/tiktok/tiktok.options";
import { Button, Skeleton } from "../ui/primitives";

export interface AudienceOptions {
  countries: Option[];
  languages: Option[];
  interests: Option[];
  audiences: Option[];
  /** Load failures per list, shown next to the control they affect. */
  errors: Partial<Record<"countries" | "languages" | "interests" | "audiences", string>>;
}

const GEO_LEVELS: { value: GeoLevel; label: string }[] = [
  { value: "PROVINCE", label: "Region / state" },
  { value: "CITY", label: "City" },
  { value: "DISTRICT", label: "District" },
  { value: "DMA", label: "DMA (US)" },
];

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Searchable multi-select over options loaded from TikTok. */
function CheckList({
  label,
  options,
  selected,
  onChange,
  error,
  loading,
  emptyText,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  error?: string;
  loading?: boolean;
  emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div>
      <span className="label">
        {label} ({selected.length} selected)
      </span>
      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</p>
      ) : loading ? (
        <Skeleton className="h-28 w-full" />
      ) : options.length === 0 ? (
        <p className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-500">{emptyText}</p>
      ) : (
        <>
          {options.length > 8 && (
            <input className="input mb-2" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2">
            {visible.map((o) => (
              <label key={o.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onChange(toggle(selected, o.id))} />
                {o.label}
                {o.detail && <span className="text-xs text-slate-400">{o.detail}</span>}
              </label>
            ))}
            {visible.length === 0 && <p className="p-2 text-sm text-slate-500">Nothing matches.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Renders exactly the audience controls a campaign type supports. Which controls appear
 * comes from the capability config; the choices come from TikTok.
 */
export function AudienceFields({
  controls,
  value,
  onChange,
  options,
  loading,
  onSearchLocations,
  locationLabels,
  onLocationLabel,
}: {
  controls: AudienceControl[];
  value: AudienceDraft;
  onChange: (patch: Partial<AudienceDraft>) => void;
  options: AudienceOptions;
  loading: boolean;
  /** Region/city search. Omitted when the surrounding form cannot search. */
  onSearchLocations?: (keyword: string, levels: GeoLevel[]) => Promise<{ ok: true; data: Option[] } | { ok: false; error: string }>;
  /** Names of selected locations that are not in the country list. */
  locationLabels: Record<string, string>;
  onLocationLabel: (id: string, label: string) => void;
}) {
  const has = (control: AudienceControl) => controls.includes(control);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoLevel, setGeoLevel] = useState<GeoLevel>("CITY");
  const [geoResults, setGeoResults] = useState<Option[] | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const countryIds = useMemo(() => new Set(options.countries.map((c) => c.id)), [options.countries]);
  const otherLocations = value.locationIds.filter((id) => !countryIds.has(id));

  async function search() {
    if (!onSearchLocations) return;
    setSearching(true);
    setGeoError(null);
    const result = await onSearchLocations(geoQuery, [geoLevel]);
    setSearching(false);
    if (result.ok) setGeoResults(result.data);
    else {
      setGeoResults(null);
      setGeoError(result.error);
    }
  }

  return (
    <div className="space-y-4">
      {has("geo") && (
        <div className="space-y-3">
          <CheckList
            label="Countries and regions"
            options={options.countries}
            selected={value.locationIds.filter((id) => countryIds.has(id))}
            onChange={(next) => onChange({ locationIds: [...next, ...otherLocations] })}
            error={options.errors.countries}
            loading={loading}
            emptyText="TikTok returned no locations for this campaign type."
          />
          {onSearchLocations && (
            <div>
              <span className="label">Add a region, city or other area</span>
              <div className="flex gap-2">
                <select className="input w-40" value={geoLevel} onChange={(e) => setGeoLevel(e.target.value as GeoLevel)}>
                  {GEO_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder="Type a name, e.g. California"
                  value={geoQuery}
                  onChange={(e) => setGeoQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void search();
                    }
                  }}
                />
                <Button onClick={search} loading={searching} disabled={geoQuery.trim().length < 2}>
                  Search
                </Button>
              </div>
              {geoError && <p className="mt-1 text-xs text-red-600">{geoError}</p>}
              {geoResults && (
                <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {geoResults.length === 0 ? (
                    <p className="p-1 text-sm text-slate-500">TikTok found no matching locations.</p>
                  ) : (
                    geoResults.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={value.locationIds.includes(o.id)}
                          onChange={() => {
                            onLocationLabel(o.id, o.detail ? `${o.label} (${o.detail})` : o.label);
                            onChange({ locationIds: toggle(value.locationIds, o.id) });
                          }}
                        />
                        {o.label}
                        {o.detail && <span className="text-xs text-slate-400">{o.detail}</span>}
                      </label>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">TikTok does not allow overlapping areas, such as a country together with one of its cities.</p>
            </div>
          )}
          {otherLocations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {otherLocations.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {locationLabels[id] ?? `Location ${id}`}
                  <button type="button" aria-label="Remove" onClick={() => onChange({ locationIds: value.locationIds.filter((x) => x !== id) })}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {has("age") && (
        <div>
          <span className="label">Age (leave empty for all ages TikTok allows)</span>
          <div className="flex flex-wrap gap-2">
            {AGE_GROUPS.map((age) => (
              <label
                key={age}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${value.ageGroups.includes(age) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
              >
                <input type="checkbox" className="sr-only" checked={value.ageGroups.includes(age)} onChange={() => onChange({ ageGroups: toggle(value.ageGroups, age) })} />
                {ageLabel(age)}
              </label>
            ))}
          </div>
        </div>
      )}

      {has("smartAge") && (
        <label className="block w-56">
          <span className="label">Minimum age</span>
          <select className="input" value={value.smartAge} onChange={(e) => onChange({ smartAge: e.target.value as AudienceDraft["smartAge"] })}>
            {SMART_AGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {has("gender") && (
          <label className="block">
            <span className="label">Gender</span>
            <select className="input" value={value.gender} onChange={(e) => onChange({ gender: e.target.value as AudienceDraft["gender"] })}>
              <option value="GENDER_UNLIMITED">All</option>
              <option value="GENDER_FEMALE">Female</option>
              <option value="GENDER_MALE">Male</option>
            </select>
          </label>
        )}
        {has("os") && (
          <label className="block">
            <span className="label">Device operating system</span>
            <select className="input" value={value.os} onChange={(e) => onChange({ os: e.target.value as AudienceDraft["os"] })}>
              <option value="">iOS and Android</option>
              <option value="ANDROID">Android only</option>
              <option value="IOS">iOS only</option>
            </select>
          </label>
        )}
      </div>

      {has("language") && (
        <CheckList
          label="Languages (leave empty for all)"
          options={options.languages}
          selected={value.languages}
          onChange={(languages) => onChange({ languages })}
          error={options.errors.languages}
          loading={loading}
          emptyText="TikTok returned no languages."
        />
      )}
      {has("interests") && (
        <CheckList
          label="Interests"
          options={options.interests}
          selected={value.interestCategoryIds}
          onChange={(interestCategoryIds) => onChange({ interestCategoryIds })}
          error={options.errors.interests}
          loading={loading}
          emptyText="TikTok returned no interest categories."
        />
      )}
      {has("audiences") && (
        <CheckList
          label="Custom and lookalike audiences to include"
          options={options.audiences}
          selected={value.audienceIds}
          onChange={(audienceIds) => onChange({ audienceIds })}
          error={options.errors.audiences}
          loading={loading}
          emptyText="This ad account has no custom audiences."
        />
      )}
      {has("exclusions") && (
        <CheckList
          label="Audiences to exclude"
          options={options.audiences.filter((a) => !value.audienceIds.includes(a.id))}
          selected={value.excludedAudienceIds}
          onChange={(excludedAudienceIds) => onChange({ excludedAudienceIds })}
          error={options.errors.audiences}
          loading={loading}
          emptyText="This ad account has no custom audiences."
        />
      )}
    </div>
  );
}
