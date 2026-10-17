# 🚀 Deploying to Vercel

This deployment follows the canonical lifecycle in
[docs/ARCHITECTURE_CONSTITUTION.md](docs/ARCHITECTURE_CONSTITUTION.md):
copy the template, deploy, create the database, configure environment
variables, create the owner, complete onboarding, test, and then attach the
domain. Do not edit application source to configure a shop.

This guide walks you through deploying the Barber Booking System to Vercel.

---

## Prerequisites

1. A [Vercel account](https://vercel.com/signup)
2. A [PostgreSQL database](https://vercel.com/docs/storage/vercel-postgres) (Vercel Postgres, Neon, Supabase, Railway, or any external PostgreSQL instance)
3. An SMTP email provider only if email notifications or password recovery will be enabled

> **Commercial deployment:** Vercel Hobby is restricted to personal,
> non-commercial use. A shop booking site or a deployment created/hosted for
> a client is commercial use; select a provider/plan whose terms allow that
> use before launch. See [Vercel's commercial-usage guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).
> Hobby cron jobs must run no more than once per day. This template keeps all
> scheduled jobs daily. Review-request emails may arrive up to 24 hours after
> their configured delay; the membership period processor does not create or
> simulate renewal charges.

---

## Step 1: Create the Project on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `BridgeLine-Services/Main-Barber-Template-` repository
3. Vercel will auto-detect Next.js — keep the default framework preset

## Step 2: Set Environment Variables

In the Vercel dashboard, go to **Settings → Environment Variables** and add:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` | Your PostgreSQL connection string |
| `NEXTAUTH_URL` | `https://your-domain.vercel.app` | Your Vercel deployment URL (no trailing slash) |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` | Used to sign JWT tokens |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.vercel.app` | Canonical public URL |
| `NEXT_PUBLIC_APP_NAME` | `Your Barbershop` | Public application name |
| `EMAIL_ENABLED` | `false` | Set `true` only with all `SMTP_*` values below |
| `SMS_ENABLED` | `false` | Set `true` only with all `TWILIO_*` values below |
| `GOOGLE_ENABLED` | `false` | Set `true` only with Google credentials |
| `REMINDERS_ENABLED` | `false` | Set `true` only with `CRON_SECRET` |
| `CRON_SECRET` | Run `openssl rand -base64 32` | Required to authorize scheduled jobs |
| `STRIPE_SECRET_KEY` | unset | Required together with the publishable and webhook keys to enable online payments |
| `STRIPE_PUBLISHABLE_KEY` | unset | Public Stripe key used by browser checkout |
| `STRIPE_WEBHOOK_SECRET` | unset | Required to verify payment settlement webhooks |
| `OBSERVABILITY_WEBHOOK_URL` | unset | Set to a JSON webhook collector to enable active error reporting (no-op when unset) |
| `SMTP_HOST` | `smtp.gmail.com` | Your SMTP host |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | `your-email@gmail.com` | SMTP username |
| `SMTP_PASS` | `your-app-password` | SMTP password (App Password for Gmail) |
| `SMTP_FROM` | `noreply@yourbarbershop.com` | From email address |
| `NEXT_PUBLIC_APP_NAME` | `Your Barbershop` | Public app name (set per customer deployment) |
| `SINGLE_BUSINESS_ID` | *(recommended)* | The database ID of this deployment's business. Set after onboarding so the public website resolves even when the hostname doesn't match the business slug. If unset, the site falls back to the sole business when exactly one exists. |
| `APP_MODE` | *(unset)* or `production` | `demo` enables the demo dataset — **never use `demo` on a customer deployment** |
| `OWNER_REGISTRATION_MODE` | `onboarding` | `onboarding` = permit the initial public owner signup, then customer signup remains available · `invite_only` = all public signup is closed; invited staff use their invitation link · `disabled` = all public registration is closed. Unknown values fail safe to `disabled`. |

> ⚠️ **Important:** Set `NEXTAUTH_URL` to your final production URL once you have a custom domain. Otherwise use the Vercel-generated URL.
>
> ⚠️ **`NEXTAUTH_SECRET` is mandatory in production** — the app refuses to boot with a fallback secret. Also note the app **never falls back to demo data**: every shop's name, branding, services, barbers, hours, and policies come from the database.

### After deployment: first owner setup

1. Apply migrations: `npx prisma migrate deploy` (run locally against your production `DATABASE_URL`, or from the Vercel CLI).
2. With `OWNER_REGISTRATION_MODE=onboarding`, the first owner creates their account at `/login` (no seed required) and is routed into the onboarding wizard: Business Basics → Branding → Services → Team → Booking Settings → Review.
3. Setup can only be completed when the shop has a name, slug, timezone, at least one active service, one active barber, and weekly schedules — enforced server-side on the Review step.
4. After completing setup, the owner lands in `/dashboard`; services, barbers, branding, and settings remain fully editable.
5. Password recovery is self-service at `/forgot-password` (tokens expire in 1 hour, single-use, stored hashed). It requires the `SMTP_*` variables above when email is enabled.
6. Open **Dashboard → Factory Status** and resolve every required failure before launch. Disabled optional integrations are acceptable; enabled integrations with missing credentials are not.

## Step 3: Deploy

1. Click **Deploy**
2. Vercel runs a configuration preflight before installing dependencies.
   The install command is `npm ci`, so a stale or inconsistent lockfile fails
   instead of being rewritten.
3. The build command runs `prisma migrate deploy`, generates Prisma Client,
   then runs `next build`. Migrations must succeed before the deployment can
   become ready; permanent authentication, configuration, schema, or migration
   errors fail without retry. Only bounded database-connectivity and migration
   lock-timeout failures are retried.
4. Wait for the deployment to reach **Ready** and review its build output.

## Step 4: Verify the Production Database

The Vercel build applies committed migrations using the database URL configured
in the Vercel environment. Do not separately run the same migration as an
uncoordinated manual step. Review migration SQL before deployment, keep
production migrations backward-compatible with the currently deployed code,
and confirm `prisma migrate deploy` completed in the deployment build log.

Production database credentials belong only in the hosting provider's secret
environment; never expose them to pull-request workflows or commit them.

Do not use `prisma db push` or `npm run db:seed` for a customer production
database. Those commands are for local development only.

## Step 5: Set Up a Custom Domain (Optional)

1. In Vercel: **Settings → Domains**
2. Add your domain (e.g., `book.yourbarbershop.com`)
3. Update your DNS records as instructed
4. Update the `NEXTAUTH_URL` environment variable to match

---

## Database Provider Recommendations

| Provider | Free Tier | Notes |
|---|---|---|
| [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) | ✅ | Native integration, easiest setup |
| [Neon](https://neon.tech) | ✅ | Serverless Postgres, great cold-start |
| [Supabase](https://supabase.com) | ✅ | Postgres + extras (auth, storage) |
| [Railway](https://railway.app) | ✅ | Simple Postgres, good for small apps |

---

## Post-Deployment Checklist

- [ ] Reviewed migrations applied (`npx prisma migrate deploy`)
- [ ] Owner account created at `/login`
- [ ] Existing onboarding completed
- [ ] **Dashboard → Launch Console** reports the next action is clear
- [ ] Customer booking flow works end-to-end
- [ ] `NEXTAUTH_URL` matches production domain
- [ ] Email notifications sent on booking
- [ ] SEO structured data validated (Google Rich Results Test)
- [ ] SSL/HTTPS active (automatic on Vercel)

## Local demo workflow

For local evaluation only, set `APP_MODE=demo`, run the seed script, and use
the demo dataset. Demo credentials and seeded appointments must never be used
in a customer deployment.

---

## Troubleshooting

### Build fails: "Prisma Client not generated"
The build runs `prisma generate` after migrations and before `next build`.
Check the Prisma generation output and confirm that dependency installation
completed with `npm ci`.

### Build fails during migration
- `Configuration error`: add the named database/auth/public URL variables to
  the Vercel project's environment without sharing their values in logs.
- `authentication` or `connectivity`: verify the database credential and
  network access in Vercel; authentication errors are not retried.
- `schema baseline mismatch`, `migration history`, or SQL failure: inspect
  the recorded migration and database state, then prepare a reviewed,
  forward-only migration. Do not use `prisma db push` or skip migrations.
- A transient connection or Prisma advisory-lock timeout is retried at most
  three times with short backoff (17 seconds total maximum wait).

### 500 error: "Database connection failed"
- Verify `DATABASE_URL` is set in Vercel env vars
- Check that your database allows connections from Vercel's IP ranges
- For Neon/Supabase, ensure the connection pooler URL is used

### Login redirects to error page
- Ensure `NEXTAUTH_SECRET` is set
- Verify `NEXTAUTH_URL` matches your deployment URL exactly (no trailing slash)
- Check browser console for cookie/domain mismatch errors
