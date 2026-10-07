# TikTok Ads Panel

A TikTok Ads control panel that talks to TikTok only through the official
TikTok for Business MCP server. No TikTok Marketing API integration, developer app or
API key is used.

- Next.js (App Router) + TypeScript, built for Vercel
- PostgreSQL through Prisma
- Server-side MCP client; the browser never sees a TikTok token

See `docs/phase-2-architecture.md` for the design and for what has and has not been
verified against live TikTok, and `docs/phase-2-test-plan.md` for the manual test plan.

## Setup

1. Copy `.env.example` to `.env` and fill it in. Generate the two secrets with
   `openssl rand -base64 32`.
2. `npm install`
3. `npm run db:migrate` (applies `prisma/migrations` to the database)
4. `npm run dev`

The machine running the app must be able to reach `business-api.tiktok.com`.

## Deploying to Vercel

1. Create a PostgreSQL database (Neon or Vercel Postgres). Use the pooled connection
   string for `DATABASE_URL` and the direct one for `DIRECT_URL`.
2. Set `APP_URL` to the deployment's public URL, plus `TOKEN_ENCRYPTION_KEY` and
   `SESSION_SECRET`.
3. Run `npm run db:migrate` against the database once.
4. Deploy. Register a user, then open Settings → Connect TikTok.
5. Open Settings → Diagnostics and run the read-only checks against an ad account.

Every create, edit, pause and resume is refused by the server unless
`TIKTOK_WRITES_ENABLED` is exactly `true`. Leave it unset until the diagnostics results
have been checked against `docs/tiktok-campaign-capability-matrix.md`.

The TikTok sign-in callback is `${APP_URL}/api/tiktok/oauth/callback`, and the app's
client registration is stored per callback URL, so each deployment domain registers
itself the first time someone connects.

## Checks

```
npm run typecheck
npm run lint
npm test
npm run build
```

Tests use an in-memory stand-in for TikTok and never make real TikTok calls.
