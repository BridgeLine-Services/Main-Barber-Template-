# Production Deployment Checklist

## ✅ Completed (Code-Side)

### S28: Booking Flow Bugs
- "First Available" state properly resolves to specific barber + date + time
- "Any Barber" barberId passthrough works correctly
- businessId="" issue resolved (server-side tenant resolution)

### S29: Demo Business Information
- All demo PII replaced with template-appropriate placeholders
- Seed script uses environment variables with sensible defaults
- Setup wizard at `/setup` for real data entry

### S30: Database Connection Verification
- Build made resilient: `prisma db push` won't fail the build if DB isn't connected yet
- Setup wizard checks DB status and guides user
- Production readiness requires an explicit `NEXTAUTH_SECRET`; no production fallback secret is used

### S31: E2E Test Infrastructure
- `/api/test/e2e-booking` endpoint: full booking lifecycle test (owner-only)
- Tests: create → verify → double-booking check → cancel → cleanup

### S32: Timezone Handling
- All time parsing uses Luxon with business timezone (not server UTC)
- `localTimeToUTCFromYMD()` and `dayBoundsFromYMD()` used consistently
- Availability checks use business timezone for day boundaries

### S33: API Tenant Isolation
- All dashboard routes use `requireOwner` / `requireStaff` auth checks
- All routes resolve `businessId` server-side (never from client)
- Old unauthenticated `/api/appointments` routes return 410 Gone (BOLA patched)
- Portal lookup resolves businessId server-side (was accepting from request body)

### S36: Date Selector Availability UX
- Calendar shows visual indicators: green dots for available days
- Strikethrough + opacity for fully booked days
- Legend explains indicators
- Loading spinner while fetching availability

### S37: Mobile/Booking UX Polish
- Phone auto-format: `(555) 000-0000` as you type
- Email validation with real-time feedback
- State persistence via localStorage (service/barber/date/time saved on refresh)
- Customer PII deliberately NOT persisted (privacy on shared devices)
- URL params for pre-selection (`?serviceId=X&barberId=Y`)

### S38: Security Production Pass
- Rate limiting on all public endpoints (booking, availability, lookup, auth, contact, setup)
- Zod validation on all API inputs
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- Middleware auth gate on `/dashboard` and `/api/dashboard/*`
- Cron endpoint fails closed if CRON_SECRET not set
- Idempotency keys on booking to prevent double-booking

## ⚠️ Action Required (Vercel Dashboard)

### Step 1: Create Database
1. Vercel → your project → **Storage** tab
2. Click **Create Database** → Postgres
3. Vercel auto-injects `DATABASE_URL` into environment variables

### Step 2: Set Environment Variables
In Vercel → **Settings → Environment Variables**, add these for Production:

| Variable | Value | Required? |
|---|---|---|
| `DATABASE_URL` | (auto-set by Vercel Postgres) | ✅ Yes |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` | ✅ Yes |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` | ✅ Yes |
| `CRON_SECRET` | Run: `openssl rand -base64 32` | ✅ Yes (for reminders) |
| `SMTP_HOST` | `smtp.gmail.com` | For email |
| `SMTP_PORT` | `587` | For email |
| `SMTP_USER` | your email | For email |
| `SMTP_PASS` | app password | For email |
| `SMTP_FROM` | `noreply@yourdomain.com` | For email |
| `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` | For SEO/sitemap |
| `TWILIO_ACCOUNT_SID` | (from Twilio) | For SMS (S34) |
| `TWILIO_AUTH_TOKEN` | (from Twilio) | For SMS (S34) |
| `TWILIO_PHONE_NUMBER` | `+1xxxxxxxxxx` | For SMS (S34) |

### Step 3: Deploy
1. Vercel → **Deployments** → latest → **Redeploy**
2. Once deployed, visit `https://your-app.vercel.app/setup`
3. Fill in your shop details and create admin account
4. Log in at `/login` with your admin credentials

## ⏳ Pending (External Service Setup Required)

### S34: SMS Production Configuration (Twilio)
- Requires Twilio account setup
- Code is ready: `src/lib/notifications.ts` has SMS sending logic
- Just needs Twilio env vars set in Vercel

### S35: Google Business Profile
- Requires Google OAuth setup
- Code is ready: dashboard has GBP integration routes
- Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` env vars

### S39: Production Release Candidate Verification
- Final end-to-end testing on live deployment
- Requires DB connected + env vars set

## 🔒 Known Security Advisories

### Next.js 14.2.35 (6 high-severity CVEs)
- DoS via Image Optimizer, Server Components
- XSS via CSP nonces, beforeInteractive scripts
- Cache poisoning via RSC cache-busting
- HTTP request smuggling in rewrites
- SSRF via WebSocket upgrades
- **Fix**: Upgrade to Next.js 16.3.1+ (major migration, requires thorough testing)
- **Risk**: Low for a single-tenant booking site with no user-uploaded images
- **Recommendation**: Plan upgrade after initial production launch

### glob (dev dependency only)
- Command injection via eslint-config-next
- **Risk**: None in production (dev dependency, not shipped)
