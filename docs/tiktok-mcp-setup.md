# TikTok for Business MCP Server — Setup Status

## 1. MCP Server URL

```
https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat
```

This is the official "flat" TikTok Ads MCP endpoint named in TikTok's own documentation:
https://ads.tiktok.com/resources/help/article/about-tiktok-for-business-mcp-server

## 2. How it was configured

Registered in Claude Code's local MCP config using the built-in CLI (no API key, secret, or
developer app was created or requested):

```
claude mcp add --transport http tiktok-business https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat
```

Scope: **local** (private to this project, stored in `C:\Users\himan\.claude.json`).

Verification commands used:

```
claude mcp list
claude mcp get tiktok-business
```

## 3. Connection status: ❌ NOT CONNECTED (network-level block, not an MCP/auth problem)

```
tiktok-business: https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat (HTTP)
  ✘ Failed to connect — Version negotiation probe timed out after 5000ms
```

### Root cause identified

This is **not** a Claude Code configuration issue, and it never reached TikTok's OAuth/login
step. Diagnostics show the block happens before any TLS handshake:

- `nslookup business-api.tiktok.com` on this network resolves the hostname to
  `202.56.230.30` via an ISP-level DNS rewrite (`restricted.rpz.airtelspam.com` — an
  Airtel "Response Policy Zone" DNS filter).
- A direct TCP connection attempt to `202.56.230.30:443` **times out** (no SYN-ACK) —
  i.e., traffic to that address is dropped, not merely redirected to a landing page.
- A raw `curl` POST of an MCP `initialize` JSON-RPC request to the endpoint also timed out
  with no response at all (curl exit code 28 — connection timeout).

This matches the pattern of TikTok's domains being blocked at the ISP/network level in
India (TikTok has been banned for public use in India since 2020). The MCP server itself
was never reachable, so Claude Code's HTTP MCP client could not even complete the initial
protocol handshake, let alone reach an OAuth/login redirect.

**This is a network/ISP-level restriction on the current connection, not a Claude Code
or MCP configuration problem.** No amount of reconfiguring the MCP entry will fix it from
this network. Resolving it would require connecting from a network where
`business-api.tiktok.com` is reachable — that's a decision for you to make, and outside
what this assistant will do on your behalf (it isn't something to bypass unilaterally).

## 4. Authentication / authorization flow (expected, per TikTok's docs — NOT YET REACHED)

Because the handshake never completed, Claude Code never got far enough to trigger
TikTok's actual auth flow. Per TikTok's own MCP documentation, the expected flow for this
endpoint is:

1. Claude Code (as MCP client) opens a connection to the `open_mcp` endpoint.
2. The server responds with an OAuth authorization requirement.
3. Claude Code opens your default browser to a TikTok for Business **login/consent**
   page (you log in with your TikTok for Business / TikTok Ads Manager account and
   grant the Business Centers / ad accounts you want to expose).
4. TikTok redirects back to a local callback Claude Code is listening on, completing the
   OAuth token exchange — handled entirely by Claude Code and TikTok's identity servers.
5. No manual API key, developer app, client secret, or long-lived token is created or
   entered by you or by Claude Code at any point in this flow.

**If/when connectivity is restored**, re-run:

```
claude mcp list
```

If it still shows "Failed to connect," re-add via `claude mcp add` as above, then open a
Claude Code conversation and reference a TikTok tool — Claude Code will trigger the
browser login step automatically at that point. **I will stop and tell you exactly what
to click** when that happens; nothing further will be done automatically on your TikTok
account.

## 5. Available tools

**Unknown — could not be inspected.** The server connection never succeeded, so no tool
list (`tools/list`) response was ever received. Nothing below is observed; it is only
what TikTok's public documentation describes as being in scope for this MCP server:

| Requested area | Status |
|---|---|
| Business Centers | Not inspected — connection failed |
| Advertisers / ad accounts | Not inspected — connection failed |
| Campaigns (create/edit/pause/resume/status) | Not inspected — connection failed |
| Ad groups | Not inspected — connection failed |
| Ads / Creatives / Spark Ads | Not inspected — connection failed |
| Reporting | Not inspected — connection failed |
| Budget | Not inspected — connection failed |
| Targeting / GEO targeting | Not inspected — connection failed |
| Account/campaign approval status | Not inspected — connection failed |

This section must be re-run once the MCP connection succeeds (`claude mcp get
tiktok-business` showing "Connected"), using a tool-listing pass to enumerate real tool
names before anything in this table can be filled in.

## 6. Important limitations observed so far

- The MCP entry is registered but **not functional** on this network/connection.
- No TikTok credentials of any kind were created, requested, or entered — consistent
  with your requirement.
- The failure is a **network reachability** issue (DNS redirect + dropped TCP connection
  to the resolved IP), occurring before any TikTok-side OAuth prompt, and before any MCP
  tool schema could be retrieved.
- Because this is network-level, it will reproduce for *any* client (not just Claude
  Code) on this same network/connection until that's resolved.

## 7. Can this MCP connection later be used by your own web application, independently of Claude Code?

Short answer: **not directly — it's not that kind of connection.**

- This MCP server entry lives in Claude Code's local config and is a connection between
  *this Claude Code CLI instance* and TikTok's MCP endpoint, authenticated via an
  OAuth session tied to Claude Code's own OAuth client / callback handling.
- A separate web application is a different OAuth client. It would need its own
  integration with TikTok for Business — either its own MCP client implementation
  talking to the same `open_mcp` endpoint with its own OAuth registration/consent, or
  (if your app isn't an MCP client) TikTok's standard Business API under the hood, which
  TikTok's MCP server itself is almost certainly a managed wrapper around.
- What *can* carry over: whichever TikTok Business Center / ad accounts you grant
  consent to during the OAuth step are account-level grants on TikTok's side, not
  secrets tied to Claude Code — so the *access grant* concept is reusable, but the
  *connection/session* Claude Code establishes is not something your web app can call
  into or "borrow."
- Practically: Claude Code here is best suited as an operator/assistant tool for TikTok
  Ads tasks you ask it to do in this session, not as a backend service your own
  application calls over the network.

This will be re-verified once the MCP connection is live, since TikTok's actual
documentation page should state explicitly whether third-party server-to-server
consumption of this exact `open_mcp` endpoint is supported.

---

**Status summary: configuration done, connection currently blocked at the network level,
no credentials created, no browser OAuth step reached yet, no tools inspected, no
application code touched.**
