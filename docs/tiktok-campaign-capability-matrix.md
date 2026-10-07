# TikTok Campaign Capability Matrix

Source: the tool definitions exposed by the official TikTok for Business MCP
(`tt-ads-mcp-flat`), read on 2026-10-07. No live campaign call has been made yet, so
**nothing in this document is VERIFIED LIVE**.

Legend

| Mark | Meaning |
|---|---|
| VERIFIED LIVE | Confirmed by a real MCP response. None yet. |
| DEFINED BY MCP | Stated in an MCP tool definition (parameter, enum or description). |
| NOT YET VERIFIED | Needed by the app but not spelled out in a tool definition; taken from TikTok convention and must be checked live. |
| NOT SUPPORTED | The MCP definitions do not allow it. |
| NOT BUILT | Defined by the MCP but not implemented in this app yet. |

## 1. Campaign types

"Manual" campaigns use `campaign_create` → `adgroup_create` → `ad_create`.
"Automatic" campaigns are TikTok's Upgraded Smart+ and use `smart_plus_campaign_create`
→ `smart_plus_adgroup_create` → `smart_plus_ad_create`.

| Campaign type | Manual | Automatic (Smart+) | In the wizard |
|---|---|---|---|
| Lead generation (`LEAD_GENERATION`) | DEFINED BY MCP | DEFINED BY MCP | Yes, both |
| Sales, website (`WEB_CONVERSIONS`, `sales_destination=WEBSITE`) | DEFINED BY MCP | DEFINED BY MCP | Yes, both |
| Traffic (`TRAFFIC`) | DEFINED BY MCP | NOT SUPPORTED | Yes |
| Reach (`REACH`) | DEFINED BY MCP | NOT SUPPORTED | Yes |
| Video views (`VIDEO_VIEWS`) | DEFINED BY MCP | NOT SUPPORTED | Yes |
| Community interaction (`ENGAGEMENT`) | DEFINED BY MCP | NOT SUPPORTED | Yes |
| App promotion (`APP_PROMOTION`) | DEFINED BY MCP | DEFINED BY MCP | NOT BUILT (needs a registered app) |
| Product sales (`PRODUCT_SALES`: TikTok Shop, catalog) | DEFINED BY MCP, allowlist-only | NOT SUPPORTED here (GMV Max has separate tools) | NOT BUILT |
| Sales to app / web+app (`sales_destination=APP`, `WEB_AND_APP`) | DEFINED BY MCP | DEFINED BY MCP | NOT BUILT (needs catalog and app) |
| Reach & Frequency (`RF_REACH`) | DEFINED BY MCP (separate `adgroup_rf_*` tools) | NOT SUPPORTED | NOT BUILT |
| Search Ads campaign (`is_search_campaign`) | DEFINED BY MCP, allowlist-only | NOT SUPPORTED | NOT BUILT |

`objective_type` is a free string in `campaign_create`; the values above are the ones its
description and the `tool_targeting_search` enum name. The Smart+ enum is exactly
`APP_PROMOTION`, `WEB_CONVERSIONS`, `LEAD_GENERATION`.

## 2. Destinations and optimization

| Campaign type | Destination | MCP parameters | Optimization goals offered | Status |
|---|---|---|---|---|
| Lead gen, manual | Instant Form | `promotion_type=LEAD_GENERATION`, `promotion_target_type=INSTANT_PAGE`, ad `page_id` | `LEAD_GENERATION` | DEFINED BY MCP |
| Lead gen, manual | Website form | `promotion_type=LEAD_GENERATION`, `promotion_target_type=EXTERNAL_WEBSITE`, ad `landing_page_url` | `CLICK` | DEFINED BY MCP |
| Lead gen, automatic | Instant Form | same promotion fields, ad `page_list` | `LEAD_GENERATION` | DEFINED BY MCP |
| Lead gen, automatic | Website form | same promotion fields, ad `landing_page_url_list` | `CONVERT` (pixel + event), `CLICK` | DEFINED BY MCP |
| Sales, manual | Website | `promotion_type=WEBSITE`, ad `landing_page_url` | `CLICK`, `TRAFFIC_LANDING_PAGE_VIEW` | DEFINED BY MCP |
| Sales, automatic | Website | `sales_destination=WEBSITE`, `promotion_type=WEBSITE` | `CONVERT` (pixel + event), `CLICK`, `TRAFFIC_LANDING_PAGE_VIEW` | DEFINED BY MCP |
| Traffic | Website | `promotion_type=WEBSITE` | `CLICK`, `TRAFFIC_LANDING_PAGE_VIEW` | DEFINED BY MCP |
| Reach | None required (landing page optional) | no `promotion_type` | `REACH` | DEFINED BY MCP |
| Video views | None required | no `promotion_type`, `bid_display_mode=CPV` | `ENGAGED_VIEW`, `ENGAGED_VIEW_FIFTEEN` | DEFINED BY MCP |
| Community interaction | TikTok profile | `promotion_type=EXTERNAL_OR_DISPLAY`, ad `tiktok_page_category=PROFILE_PAGE` | `FOLLOWERS`, `PAGE_VISIT` | DEFINED BY MCP |

Findings that limit the manual flows:

- **Conversion optimization is not available for manual campaigns through the MCP as
  defined.** The `adgroup_create` description refers to `optimization_goal=CONVERT`, but
  the tool's allowed values do not include it. Manual Sales and manual website Lead
  generation are therefore limited to click or landing-page-view optimization. Conversion
  optimization with a pixel is available on the automatic (Smart+) path. NOT YET VERIFIED
  whether the live server accepts `CONVERT` anyway.
- Lead gen messaging destinations (TikTok direct message, messaging apps, phone call) and
  Instant Pages as a destination are DEFINED BY MCP and NOT BUILT.
- `VALUE` optimization is DEFINED BY MCP but its bidding strategies are allowlist-only; NOT BUILT.

Billing events: `adgroup_create` takes `billing_event` as a free string. The pairings
used (`CLICK`→`CPC`, `REACH`→`CPM`, `ENGAGED_VIEW*`→`CPV`, everything else→`OCPM`) follow
the `bid_price` / `conversion_bid_price` descriptions and the Smart+ enum (`OCPM`, `CPC`)
but are **NOT YET VERIFIED** for `FOLLOWERS`, `PAGE_VISIT` and `LEAD_GENERATION` on the
manual path.

## 3. Audience

| Option | Manual | Automatic (Smart+) | Source of choices | Status |
|---|---|---|---|---|
| Country | `location_ids` | `targeting_spec.location_ids` | `tool_region_get` | DEFINED BY MCP; response field names NOT YET VERIFIED |
| Region / city / district / DMA | `location_ids` | same | `tool_targeting_search` (`FUZZY_SEARCH`, `geo_types`) | DEFINED BY MCP; response NOT YET VERIFIED |
| ZIP / postal code | `zipcode_ids` | travel catalogs only | `tool_targeting_search` | DEFINED BY MCP, NOT BUILT |
| Age | `age_groups` (`AGE_13_17` … `AGE_55_100`) | custom mode: `age_groups`; automatic mode: `spc_audience_age` (18+ / 25+) | fixed enum | DEFINED BY MCP |
| Gender | `gender` | custom mode only | fixed enum | DEFINED BY MCP |
| Language | `languages` | `targeting_spec.languages` | `tool_language_get` | DEFINED BY MCP; response NOT YET VERIFIED |
| Device OS | `operating_systems` (one value) | same | fixed enum | DEFINED BY MCP |
| Interests | `interest_category_ids` | custom mode | `tool_interest_category_get` | DEFINED BY MCP; response NOT YET VERIFIED |
| Custom / lookalike audiences (include) | `audience_ids` | custom mode | `dmp_custom_audience_list_get` | DEFINED BY MCP; response NOT YET VERIFIED |
| Audience exclusions | `excluded_audience_ids` | both modes | same | DEFINED BY MCP |
| Behaviors, purchase intent, device model/price, carrier, network, household income, spending power, saved audiences | DEFINED BY MCP | DEFINED BY MCP | — | NOT BUILT |

Smart+ ad groups have `targeting_optimization_mode`: `AUTOMATIC` (TikTok finds the
audience; only location, minimum age, language, OS and exclusions are honoured) or
`MANUAL` (full custom targeting). Settings that do not match the mode are ignored by
TikTok **without an error**, so the wizard only shows the controls that apply.

Age restrictions: `AGE_13_17` is restricted in the US, Latin America, EEA, UK, Switzerland
and Canada in some scenarios. The app does not pre-check this; TikTok's rejection is shown.

## 4. Budget

| Option | Manual | Automatic (Smart+) | Status |
|---|---|---|---|
| Campaign budget (campaign budget optimization on) | `budget_optimize_on=true`; modes `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_DAY`, `BUDGET_MODE_TOTAL` | default on; `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_TOTAL` | DEFINED BY MCP |
| Ad group budget (optimization off) | campaign `BUDGET_MODE_INFINITE`; ad group `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_DAY`, `BUDGET_MODE_TOTAL` | campaign `BUDGET_MODE_INFINITE`; ad group `BUDGET_MODE_DYNAMIC_DAILY_BUDGET`, `BUDGET_MODE_TOTAL` | DEFINED BY MCP |
| Daily budget mode by objective | Traffic, Lead gen, Sales: dynamic daily. Reach, Video views, Community interaction: `BUDGET_MODE_DAY`, because dynamic daily is allowlist-only for them | dynamic daily only | DEFINED BY MCP |
| Lifetime budget | requires a start and end time | requires a start and end time | DEFINED BY MCP |
| Ad group budget when campaign budget is on | ignored by TikTok (the tool still requires the fields) | ignored | DEFINED BY MCP |
| Minimum amounts per currency | not exposed by the MCP; TikTok enforces | same | NOT SUPPORTED as a pre-check |

"Dynamic daily" is an average: a day can spend up to 125% of it, a week at most 7×.

## 5. Bidding

| Option | MCP parameters | Applies to | Status |
|---|---|---|---|
| Maximum delivery (lowest cost) | `bid_type=BID_TYPE_NO_BID` | all wizard types | DEFINED BY MCP (enum on Smart+; named in `adgroup_create` text) |
| Cost cap / target cost | `bid_type=BID_TYPE_CUSTOM` + `bid_price` (click, impression, view billing) or `conversion_bid_price` (`OCPM`) | all wizard types; Smart+ only with a dynamic daily budget | DEFINED BY MCP |
| Bid cap, minimum ROAS, highest value | `deep_bid_type`, `roas_bid` | value optimization | DEFINED BY MCP, allowlist-only, NOT BUILT |
| Delivery pacing | `pacing` standard / accelerated | manual, when campaign budget optimization is off | DEFINED BY MCP |
| Frequency cap | `frequency`, `frequency_schedule` | Reach only | DEFINED BY MCP |

## 6. Creative

| Option | MCP parameters | Manual | Automatic | Status |
|---|---|---|---|---|
| Spark Ad from a Spark code | `tt_video_authorize_apply` then `tt_video_info_get`; ad uses `identity_type=AUTH_CODE` + `tiktok_item_id` | Yes | Yes | DEFINED BY MCP; `tt_video_info_get` response fields NOT YET VERIFIED |
| Spark Ad from a linked TikTok account's post | `identity_get`, `identity_video_get`; `tiktok_item_id` | Yes (post ID entered) | Yes | DEFINED BY MCP; post picker NOT BUILT |
| Video from the asset library (non-Spark) | `video_id` + cover `image_ids`, `identity_type=CUSTOMIZED_USER` | Yes, but TikTok no longer allows this on TikTok placement for new ad accounts | NOT SUPPORTED on TikTok placement | DEFINED BY MCP |
| Image, carousel, catalog, live formats | `ad_format` other than `SINGLE_VIDEO` | DEFINED BY MCP | DEFINED BY MCP | NOT BUILT |
| Uploading creatives | `file_video_ad_upload`, `file_image_ad_upload` | — | — | NOT BUILT (later phase) |

The Spark code field is one component with a pluggable source, so the future Spark Code
Bank can supply codes without changing the wizard.

## 7. Call to action

| Option | MCP parameters | Status |
|---|---|---|
| Standard CTA (manual ads) | ad `call_to_action`; choices from `creative_cta_recommend_get` (`asset_type=CTA_NORMAL`) | DEFINED BY MCP; response fields NOT YET VERIFIED. If the list cannot be loaded the field is left out rather than filled with made-up values. |
| Dynamic CTA portfolio (automatic ads on TikTok placement) | `ad_configuration.call_to_action_id`, **required** | DEFINED BY MCP. CTA portfolios cannot be listed through the MCP (`creative_portfolio_list_get` excludes them), so the ID is entered by hand. Creating one through `creative_portfolio_create` is NOT BUILT. |

## 8. Editable after creation

| Property | Tool | Status |
|---|---|---|
| Campaign name | `campaign_update` | DEFINED BY MCP |
| Campaign budget amount (up or down, never below 105% of spend) | `campaign_update` | DEFINED BY MCP |
| Campaign status | `campaign_status_update` / `smart_plus_campaign_status_update` | DEFINED BY MCP |
| Campaign PO number, removing special ad categories | `campaign_update` | DEFINED BY MCP, NOT BUILT |
| Campaign objective, budget type, campaign budget optimization, sales destination | — | NOT SUPPORTED (no parameter in `campaign_update`) |
| Ad group name, audience (location, age, gender, language, OS, interests, audiences), bid amount, pacing, end time, day parting | `adgroup_update` (full replacement: every field is resent) | DEFINED BY MCP; resend behaviour NOT YET VERIFIED |
| Ad group budget | `adgroup_budget_update` (lifetime: immediate; daily: scheduled for about 00:00 account time) | DEFINED BY MCP |
| Ad group budget or bid strategy under campaign budget optimization | — | NOT SUPPORTED |
| Ad group placements, optimization goal, billing event, promotion type, pixel, attribution windows, start time once started | — | NOT SUPPORTED |
| Removing all US locations from an ad group that targeted the US | — | NOT SUPPORTED |
| Smart+ (automatic) ad group and ad editing | `smart_plus_adgroup_update`, `smart_plus_ad_update` | DEFINED BY MCP, NOT BUILT |
| Ad creative editing | `ad_update` | DEFINED BY MCP, NOT BUILT |

## 9. Reading and verification

| Need | Tool | Status |
|---|---|---|
| Manual campaigns, ad groups, ads | `campaign_get`, `adgroup_get`, `ad_get` | DEFINED BY MCP |
| Whether `campaign_get` also returns Smart+ campaigns | filter `campaign_automation_type=UPGRADED_SMART_PLUS` exists | NOT YET VERIFIED |
| Smart+ ad groups and ads | `adgroup_get` / `ad_get` with the automation filter; `ad_get` returns only a few fields for Smart+ ads | DEFINED BY MCP |
| Instant Forms | `page_get` (`business_type=LEAD_GEN`, `status=PUBLISHED`) | DEFINED BY MCP; response NOT YET VERIFIED |
| Pixels and their events | `pixel_list_get` | DEFINED BY MCP; response NOT YET VERIFIED |

## 10. How this is verified

Settings → Diagnostics runs every read-only tool above against a chosen ad account and
shows what TikTok returned (field names and counts, no writes). Run it on the deployed
app before turning on `TIKTOK_WRITES_ENABLED`; until that variable is `true`, every
create, edit, pause and resume is refused by the server.
