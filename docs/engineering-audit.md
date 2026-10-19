# Baseline Engineering Audit

## Current architecture and technology stack
- **Framework:** Next.js 16.3.6 (App Router, React 19.3.0).
- **Language:** TypeScript 5.5.4.
- **Package Manager:** npm (package-lock.json v3 lockfile).
- **Entry Points & Routing:** Next.js App Router (`src/app`), organized into route groups `(auth)`, `(customer)`, `(dashboard)`, `(standalone)`, `platform`, `onboarding`, and API route handlers under `src/app/api`.
- **Auth Provider:** NextAuth.js v4.24.7 Credentials provider using `bcryptjs` password hashing with JWT sessions (strategy: `jwt` in src/lib/auth.ts; `@auth/prisma-adapter` is installed but unused).
- **Database:** Neon PostgreSQL via Prisma ORM (`@prisma/client` 6.19.3).
- **Deployment:** Vercel serverless platform, configured via `vercel.json` and executed via custom build wrapper `scripts/vercel-build.mjs`.

## Confirmed working functionality
- **Source Code Verification:** File paths verified intact for core functionality including `src/app/login/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/(dashboard)/dashboard/layout.tsx`, `src/lib/auth.ts`, `scripts/vercel-build.mjs`, and `prisma/schema.prisma`.
- **GitHub CI Pipeline:** Workflows in `.github/workflows/ci.yml` and `architecture.yml` run 'Validate template', 'E2E browser tests' (Playwright chromium), and 'Validate architecture constitution', all passing on commit `4928f3f`.
- **Production Deployment:** Production Vercel deployment `dpl_4piMHZpseeh6Pj5Afxk6ShSWh7U6` is READY at `https://main-barber-template.vercel.app` serving HTTP 200.
- **Live Endpoint Probes:** Live probes confirmed functional endpoint behavior:
  - `/api/auth/providers` returns valid NextAuth provider schema.
  - `/api/auth/csrf` generates valid CSRF tokens.
  - `/api/auth/callback/credentials` returns HTTP 401 on invalid credentials.
  - `/api/auth/register` validates input schemas using Zod.
  - `/dashboard` redirects unauthenticated users to `/login`.

## Broken functionality and reproducible defects
- **Defect Description:** The ONLY confirmed production defect is that no account with `role = OWNER` currently exists in the production database. Consequently, owner sign-in fails with 'Invalid email or password'.
- **Observed Behavior:** The `/login` page server-renders 'Create the initial owner account or sign in to continue setup' because `prisma.user.findFirst({ where: { role: 'OWNER' } })` returns null.
- **Resolution:** First Sign-Up via the onboarding flow promotes the first registered account to OWNER, or the token-gated `/api/auth/register-owner` endpoint can be invoked with `OWNER_PROVISIONING_TOKEN` header.
- **Classification:** This is intended initial provisioning behavior, not a code bug.

## Missing or incomplete functionality
- **Email Delivery Provider:** Email sending uses Nodemailer over SMTP (`src/lib/notifications.ts`), active only when `EMAIL_ENABLED=true` and SMTP parameters (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) are set. No third-party API SDK (e.g. Resend, SendGrid) is installed; when unconfigured, email sending fails or is logged as unconfigured.
- **SMS Provider:** SMS notifications use Twilio REST API (`src/lib/twilio.ts`) directly without npm dependencies, enabled via `SMS_ENABLED=true`.
- **Marketing & Waitlist:** Audience segmentation (`src/lib/marketing.ts`) and waitlist notifications (`src/lib/notifications.ts`) are implemented; dispatch depends on cron execution.
- **Review Requests:** Review automation (`src/lib/review-requests.ts`) features a durable queue, backoff, and idempotency, but requires cron trigger `/api/cron/review-requests`.
- **Payments:** In-person payments (`paymentInPerson=true`) are fully supported by default (`src/lib/payments/providers/in-person.ts`). Stripe card payments (`src/lib/payments/providers/stripe.ts`) require `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- **Audit Logs & Analytics:** Audit log queries (`src/app/api/dashboard/audit-logs/route.ts`) and Analytics calculations (`src/lib/analytics.ts`) with Luxon timezone support are complete.
- **Onboarding Wizard:** Persistent multi-step onboarding (`src/lib/onboarding.ts`, `src/app/onboarding`) tracking completion via `Business.onboardingCompleted` is fully implemented.

## Authentication and authorization findings
- **Credentials & Password Hashing:** NextAuth v4 Credentials provider uses `bcryptjs` with salt cost factor 10 (`src/lib/auth.ts`, `src/app/api/auth/register/route.ts`).
- **Brute-Force Rate Limiting:** Sliding-window rate limiter (`src/lib/rate-limit.ts`) protects registration (`/api/auth/register`, `/api/auth/register-owner`), password reset, and authentication endpoints.
- **Token-Gated Provisioning:** `/api/auth/register-owner` provisions owner accounts using constant-time token comparison (`timingSafeEqual` in `src/app/api/auth/register-owner/route.ts`) against `OWNER_PROVISIONING_TOKEN`.
- **Staff Invitation Lifecycle:** Staff invitations (`StaffInvitation` model) issue tokenized links that enforce password changes on initial login via `mustChangePassword`.
- **Dashboard Access Gates:** `checkDashboardAccess` (`src/lib/onboarding.ts`) and `src/app/(dashboard)/dashboard/layout.tsx` re-verify user role and onboarding status from Prisma on each request to prevent stale session drift.
- **Role Router:** Post-login router at `/auth/redirect` (`src/app/auth/redirect/page.tsx`) routes users server-side based on `user.role` (CUSTOMER -> `/portal`, PLATFORM_OWNER -> `/platform`, OWNER/BUSINESS_ADMIN/BARBER -> `/dashboard`).

## Environment and deployment dependencies
- **Core Required Variables:** `DATABASE_URL` (or `NEON_POSTGRES_PRISMA_URL`), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` (with fallback `NEXT_PUBLIC_SITE_URL`), `NEXT_PUBLIC_APP_NAME`, `APP_MODE`.
- **Owner & Tenant Provisioning:** `SINGLE_BUSINESS_ID`, `OWNER_REGISTRATION_MODE` (`onboarding` | `invite_only` | `disabled`), `OWNER_PROVISIONING_TOKEN`, `RATE_LIMIT_REGISTER_MAX`.
- **Optional Feature Variables:**
  - Email/SMTP: `EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`, `CONTACT_EMAIL`.
  - SMS: `SMS_ENABLED`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
  - Payments: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
  - Storage & Third-Party: `BLOB_READ_WRITE_TOKEN`, `GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GBP_ACCESS_TOKEN`, `GBP_REFRESH_TOKEN`, `GBP_ACCOUNT_ID`, `GBP_LOCATION_ID`, `REMINDERS_ENABLED`, `CRON_SECRET`, `OBSERVABILITY_WEBHOOK_URL`, `ENABLE_E2E_TESTS`.

## Existing test results
- **Build Script Unit Tests:** 24/24 unit tests pass in `tests/vercel-build.test.mjs` via `npm run test:vercel-build`.
- **Architecture Check:** `npm run architecture:check` (`scripts/check-template-architecture.mjs`) verified 547 source files with 0 violations.
- **TypeScript Typecheck:** `npm run typecheck` (`tsc --noEmit`) passed with 0 errors.
- **CI Pipeline:** GitHub Actions workflow `ci.yml` passed 'Validate template', 'Validate architecture constitution', and Playwright 'E2E browser tests' on commit `4928f3f`.

## Security and data-integrity concerns
- **Rate Limiting:** Sliding-window rate limiter (`src/lib/rate-limit.ts`) prevents brute-force credential and registration attacks.
- **Password Policy:** Zod schema `passwordPolicySchema` (`src/lib/validation.ts`) enforces complexity rules (length, uppercase, lowercase, numbers/symbols).
- **Timing-Safe Token Comparison:** Crypto `timingSafeEqual` prevents side-channel timing attacks when validating `OWNER_PROVISIONING_TOKEN` in `src/app/api/auth/register-owner/route.ts`.
- **Transactional Advisory Locks:** PostgreSQL advisory lock `pg_advisory_xact_lock(hashtext('owner-registration'))` in `src/app/api/auth/register/route.ts` prevents race conditions during first-owner creation.
- **Tenant Isolation:** All business-scoped Prisma models specify `businessId`. API route handlers explicitly scope database queries by `businessId`, verified via `src/lib/tenant-audit.ts` (`TENANT_AUDIT` list) and `tests/tenant-isolation.test.ts`.

## A prioritized remediation plan
- **P0: Production Owner Account Provisioning**
  - *Action:* Provision initial owner account in production by invoking POST `/api/auth/register-owner` with `x-provisioning-token: <OWNER_PROVISIONING_TOKEN>` header or completing first sign-up via public onboarding mode.
  - *Evidence:* Production login currently fails due to zero `role = OWNER` records in the production database (`src/app/login/page.tsx`).
- **P1: Email & Notification Delivery Configuration**
  - *Action:* Set `EMAIL_ENABLED=true`, configure valid SMTP server credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), and set up external cron triggers for `/api/cron/review-requests`.
  - *Evidence:* Email notifications default to `EMAIL_ENABLED=false` in `.env.example` and fail if SMTP host/auth values are missing (`src/lib/notifications.ts`).
- **P2: Template Reusability Polish**
  - *Action:* Streamline deployment scripts to automate environment variable validation during provisioning and enhance client documentation for optional integrations (Stripe, Google Business Profile).
  - *Evidence:* `src/lib/env-check.ts` provides runtime checks, but documentation and setup tooling can be further unified for client onboarding.
