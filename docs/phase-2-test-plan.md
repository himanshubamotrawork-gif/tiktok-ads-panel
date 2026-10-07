# Phase 2 Manual Test Plan

Run this on a deployment that can reach `business-api.tiktok.com` (a Vercel preview is
the intended place; the development network blocks TikTok). Use one test ad account and
write its ID here before starting:

- Test ad account: `________________`  Business Center: `________________`
- Tester: `________________`  Date: `________________`  Deployment URL: `________________`

Status so far: **none of these checks has been performed.** Automated tests cover the
logic with mocks only.

## 0. Prerequisites

- [ ] `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` set
- [ ] `npm run db:migrate` applied to the database
- [ ] Register a user and workspace; sign in

## 1. Connection (verification gate)

- [ ] Settings → Connect TikTok redirects to TikTok's authorization page
- [ ] After approving, the browser returns to Settings and shows "Connected"
- [ ] Record whether TikTok accepted the HTTPS callback URL (if not, stop: see architecture §2.3)
- [ ] `TikTokConnection.tokensEnc` is populated and is not readable JSON
- [ ] No token appears in browser storage, cookies (other than the app session), or network responses
- [ ] Leave the app idle past token expiry, then refresh campaigns: record whether refresh works or "Reconnect required" appears

## 2. Discovery

- [ ] Connect Business Center: the selector lists the Business Centers visible to the TikTok user
- [ ] Business Center name, ID, role and status match TikTok Business Center
- [ ] Load ad accounts: selecting a Business Center lists its ad accounts
- [ ] Ad account name, ID, currency, time zone and status match TikTok Ads Manager
- [ ] Select ad account: the account is shown under the selectors and in the URL
- [ ] "All accessible ad accounts" lists every account the connection can use

## 3. Campaign Manager (read-only)

- [ ] Load campaigns: the table matches TikTok Ads Manager for the account
- [ ] Status badges match; hovering shows the original TikTok status
- [ ] Budget column matches, including campaigns with ad-group-level budgets
- [ ] Spend, impressions, clicks, CTR, conversions match Ads Manager for the same date range
- [ ] Campaigns with no delivery show "No data", not zeros
- [ ] Search, status filter, objective filter and date range work
- [ ] Open campaign: overview fields match TikTok
- [ ] View ad groups: budget, bid strategy, optimization goal and targeting summary match
- [ ] View ads: creative, destination and per-ad metrics match

## 4. Create and launch

- [ ] Create test campaign (Traffic, ad group budget, one country) **paused**, without an ad
- [ ] Verify campaign appears in TikTok Ads Manager, paused, with the same name, budget and targeting
- [ ] Create a second test campaign with a Spark Ad and "Enable the campaign after creating it"
- [ ] The confirmation dialog shows account, campaign, budget, objective, targeting, ad group and ad counts
- [ ] The result screen reports the status TikTok returned (for example "Under review"), not just "launched"
- [ ] Force a failure (invalid post ID): the message names the problem and lists what was already created; the campaign is left paused
- [ ] Repeat for Reach and Video views objectives and record whether TikTok accepts the ad group settings

## 5. Pause / resume

- [ ] Pause campaign from the row menu
- [ ] Verify paused state in TikTok Ads Manager and in the table after refresh
- [ ] Resume campaign
- [ ] Verify active state (or the review status TikTok reports) in both places
- [ ] Select several campaigns → Pause: confirmation shows "You are about to pause N campaigns"
- [ ] The results dialog lists each campaign with its own success or failure

## 6. Edit and budgets

- [ ] Edit campaign name: the review step shows old → new; verify in TikTok
- [ ] Change campaign budget on a campaign with a campaign-level budget
- [ ] Verify budget in TikTok Ads Manager
- [ ] Try a budget below 105% of spend: the app rejects it with an explanation
- [ ] On a campaign with ad-group budgets, the campaign budget is locked with an explanation
- [ ] Change ad group budget (lifetime budget): verify budget in TikTok immediately
- [ ] Change ad group budget (daily budget): the app reports it as scheduled; verify the new budget after 00:00 account time
- [ ] On a campaign with campaign budget optimization, "Edit Budget" on ad groups is disabled

## 7. Sync and logs

- [ ] Change a campaign in TikTok Ads Manager, then Refresh data: the table shows the change
- [ ] Delete a test campaign in Ads Manager, then refresh: it disappears from the table
- [ ] Verify local DB synchronization: `Campaign`, `AdGroup`, `Ad` rows match TikTok, `externalStatus` holds the original status, `lastSyncedAt` is current
- [ ] Check activity log: every write above has an entry with user, before, after, result and time
- [ ] `TikTokOperation` rows show `SUCCEEDED`, `FAILED` or `VERIFICATION_FAILED` consistently with what happened
- [ ] No token or secret appears in `ActivityLog`, `TikTokOperation` or server logs

## 8. Failure handling

- [ ] Test MCP failure: set `TIKTOK_MCP_URL` to an unreachable host; campaign load shows a clear "could not be reached" message and the cached table stays visible
- [ ] Test permission failure: connect with a TikTok user who has read-only access to the ad account; pause shows a permission message, and the campaign is not shown as paused
- [ ] Disconnect in Settings: campaign pages show the "not connected" banner and writes are disabled
- [ ] Sign in as a non-owner member: connect and disconnect are unavailable; campaign actions work

## 9. Clean-up

- [ ] Pause or delete every test campaign in TikTok Ads Manager
- [ ] Record the IDs of everything created: `________________`
