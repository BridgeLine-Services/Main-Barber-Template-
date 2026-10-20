# Environment Configuration Reference

This document details all environment variables for the Next.js barbershop application. Variables are parsed and validated across `src/lib/app-config.ts`, `src/lib/auth.ts`, `scripts/vercel-build.mjs`, and `package.json`.

## Public Client Variables vs. Server Secrets
- **Public Client Variables (`NEXT_PUBLIC_*`)**: Embedded into client-side JS bundles during Next.js build compilation. Accessible to browsers. Must **never** store secret keys or database credentials.
- **Server-Only Secrets**: Evaluated solely within Node.js runtime environments (API routes and server components). Kept strictly in provider secret stores (e.g. Vercel Environment Variables).
- **Template Safety**: `.env.example` contains variable names and non-sensitive example placeholders only — never real secrets or production credentials.

## Known Production Deployment Facts
- **Active Production Deployment**: `dpl_4piMHZpseeh6Pj5Afxk6ShSWh7U6` (Status: `READY`).
- **Database Connection**: Connects to Neon PostgreSQL instance database named `neondb`.
- **Owner Registration Policy**: `OWNER_REGISTRATION_MODE` is unset in production, defaulting to `'onboarding'`.

## Environment Variable Matrix

| Variable Name | Purpose | Secret / Public | Required / Optional | Environments & Build-Time Status | Value Origin | Provider-Side Config Required | How to Validate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for Prisma ORM & migrations | Secret (Server) | Required | Dev/Preview/Prod (**Build-time validated** by `vercel-build.mjs`) | Neon PostgreSQL DB instance | Neon project setup (`neondb`) | `node scripts/vercel-build.mjs --validate-only` & `npm run db:doctor` |
| `NEXTAUTH_SECRET` | Secret key for signing NextAuth JWT session tokens | Secret (Server) | Required | Dev/Preview/Prod (**Build-time validated** by `vercel-build.mjs`) | `openssl rand -base64 32` | Vercel Environment Variables | `npm run test:vercel-build` & NextAuth login |
| `NEXTAUTH_URL` | Canonical NextAuth redirect base URL | Server / Public | Required | Dev/Preview/Prod (**Build-time validated**; falls back to `NEXT_PUBLIC_APP_URL`) | Deployment host domain | Vercel Domain configuration | Login flow redirect inspection |
| `NEXT_PUBLIC_APP_URL` | Canonical public app URL for SEO, sitemaps, & client links | Public | Required | Dev/Preview/Prod (**Build-time validated**; falls back to `VERCEL_URL`) | Vercel / Custom domain | Vercel DNS & Domain settings | Browser navigation & sitemap audit |
| `NEXT_PUBLIC_APP_NAME` | Public barbershop name displayed across site UI | Public | Optional | Dev/Preview/Prod (Runtime) | Barbershop brand name | Vercel Environment Variables | UI header & document title inspection |
| `NEXT_PUBLIC_SITE_URL` | Fallback SEO base URL when `NEXT_PUBLIC_APP_URL` is omitted | Public | Optional | Dev/Preview/Prod (Runtime) | Barbershop domain URL | Vercel Environment Variables | Sitemap inspection |
| `APP_MODE` | Application mode switch (`production` vs `demo`) | Server / Public | Optional (Default: `production`) | Dev (`demo`), Preview/Prod (`production`) (Runtime) | Deployment config | Vercel Environment Variables | `appConfig.mode` log & weak password block |
| `TENANT_MODE` | Public tenant resolution mode: `multi` resolves the request hostname to `Business.slug`; `single` requires `SINGLE_BUSINESS_ID`. Unset = zero-config single-shop behavior (host→slug, then `SINGLE_BUSINESS_ID`, then the sole business when the deployment has exactly one) | Server | Optional | Dev/Preview/Prod (Runtime) | Deployment config | Vercel Environment Variables | Separate from `APP_MODE` (production|demo); invalid explicit values fail closed |\n| `SINGLE_BUSINESS_ID` | Explicit binding when `TENANT_MODE=single` | Server | Required for single mode | Dev/Preview/Prod (Runtime) | Database `Business.id` UUID | Vercel Environment Variables | Must match an existing business; in strict single mode there is no sole-business fallback |
| `OWNER_REGISTRATION_MODE` | First-owner registration policy (`onboarding`/`invite_only`/`disabled`) | Server | Optional (Default: `onboarding`) | Dev/Preview/Prod (Runtime) | Operator policy config | Vercel Environment Variables (unset in prod defaults to `onboarding`) | Access check on `/login` first-owner signup |
| `OWNER_PROVISIONING_TOKEN` | Auth secret for operator provisioning API (`POST /api/auth/register-owner`) | Secret (Server) | Optional | Dev/Preview/Prod (Runtime) | Operator random secret | Vercel Environment Variables | Request header `x-provisioning-token` match |
| `BLOB_READ_WRITE_TOKEN` | Storage access token for Vercel Blob media uploads | Secret (Server) | Required for Media | Dev/Preview/Prod (Runtime) | Vercel Blob store setup | Vercel Storage -> Blob instance | Dashboard photo gallery upload test |
| `EMAIL_ENABLED` | Toggle switch to enable transactional email dispatch | Server | Optional (Default: `false`) | Dev/Preview/Prod (Runtime) | Operator config | Set `true` with all `SMTP_*` vars | `npm run test:optional-integrations` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | Credentials & host parameters for outbound SMTP email | Secret / Server | Optional (Req when `EMAIL_ENABLED=true`) | Dev/Preview/Prod (Runtime) | SMTP service provider | SMTP account & SPF/DKIM DNS for `SMTP_FROM` | `npm run test:optional-integrations` & password reset test |
| `SMS_ENABLED` / `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Credentials for Twilio SMS notifications | Secret (Server) | Optional (Req when `SMS_ENABLED=true`) | Dev/Preview/Prod (Runtime) | Twilio Console | Twilio phone number & account SID | `npm run test:optional-integrations` |
| `GOOGLE_ENABLED` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GBP_*` | Google Business Profile & Google OAuth credentials | Secret (Server) | Optional (Req when `GOOGLE_ENABLED=true`) | Dev/Preview/Prod (Runtime) | Google Cloud Console | OAuth app setup & GBP API authorization | `npm run test:optional-integrations` |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe API credentials for card payments, memberships, & gift cards | `STRIPE_PUBLISHABLE_KEY` Public; others Secret | Optional | Dev/Preview/Prod (Runtime) | Stripe Dashboard | Stripe account API keys & webhook endpoint | `npm run test:optional-integrations` & checkout test |
| `REMINDERS_ENABLED` / `CRON_SECRET` | Cron secret authorizing Vercel Cron reminder executions | Secret (Server) | Optional (Req when `REMINDERS_ENABLED=true`) | Dev/Preview/Prod (Runtime) | Generated random secret | Vercel Cron authorization header | Cron route POST with `Authorization: Bearer <CRON_SECRET>` |
| `OBSERVABILITY_WEBHOOK_URL` | Collector URL for structured error reporting (Sentry/Better Stack) | Secret (Server) | Optional (Unset = no-op) | Dev/Preview/Prod (Runtime) | Monitoring provider | Webhook receiver endpoint | Structured error event emission check |
| `ENABLE_E2E_TESTS` | Toggle test endpoints for automated Playwright E2E suites | Server | Optional (Must be `false` in Prod) | E2E Test Environments (Runtime) | Test framework config | Keep unset / `false` in client production | Playwright test execution |
