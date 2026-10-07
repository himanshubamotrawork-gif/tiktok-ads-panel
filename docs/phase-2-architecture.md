# Phase 2 Architecture — TikTok Ads Control Layer (Vercel + PostgreSQL)

Status: **application built against the MCP tool definitions; not yet run against live TikTok.** See section 9. Last updated 2026-10-07.

This document supersedes the connection-status section of `tiktok-mcp-setup.md`: the MCP
was later authorized successfully from Claude Code (31 ad accounts visible), but the
connection is only reachable while this machine has a network route to
`business-api.tiktok.com` (see section 7).

## 1. Target architecture

```
Browser (React UI)
   ↓  HTTPS, session cookie only — no TikTok tokens
Next.js on Vercel (App Router, TypeScript)
   ↓  server actions / route handlers
src/integrations/tiktok/  (service → MCP client)
   ↓  Streamable HTTP + OAuth bearer token
Official TikTok for Business MCP  (https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat)
   ↓
TikTok Business Centers / ad accounts

PostgreSQL (serverless-pooled)  ← cache, OAuth tokens (encrypted), operations, activity log
```

- The browser never talks to the MCP and never receives a TikTok token.
- No traditional TikTok Marketing API integration, no TikTok developer app, no API keys.
- TikTok is authoritative for campaign state; PostgreSQL is cache and application state.

## 2. Custom MCP client authorization — what is and is not verified

The connection Claude Code holds cannot be reused by the Vercel app. It is an OAuth grant
issued to Claude Code's own client registration with a `localhost` callback. The Vercel
app must be its own MCP client with its own registration and its own user consent.

### 2.1 Evidence

| Claim | Source | Confidence |
|---|---|---|
| Server is a Streamable HTTP MCP endpoint protected by OAuth | Observed in this environment | Verified |
| Authorization endpoint is `https://business-api.tiktok.com/portal/mcp-tt4b-authorize` | Observed in the sign-in URL issued to Claude Code | Verified |
| Flow is authorization code + PKCE (`S256`), scope `mcp:tt4b`, with a `resource` parameter naming the MCP endpoint | Observed in the same URL | Verified |
| A client ID was issued with no developer app, key or secret supplied by us | Observed (Phase 1 registered only the URL) | Verified |
| "You do not need to register a developer account or create a developer app" | TikTok portal docs, read via search summary only | Reported |
| Clients self-register via Dynamic Client Registration (`POST /oauth/register`) | Third-party write-ups | Reported |
| TikTok's portal has separate guides for ready-made agents and for custom agents | Search summary of `business-api.tiktok.com/portal/docs` | Reported |
| Authorization expires after about 30 days and must be renewed | Third-party write-up | Reported |
| Registration accepts a non-loopback HTTPS redirect URI (a Vercel domain) | — | **Not verified** |
| Refresh tokens are issued, and their lifetime | — | **Not verified** |
| TikTok's terms permit a hosted multi-user product built on the MCP | — | **Not verified** |

"Reported" rows could not be read first-hand: TikTok's documentation and the server's
OAuth discovery documents are blocked on this network, so only search summaries were
available. They must be confirmed before production work depends on them.

### 2.2 Intended authorization flow for the Vercel app

Standard MCP authorization, implemented with the official MCP TypeScript SDK
(`@modelcontextprotocol/sdk`: `StreamableHTTPClientTransport` plus a custom
`OAuthClientProvider` backed by PostgreSQL):

1. **Discovery.** Unauthenticated request returns `401` with `WWW-Authenticate` pointing
   at the protected-resource metadata; that names the authorization server, whose
   metadata lists the authorization, token and registration endpoints.
2. **Client registration (once per deployment).** Register the app with redirect URI
   `https://<app-domain>/api/tiktok/oauth/callback`. Store the returned client ID (and
   secret, if one is issued) in PostgreSQL / Vercel environment variables.
3. **Connect.** User clicks "Connect TikTok". A route handler creates `state` and a PKCE
   verifier, stores them in PostgreSQL keyed to the user's session, and redirects the
   browser to TikTok's authorization page.
4. **Callback.** `GET /api/tiktok/oauth/callback` validates `state`, exchanges the code
   for tokens server-side, encrypts and stores them.
5. **Use.** Every server-side MCP call loads the token, refreshes it if needed, and sends
   it as a bearer token.
6. **Expiry.** If refresh is not possible, the connection is marked `REAUTH_REQUIRED` and
   the UI asks the user to reconnect. No silent failure.

### 2.3 Verification gate (must pass before the integration is built)

A small spike, deployed to a Vercel preview (which can reach TikTok), that runs steps 1–5
and then calls `tools/list` and `bc_get`. It answers the three unverified rows above.
Outcomes:

- **Passes with an HTTPS redirect URI:** build as designed.
- **Only loopback redirect URIs are accepted:** a hosted app cannot complete sign-in on
  its own. Options then are a one-time local sign-in helper that uploads the tokens, or
  stopping. This is a decision for the owner, not something to work around silently.
- **TikTok requires a credential for custom clients:** document exactly what the official
  docs require and get the owner's decision before requesting anything.

No fallback to the Marketing API in any outcome.

## 3. Vercel / serverless constraints and how the design meets them

| Constraint | Design |
|---|---|
| No permanent process | Each request builds a short-lived MCP client; no session is held between requests |
| No in-memory source of truth | OAuth state, PKCE verifier, tokens, operations and cache rows all live in PostgreSQL |
| No local disk | Nothing is written to the filesystem at runtime |
| Function time limits | Phase 2 operations are single request/response. Bulk actions run in bounded batches with controlled concurrency and persist per-item results, so a timeout loses nothing already done |
| Connection limits | Pooled PostgreSQL connection string (Neon or Vercel Postgres) with a serverless driver; Prisma client created once per function instance |
| Secrets | `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, session secret as Vercel environment variables; tokens encrypted at rest (AES-256-GCM); never logged, never sent to the browser |
| Token refresh races | **Not handled yet.** Two functions refreshing at the same moment could both rotate the token. To be decided once the verification gate shows whether TikTok issues rotating refresh tokens |
| Future background jobs | `TikTokOperation` rows are the queue contract; later phases can drive them from Vercel Cron or an external worker without schema changes |
| MCP tool list size | The flat endpoint exposes about 400 tools; the app calls tools by name and does not need to list them per request |

Runtime: Node.js serverless functions (not Edge), because the MCP SDK and the database
driver need Node APIs.

## 4. Code layout

```
src/integrations/tiktok/
  tiktok.client.ts        short-lived MCP session per request, callTool(), timeouts
  tiktok.oauth.ts         PostgreSQL-backed OAuth provider, start/complete authorization
  tiktok.service.ts       business centers, ad accounts, pagination
  tiktok.campaigns.ts     list, get, create, update, status
  tiktok.ad-groups.ts     list, get, create, budget, status
  tiktok.ads.ts           list, create, identities, locations
  tiktok.reporting.ts     report_integrated_get wrappers
  tiktok.budget.ts        budget rules from the tool definitions
  tiktok.mappers.ts       response envelope, entity mapping, status normalization
  tiktok.types.ts
  tiktok.errors.ts        typed errors and user-facing messages
src/server/
  operations/runner.ts    execute -> re-read -> verify -> log, for every write
  operations/bulk.ts      bounded-concurrency bulk runner
  workflows.ts            pause/resume, edit, ad group budget, create and launch
  actions/                server actions (the only thing the UI calls)
  sync.ts, queries.ts     PostgreSQL cache writes and reads
src/app, src/components   UI
```

Every write goes through one runner: record `QUEUED` → `RUNNING` → call MCP → re-read the
object from TikTok → compare → `SUCCEEDED`, `FAILED` or `VERIFICATION_FAILED` → write
`ActivityLog`. Success is reported only from the re-read state.

## 5. Data model (PostgreSQL)

- `Workspace`, `User`
- `TikTokConnection` — client registration, encrypted tokens, expiry, status
- `OAuthState` — short-lived `state` + PKCE verifier
- `BusinessCenter`, `AdAccount`
- `Campaign`, `AdGroup`, `Ad` — each with normalized `status`, original `externalStatus`,
  and `lastSyncedAt`
- `TikTokOperation` — `QUEUED | RUNNING | SUCCEEDED | FAILED | VERIFICATION_FAILED`
- `ActivityLog` — actor, action, resource, before, after, result, timestamp

Only fields TikTok actually returns get columns; raw payloads are kept in a `jsonb`
column for anything not modelled.

## 6. MCP tools for Phase 2

Taken from the tool definitions exposed by the server. Only `user_info_get` and
`auth_advertiser_get` have been called successfully so far; the rest are **not yet
exercised**.

| Need | Tool |
|---|---|
| Business Centers | `bc_get` |
| Ad accounts in a Business Center | `bc_asset_get` (`asset_type=ADVERTISER`), `advertiser_info_get` |
| All authorized ad accounts | `auth_advertiser_get` |
| Campaigns / ad groups / ads | `campaign_get`, `adgroup_get`, `ad_get` |
| Metrics | `report_integrated_get` |
| Create | `campaign_create` → `adgroup_create` → `ad_create` |
| Pause / resume | `campaign_status_update`, `adgroup_status_update`, `ad_status_update` |
| Edit campaign | `campaign_update` |
| Ad group budget | `adgroup_budget_update`, `adgroup_update` |

Known limits from the definitions:

- `campaign_update` changes only name, budget, PO number and special ad categories.
  Objective and budget mode are fixed after creation.
- A new budget must be at least 105% of current spend.
- Ad group daily-budget changes via `adgroup_budget_update` are scheduled for about 00:00
  the next day in the account's time zone; lifetime-budget changes apply immediately.
  Budgets cannot be changed between 23:55 and 00:00.
- Campaign Budget Optimization is a campaign-level switch (`budget_optimize_on`); when on,
  ad group budgets are ignored and cannot be updated.
- `campaign_status_update` accepts up to 20 campaigns per call.
- `adgroup_update` is a full-replacement update, so the app must resend all required
  fields; budget-only changes will use `adgroup_budget_update` instead.
- `changelog_get` covers Business Center activity only. Campaign activity in the UI comes
  from the app's own `ActivityLog`.
- Ads require an identity and existing creative assets; uploading creatives is Phase 3, so
  the wizard's creative step can only select assets that already exist.

## 7. Network constraint on the development machine

On the current network `business-api.tiktok.com` resolves to an ISP block address and
connections time out, so local development cannot reach TikTok unless the machine has
another route. Consequences:

- Automated tests use mocks and run anywhere.
- Live testing happens on Vercel preview deployments.
- Capability checks from Claude Code only work while the route is available.

## 8. Decisions taken

1. Project lives in `G:\tiktok ads`.
2. Multiple users: each user has an account; a workspace holds one TikTok connection shared
   by its members. Only workspace owners can connect or disconnect TikTok.
3. Any ad account in the Business Center may be used for live write tests; whichever is
   used must be reported.
4. Still open: Vercel project and PostgreSQL provider (Neon or Vercel Postgres).

## 9. What is and is not verified in the built application

Verified by automated tests with mocks (no TikTok calls): response-envelope parsing,
entity mapping, status normalization, budget rules, error messages, the
execute/verify/log runner, pause, resume, edit, ad group budget, create-and-launch
ordering and partial-failure handling, bulk concurrency and per-item results.

Not verified, because TikTok was unreachable from the development network during the
build and no database was available locally:

- The custom-client sign-in (section 2.3). Nothing in the app has talked to TikTok.
- Response field names that the tool definitions do not spell out and that were taken
  from TikTok API conventions: `page_info.total_page`, `bc_info` nesting in `bc_get`,
  `asset_id`/`asset_name` in `bc_asset_get`, `region_info` in `tool_region_get`,
  `ad_ids` returned by `ad_create`, `scheduled_budget` on ad groups, and report rows as
  `{ dimensions, metrics }`. The mappers tolerate missing fields, but each must be
  checked against a live response.
- Request values not listed as enums in the tool definitions: `bid_type` values
  `BID_TYPE_NO_BID` / `BID_TYPE_CUSTOM`, billing events `CPC` / `CPM` / `CPV`, and the
  `secondary_status` strings the status normalizer matches on.
- Any database query, the UI in a browser, and every live TikTok read or write.
