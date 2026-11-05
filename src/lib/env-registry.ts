// ============================================================================
// The one environment contract.
//
// Every application-owned environment variable is declared here exactly once,
// with what it is, who needs it, when it is required, how to validate it and how
// to fix it. The runtime checker, the `env:check`/`env:doctor` CLIs, the
// pre-registration preflight and the setup wizard all read THIS file, so they
// cannot drift into contradicting each other — which is exactly what had
// happened: Redis was mandatory in production and absent from the inventory,
// while the retired provisioning token still sat in it.
//
// Rules encoded here:
//   • A disabled integration never blocks a launch.
//   • Presence is not configuration: whitespace is missing, a bad URL is invalid.
//   • Secrets are described, never printed.
// ============================================================================

export type EnvCategory =
  | 'CORE' | 'SECURITY' | 'DATABASE' | 'STORAGE' | 'PAYMENTS' | 'EMAIL' | 'SMS'
  | 'GOOGLE' | 'SCHEDULED_TASKS' | 'OBSERVABILITY' | 'TENANT_CONFIGURATION'
  | 'INTERNAL' | 'DEVELOPMENT_ONLY' | 'PLATFORM_MANAGED' | 'RETIRED'

export type EnvName = 'development' | 'preview' | 'production' | 'test'

/** Any environment-shaped bag: process.env, a file's contents, or a test fixture. */
export type EnvSource = Record<string, string | undefined>

export type FeatureName =
  | 'email' | 'sms' | 'google' | 'reminders' | 'observability'
  | 'payments' | 'storage' | 'rateLimit' | 'twoFactorPolicy'

export type EnvStatus =
  | 'CONFIGURED' | 'MISSING' | 'INVALID' | 'UNREACHABLE' | 'VERIFIED'
  | 'NOT_REQUIRED' | 'DISABLED' | 'WARNING' | 'PLATFORM_MANAGED' | 'RETIRED'

export interface EnvVarSpec {
  name: string
  description: string
  category: EnvCategory
  /** Never print the value, only whether it is present and plausible. */
  secret: boolean
  /** Value is compiled into client JavaScript via NEXT_PUBLIC_*. Never a secret. */
  public: boolean
  /** Injected by the hosting platform; operators must not be asked for it. */
  platformManaged: boolean
  /** Environments where this is required unless its feature is disabled. */
  requiredIn: EnvName[]
  requiredAt: 'build' | 'runtime'
  /** Required only while this feature is switched on. */
  feature?: FeatureName
  /** Alternate names the build accepts for the same value, in precedence order. */
  aliases?: string[]
  /** Values this variable can be derived from when it is absent. */
  fallbackFrom?: string[]
  format?: 'url' | 'postgres-url' | 'secret' | 'email' | 'phone' | 'boolean' | 'number' | 'path' | 'enum'
  minLength?: number
  enumValues?: string[]
  connectivityTestable: boolean
  howToObtain: string
  howToFix: string
  /** Kept only so old deployments are explained, never required. */
  retired?: boolean
}

const PROD: EnvName[] = ['production']
const PROD_PREVIEW: EnvName[] = ['production', 'preview']
const NONE: EnvName[] = []

export const ENV_REGISTRY: EnvVarSpec[] = [
  // ── Database ───────────────────────────────────────────────────────────────
  {
    name: 'DATABASE_URL', description: 'PostgreSQL connection string', category: 'DATABASE',
    secret: true, public: false, platformManaged: false, requiredIn: PROD_PREVIEW, requiredAt: 'runtime',
    aliases: ['NEON_POSTGRES_PRISMA_URL', 'POSTGRES_PRISMA_URL', 'NEON_POSTGRES_URL', 'POSTGRES_URL'],
    format: 'postgres-url', connectivityTestable: true,
    howToObtain: 'Create a Postgres database (Neon, Vercel Postgres, RDS, Supabase) and copy its pooled connection string.',
    howToFix: 'Set DATABASE_URL to the full postgresql:// URL including user, password, host and database. Never commit it.',
  },
  {
    name: 'NEON_POSTGRES_PRISMA_URL', description: 'Neon-specific alias read by scripts/vercel-build.mjs', category: 'DATABASE',
    secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build',
    format: 'postgres-url', connectivityTestable: false,
    howToObtain: 'Neon sets this automatically when the database is connected through the Vercel integration.',
    howToFix: 'Optional. Only needed if you rely on the Neon integration instead of DATABASE_URL.',
  },

  // ── Core ───────────────────────────────────────────────────────────────────
  {
    name: 'NEXTAUTH_SECRET', description: 'Signs and encrypts session tokens', category: 'SECURITY',
    secret: true, public: false, platformManaged: false, requiredIn: PROD_PREVIEW, requiredAt: 'runtime',
    format: 'secret', minLength: 32, connectivityTestable: false,
    howToObtain: 'Generate with: openssl rand -base64 32',
    howToFix: 'Set a random value of at least 32 characters. Changing it signs everyone out; that is intended.',
  },
  {
    name: 'NEXTAUTH_URL', description: 'Public URL used to build callback links', category: 'CORE',
    secret: false, public: false, platformManaged: false, requiredIn: PROD, requiredAt: 'runtime',
    fallbackFrom: ['NEXT_PUBLIC_APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'],
    format: 'url', connectivityTestable: false,
    howToObtain: 'The site address customers use, e.g. https://shop.example.com (Vercel can derive it).',
    howToFix: 'Set it to the https address of the deployment, without a trailing slash.',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL', description: 'Public URL for canonical links and email links', category: 'CORE',
    secret: false, public: true, platformManaged: false, requiredIn: PROD, requiredAt: 'build',
    fallbackFrom: ['NEXTAUTH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'],
    format: 'url', connectivityTestable: false,
    howToObtain: 'Same address as NEXTAUTH_URL, or let the platform derive it.',
    howToFix: 'Set the https address of the deployment. It is public, so it must never hold a secret.',
  },
  {
    name: 'NEXT_PUBLIC_APP_NAME', description: 'Application name shown in metadata and emails', category: 'CORE',
    secret: false, public: true, platformManaged: false, requiredIn: NONE, requiredAt: 'build',
    connectivityTestable: false,
    howToObtain: 'The shop or product name.',
    howToFix: 'Optional. Falls back to a generic template name.',
  },
  {
    name: 'NEXT_PUBLIC_SITE_URL', description: 'Legacy alias for the public site URL', category: 'CORE',
    secret: false, public: true, platformManaged: false, requiredIn: NONE, requiredAt: 'build',
    fallbackFrom: ['NEXT_PUBLIC_APP_URL'],
    format: 'url', connectivityTestable: false,
    howToObtain: 'Not needed on new deployments; NEXT_PUBLIC_APP_URL supersedes it.',
    howToFix: 'Optional. Remove it once NEXT_PUBLIC_APP_URL is set.',
  },
  {
    name: 'APP_MODE', description: 'Selects the normal application behaviour or the demo dataset (see src/lib/app-config.ts)', category: 'CORE',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    // The values the application actually reads. 'prod' is accepted as an alias of
    // 'production'; anything unrecognised falls back to production behaviour, so a
    // wrong value here is harmless rather than a lockout. The registry previously
    // advertised template/client/development, none of which the code reads.
    format: 'enum', enumValues: ['production', 'prod', 'demo'], connectivityTestable: false,
    howToObtain: 'Leave unset. Unset means production behaviour, which is what a client deployment must run.',
    howToFix: 'Set APP_MODE=demo only to load the sample dataset for a demonstration. Never set it on a live shop.',
  },

  // ── Rate limiting (mandatory in production, and the reason registration broke) ──
  {
    name: 'UPSTASH_REDIS_REST_URL', description: 'Upstash Redis REST endpoint for the shared rate-limit store', category: 'SECURITY',
    secret: false, public: false, platformManaged: false, requiredIn: PROD_PREVIEW, requiredAt: 'runtime',
    feature: 'rateLimit', format: 'url', connectivityTestable: true,
    howToObtain: 'Create a Redis database at upstash.com, open its REST API section and copy UPSTASH_REDIS_REST_URL.',
    howToFix: 'Add it to Vercel for Production and Preview. Without it every rate-limited route answers 503 rather than pretending the caller misbehaved.',
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN', description: 'Token for the Upstash Redis REST endpoint', category: 'SECURITY',
    secret: true, public: false, platformManaged: false, requiredIn: PROD_PREVIEW, requiredAt: 'runtime',
    feature: 'rateLimit', format: 'secret', connectivityTestable: true,
    howToObtain: 'Same Upstash REST API section: the token is shown beside the URL.',
    howToFix: 'Add it to Vercel alongside the URL. It is a secret; never put it in a NEXT_PUBLIC_ variable.',
  },
  {
    name: 'RATE_LIMIT_TRUST_PROXY', description: 'Trust x-real-ip for rate-limit keys behind your own proxy', category: 'SECURITY',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'boolean', connectivityTestable: false,
    howToObtain: 'Set to true only when a proxy you control sets x-real-ip. Vercel is detected automatically.',
    howToFix: 'Leave unset on Vercel. Setting it behind an untrusted proxy lets callers choose their own bucket.',
  },
  {
    name: 'RATE_LIMIT_REGISTER_MAX', description: 'Registration attempts allowed per minute per caller', category: 'SECURITY',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'number', connectivityTestable: false,
    howToObtain: 'Defaults to 3.', howToFix: 'Optional. Do not raise it to work around a broken limiter.',
  },
  {
    name: 'RATE_LIMIT_CI_IN_MEMORY', description: 'Use an in-process limiter instead of Redis (tests only)', category: 'DEVELOPMENT_ONLY',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'boolean', connectivityTestable: false,
    howToObtain: 'CI sets it. Never set it for a customer deployment.',
    howToFix: 'Unset it in production. It disables the shared store and would let each instance keep its own counters.',
  },

  // ── Two-factor and CSP ─────────────────────────────────────────────────────
  {
    name: 'TWO_FACTOR_ENCRYPTION_KEY', description: 'Encrypts stored TOTP secrets', category: 'SECURITY',
    secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'secret', minLength: 32, connectivityTestable: false,
    howToObtain: 'Generate with: openssl rand -base64 32',
    howToFix: 'Required once any owner enrols in 2FA. Rotating it invalidates existing enrolments, so rotate deliberately.',
  },
  {
    name: 'REQUIRE_OWNER_2FA', description: 'Force owners to enrol in 2FA before using the dashboard', category: 'SECURITY',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    feature: 'twoFactorPolicy', format: 'boolean', connectivityTestable: false,
    howToObtain: 'Set true when you want to enforce enrolment.', howToFix: 'Optional policy flag; default off.',
  },
  {
    name: 'CSP_NONCE_ENABLED', description: 'Enable nonce-based Content-Security-Policy', category: 'SECURITY',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'boolean', connectivityTestable: false,
    howToObtain: 'Enable only after staging verification of every surface.',
    howToFix: 'Leave off until the nonce path has been verified in staging; enabling it unverified can break page scripts.',
  },

  // ── Tenant + registration ──────────────────────────────────────────────────
  {
    name: 'TENANT_MODE', description: 'Single-business or multi-business resolution', category: 'TENANT_CONFIGURATION',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'enum', enumValues: ['single', 'multi'], connectivityTestable: false,
    howToObtain: 'single for a dedicated shop deployment.', howToFix: 'Optional; defaults to sensible single-shop behaviour.',
  },
  {
    name: 'SINGLE_BUSINESS_ID', description: 'Pins the deployment to one business record', category: 'TENANT_CONFIGURATION',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    connectivityTestable: false,
    howToObtain: 'The business id after provisioning.', howToFix: 'Optional; used for single-tenant deployments.',
  },
  {
    name: 'OWNER_REGISTRATION_MODE', description: 'Controls first-owner and customer self-registration (see src/lib/owner-registration.ts)', category: 'TENANT_CONFIGURATION',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    // The application reads exactly these three values and treats anything else as
    // 'disabled'. The registry used to advertise open/owner-only/closed, so an
    // operator who followed it would close first-owner registration on a brand new
    // deployment and then be unable to get in at all.
    format: 'enum', enumValues: ['onboarding', 'invite_only', 'disabled'], connectivityTestable: false,
    howToObtain: 'Leave unset on a new deployment: unset behaves as onboarding, which admits the first owner and then closes.',
    howToFix: 'Use disabled to stop all self-registration, or invite_only once the owner exists. Any unrecognised value is treated as disabled.',
  },

  // ── Storage ────────────────────────────────────────────────────────────────
  {
    name: 'BLOB_READ_WRITE_TOKEN', description: 'Vercel Blob token for photo and media uploads', category: 'STORAGE',
    secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    feature: 'storage', format: 'secret', connectivityTestable: false,
    howToObtain: 'Create a Blob store in Vercel and connect it to the project; the token is injected by the integration.',
    howToFix: 'Required for gallery, profile photos and before/after uploads. Uploads are advertised as available only when it is present.',
  },

  // ── Payments ───────────────────────────────────────────────────────────────
  {
    name: 'STRIPE_SECRET_KEY', description: 'Stripe API secret key', category: 'PAYMENTS',
    secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    feature: 'payments', format: 'secret', connectivityTestable: true,
    howToObtain: 'Stripe dashboard → Developers → API keys. Use sk_test_… until acceptance is signed off.',
    howToFix: 'Required only when taking payments online. Never expose it to the browser.',
  },
  {
    name: 'STRIPE_PUBLISHABLE_KEY', description: 'Stripe publishable key', category: 'PAYMENTS',
    secret: false, public: true, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    feature: 'payments', format: 'secret', connectivityTestable: false,
    howToObtain: 'Stripe dashboard → Developers → API keys (pk_…).',
    howToFix: 'Required with the secret key for client-side payment confirmation.',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET', description: 'Signing secret for the Stripe webhook endpoint', category: 'PAYMENTS',
    secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    feature: 'payments', format: 'secret', connectivityTestable: false,
    howToObtain: 'Stripe dashboard → Developers → Webhooks → your endpoint → signing secret (whsec_…).',
    howToFix: 'Required for payments: without it webhook deliveries cannot be verified and are refused.',
  },

  // ── Email ──────────────────────────────────────────────────────────────────
  {
    name: 'EMAIL_ENABLED', description: 'Turns email notifications on', category: 'EMAIL',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'boolean', connectivityTestable: false,
    howToObtain: 'Set true when SMTP details are in place.', howToFix: 'Optional.',
  },
  { name: 'SMTP_HOST', description: 'SMTP server host', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', connectivityTestable: true, howToObtain: 'From your email provider (e.g. smtp.postmarkapp.com).', howToFix: 'Required when EMAIL_ENABLED=true.' },
  { name: 'SMTP_PORT', description: 'SMTP server port', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', format: 'number', connectivityTestable: false, howToObtain: 'Usually 587 (STARTTLS) or 465 (TLS).', howToFix: 'Required when EMAIL_ENABLED=true.' },
  { name: 'SMTP_USER', description: 'SMTP username', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', connectivityTestable: false, howToObtain: 'From your email provider.', howToFix: 'Required when EMAIL_ENABLED=true.' },
  { name: 'SMTP_PASS', description: 'SMTP password or API key', category: 'EMAIL', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', connectivityTestable: false, howToObtain: 'From your email provider.', howToFix: 'Required when EMAIL_ENABLED=true. Rotate at the provider if leaked.' },
  { name: 'SMTP_FROM', description: 'From address on outgoing mail', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', format: 'email', connectivityTestable: false, howToObtain: 'An address on a domain you have verified with the provider.', howToFix: 'Required when EMAIL_ENABLED=true; unverified domains land in spam.' },
  { name: 'SMTP_SECURE', description: 'Use implicit TLS on the SMTP connection', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', format: 'boolean', connectivityTestable: false, howToObtain: 'true for port 465, false for 587.', howToFix: 'Optional; default false.' },
  { name: 'CONTACT_EMAIL', description: 'Where public contact-form messages go', category: 'EMAIL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'email', format: 'email', connectivityTestable: false, howToObtain: 'The shop inbox.', howToFix: 'Optional; falls back to SMTP_USER.' },

  // ── SMS ────────────────────────────────────────────────────────────────────
  {
    name: 'SMS_ENABLED', description: 'Turns SMS notifications on', category: 'SMS',
    secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime',
    format: 'boolean', connectivityTestable: false,
    howToObtain: 'Set true when Twilio credentials are in place.', howToFix: 'Optional.',
  },
  { name: 'TWILIO_ACCOUNT_SID', description: 'Twilio account SID', category: 'SMS', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'sms', connectivityTestable: true, howToObtain: 'Twilio console dashboard.', howToFix: 'Required when SMS_ENABLED=true.' },
  { name: 'TWILIO_AUTH_TOKEN', description: 'Twilio auth token', category: 'SMS', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'sms', connectivityTestable: false, howToObtain: 'Twilio console dashboard.', howToFix: 'Required when SMS_ENABLED=true. Rotate at the provider if leaked.' },
  { name: 'TWILIO_PHONE_NUMBER', description: 'Sender number for SMS', category: 'SMS', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'sms', format: 'phone', connectivityTestable: false, howToObtain: 'A number purchased in Twilio, in E.164 form.', howToFix: 'Required when SMS_ENABLED=true.' },

  // ── Google Business Profile ────────────────────────────────────────────────
  { name: 'GOOGLE_ENABLED', description: 'Turns the Google Business integration on', category: 'GOOGLE', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'boolean', connectivityTestable: false, howToObtain: 'Set true when OAuth credentials exist.', howToFix: 'Optional.' },
  { name: 'GOOGLE_CLIENT_ID', description: 'Google OAuth client id', category: 'GOOGLE', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'Google Cloud console → Credentials.', howToFix: 'Required when GOOGLE_ENABLED=true.' },
  { name: 'GOOGLE_CLIENT_SECRET', description: 'Google OAuth client secret', category: 'GOOGLE', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'Google Cloud console → Credentials.', howToFix: 'Required when GOOGLE_ENABLED=true.' },
  { name: 'GBP_ACCESS_TOKEN', description: 'Google Business Profile access token', category: 'GOOGLE', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'Issued by the OAuth flow once the shop connects its profile.', howToFix: 'Optional; obtained through the in-app connect flow, not hand-edited.' },
  { name: 'GBP_REFRESH_TOKEN', description: 'Google Business Profile refresh token', category: 'GOOGLE', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'Issued by the OAuth flow.', howToFix: 'Optional; obtained through the in-app connect flow.' },
  { name: 'GBP_ACCOUNT_ID', description: 'Google Business account id', category: 'GOOGLE', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'From the in-app connect flow.', howToFix: 'Optional.' },
  { name: 'GBP_LOCATION_ID', description: 'Google Business location id', category: 'GOOGLE', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'google', connectivityTestable: false, howToObtain: 'From the in-app connect flow.', howToFix: 'Optional.' },

  // ── Scheduled tasks ────────────────────────────────────────────────────────
  { name: 'REMINDERS_ENABLED', description: 'Turns scheduled appointment reminders on', category: 'SCHEDULED_TASKS', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'boolean', connectivityTestable: false, howToObtain: 'Set true when cron is configured.', howToFix: 'Optional.' },
  { name: 'CRON_SECRET', description: 'Bearer token required by scheduled endpoints', category: 'SCHEDULED_TASKS', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'reminders', format: 'secret', minLength: 16, connectivityTestable: false, howToObtain: 'Generate with: openssl rand -hex 24', howToFix: 'Required only when reminders or other scheduled jobs run. Vercel sends it as the Authorization header.' },

  // ── Observability ──────────────────────────────────────────────────────────
  { name: 'OBSERVABILITY_WEBHOOK_URL', description: 'Webhook that receives forwarded production error events', category: 'OBSERVABILITY', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', feature: 'observability', format: 'url', connectivityTestable: true, howToObtain: 'From your error tracker (Sentry, Better Stack, Datadog relay).', howToFix: 'Optional, but recommended for a live shop.' },

  // ── Internal / test-only ───────────────────────────────────────────────────
  { name: 'ENABLE_E2E_TESTS', description: 'Enables the internal end-to-end booking endpoint', category: 'INTERNAL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'boolean', connectivityTestable: false, howToObtain: 'Set only in a test environment.', howToFix: 'Never enable on a customer deployment.' },
  { name: 'SEED_ALLOW_DESTRUCTIVE', description: 'Allows destructive seeding', category: 'INTERNAL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'boolean', connectivityTestable: false, howToObtain: 'Set only in a throwaway environment.', howToFix: 'Never set against customer data.' },
  { name: 'SEED_OWNER_EMAIL', description: 'Owner email used by development seeds', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', format: 'email', connectivityTestable: false, howToObtain: 'Local development only.', howToFix: 'Do not ship to a client copy.' },
  { name: 'SEED_OWNER_PASSWORD', description: 'Owner password used by development seeds', category: 'DEVELOPMENT_ONLY', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', connectivityTestable: false, howToObtain: 'Local development only.', howToFix: 'Do not ship to a client copy.' },
  { name: 'E2E_OWNER_EMAIL', description: 'Owner email for browser acceptance runs', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', format: 'email', connectivityTestable: false, howToObtain: 'Test environment.', howToFix: 'Do not ship to a client copy.' },
  { name: 'E2E_OWNER_PASSWORD', description: 'Owner password for browser acceptance runs', category: 'DEVELOPMENT_ONLY', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', connectivityTestable: false, howToObtain: 'Test environment.', howToFix: 'Do not ship to a client copy.' },
  { name: 'RATE_LIMIT_ACCEPT_POST_MAX', description: 'Relaxed limit used by acceptance runs', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'number', connectivityTestable: false, howToObtain: 'Acceptance harness only.', howToFix: 'Do not ship to a client copy.' },

  // ── Operator and development tooling ───────────────────────────────────────
  //
  // Found by scripts/check-env-drift.mjs: read by the source but absent from this
  // registry, so nothing could report them missing. None is a customer setting.
  { name: 'DATABASE_ADMIN_URL', description: 'Elevated connection used only by the RLS administration scripts', category: 'INTERNAL', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'postgres-url', connectivityTestable: true, howToObtain: 'The database owner account string, held by the operator only.', howToFix: 'Never place this in a customer deployment or in NEXT_PUBLIC_*. It is not needed at runtime.' },
  { name: 'RLS_APP_ROLE', description: 'Database role the RLS scripts grant policies to', category: 'INTERNAL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'The application database role.', howToFix: 'Only needed while applying prisma/rls/production-rls.sql.' },
  { name: 'PGBIN_DIR', description: 'Directory holding pg_dump and pg_restore for backups', category: 'INTERNAL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'path', connectivityTestable: false, howToObtain: 'Local PostgreSQL installation.', howToFix: 'Only needed by scripts/backup.ts outside Vercel.' },
  { name: 'SMOKE_BASE_URL', description: 'Deployment the smoke test checks', category: 'INTERNAL', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'url', connectivityTestable: true, howToObtain: 'The deployment URL being verified.', howToFix: 'Pass it when running npm run smoke.' },
  { name: 'PERF_STRICT', description: 'Turns performance warnings into failures', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'boolean', connectivityTestable: false, howToObtain: 'Set to true in CI.', howToFix: 'Leave unset locally.' },
  { name: 'QA_BASE', description: 'Base URL for the internal QA browser scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'url', connectivityTestable: false, howToObtain: 'A local or preview deployment.', howToFix: 'Internal tooling only; never ship it to a client copy.' },
  { name: 'QA_LOGIN_EMAIL', description: 'Account the internal QA scripts sign in as', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'email', connectivityTestable: false, howToObtain: 'A QA account.', howToFix: 'Internal tooling only; never ship it to a client copy.' },
  { name: 'QA_LOGIN_PASSWORD', description: 'Password for the internal QA account', category: 'DEVELOPMENT_ONLY', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'A QA account.', howToFix: 'Internal tooling only; never ship it to a client copy.' },
  { name: 'E2E_BASE_URL', description: 'Deployment Playwright runs against', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', format: 'url', connectivityTestable: false, howToObtain: 'Playwright configuration.', howToFix: 'Acceptance harness only.' },
  { name: 'E2E_NO_WEBSERVER', description: 'Use an already-running server instead of starting one', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', format: 'boolean', connectivityTestable: false, howToObtain: 'Playwright configuration.', howToFix: 'Acceptance harness only.' },
  { name: 'E2E_TRACE', description: 'Trace level for Playwright runs', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'build', format: 'enum', enumValues: ['on', 'off', 'retain-on-failure'], connectivityTestable: false, howToObtain: 'Playwright configuration.', howToFix: 'Acceptance harness only.' },
  { name: 'RATE_LIMIT_ACCEPT_GET_MAX', description: 'Relaxed read limit used by acceptance runs', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'number', connectivityTestable: false, howToObtain: 'Acceptance harness only.', howToFix: 'Do not ship to a client copy.' },
  { name: 'SEED_BUSINESS_NAME', description: 'Shop name written by the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input for a new shop.', howToFix: 'Only read by scripts/provision-business.ts and prisma/seed.ts, never by the running app.' },
  { name: 'SEED_BUSINESS_SLUG', description: 'Shop slug for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },
  { name: 'SEED_BUSINESS_EMAIL', description: 'Shop contact email for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', format: 'email', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },
  { name: 'SEED_BUSINESS_PHONE', description: 'Shop phone for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },
  { name: 'SEED_BUSINESS_CITY', description: 'Shop city for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },
  { name: 'SEED_BUSINESS_STATE', description: 'Shop state for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },
  { name: 'SEED_TIMEZONE', description: 'Shop timezone for the seed and provisioning scripts', category: 'DEVELOPMENT_ONLY', secret: false, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Provisioning input.', howToFix: 'Only read by provisioning and seed scripts.' },

  // ── Platform-managed ───────────────────────────────────────────────────────
  { name: 'VERCEL', description: 'Set to 1 inside Vercel', category: 'PLATFORM_MANAGED', secret: false, public: false, platformManaged: true, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Injected by Vercel.', howToFix: 'Never set this by hand.' },
  { name: 'VERCEL_ENV', description: 'production | preview | development inside Vercel', category: 'PLATFORM_MANAGED', secret: false, public: false, platformManaged: true, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Injected by Vercel.', howToFix: 'Never set this by hand.' },
  { name: 'VERCEL_URL', description: 'Deployment hostname', category: 'PLATFORM_MANAGED', secret: false, public: false, platformManaged: true, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Injected by Vercel.', howToFix: 'Never set this by hand.' },
  { name: 'VERCEL_PROJECT_PRODUCTION_URL', description: 'Stable production hostname', category: 'PLATFORM_MANAGED', secret: false, public: false, platformManaged: true, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'Injected by Vercel.', howToFix: 'Never set this by hand.' },

  // ── Retired ────────────────────────────────────────────────────────────────
  { name: 'OWNER_PROVISIONING_TOKEN', description: 'Retired: owner provisioning is no longer token-gated', category: 'RETIRED', secret: true, public: false, platformManaged: false, requiredIn: NONE, requiredAt: 'runtime', connectivityTestable: false, howToObtain: 'No longer used.', howToFix: 'Delete it from the deployment; it has no effect and only invites confusion.', retired: true },
]

const SPECS = new Map(ENV_REGISTRY.map((spec) => [spec.name, spec]))
const FEATURE_FLAGS: Record<string, FeatureName> = {
  EMAIL_ENABLED: 'email', SMS_ENABLED: 'sms', GOOGLE_ENABLED: 'google',
  REMINDERS_ENABLED: 'reminders',
}

export function getEnvSpec(name: string): EnvVarSpec | undefined {
  return SPECS.get(name)
}

export function envsByCategory(category: EnvCategory): EnvVarSpec[] {
  return ENV_REGISTRY.filter((spec) => spec.category === category)
}

/** Whitespace is not configuration. */
export function isPresent(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function isFeatureEnabled(env: EnvSource = process.env, feature: FeatureName): boolean {
  switch (feature) {
    case 'email': return env.EMAIL_ENABLED === 'true'
    case 'sms': return env.SMS_ENABLED === 'true'
    case 'google': return env.GOOGLE_ENABLED === 'true'
    case 'reminders': return env.REMINDERS_ENABLED === 'true'
    case 'observability': return isPresent(env.OBSERVABILITY_WEBHOOK_URL)
    // Payments, storage and the rate-limit store are not switched on by a flag:
    // they are on when they are configured. A shop that has not set a Stripe key
    // is not "using Stripe"; one that has set a key is.
    case 'payments': return isPresent(env.STRIPE_SECRET_KEY)
    case 'storage': return isPresent(env.BLOB_READ_WRITE_TOKEN)
    case 'rateLimit': return true // always required outside development
    case 'twoFactorPolicy': return env.REQUIRE_OWNER_2FA === 'true'
    default: return false
  }
}

export interface EffectiveValue {
  value?: string
  /** Where the value came from: the variable itself, an alias, or a fallback. */
  source: string
  derived: boolean
}

/**
 * Resolve the value the application will actually use, honouring the aliases and
 * fallbacks the build and runtime already support. A checker that only looks for
 * the literal name reports "missing" for a deployment that is working fine.
 */
export function resolveEffective(name: string, env: EnvSource = process.env): EffectiveValue {
  const spec = SPECS.get(name)
  if (isPresent(env[name])) return { value: env[name]!.trim(), source: name, derived: false }
  for (const alias of spec?.aliases ?? []) {
    if (isPresent(env[alias])) return { value: env[alias]!.trim(), source: alias, derived: true }
  }
  for (const fallback of spec?.fallbackFrom ?? []) {
    if (isPresent(env[fallback])) {
      const raw = env[fallback]!.trim()
      // Vercel exposes bare hostnames; the app needs an absolute URL.
      const value = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
      return { value, source: fallback, derived: true }
    }
  }
  return { source: name, derived: false }
}

export function validateFormat(spec: EnvVarSpec, value: string): { ok: boolean; reason?: string } {
  if (spec.minLength && value.length < spec.minLength) {
    return { ok: false, reason: `shorter than the required ${spec.minLength} characters` }
  }
  switch (spec.format) {
    case 'url':
      try {
        const url = new URL(value)
        if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: 'must be an http(s) address' }
      } catch { return { ok: false, reason: 'not a valid URL' } }
      return { ok: true }
    case 'postgres-url':
      if (!/^postgres(ql)?:\/\/.+/.test(value)) return { ok: false, reason: 'must start with postgresql:// or postgres://' }
      return { ok: true }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { ok: true } : { ok: false, reason: 'not a valid email address' }
    case 'phone':
      return /^\+[1-9]\d{6,15}$/.test(value) ? { ok: true } : { ok: false, reason: 'must be E.164, e.g. +15551234567' }
    case 'boolean':
      return ['true', 'false'].includes(value.toLowerCase()) ? { ok: true } : { ok: false, reason: 'must be true or false' }
    case 'number':
      return /^\d+$/.test(value) ? { ok: true } : { ok: false, reason: 'must be a whole number' }
    case 'enum':
      return !spec.enumValues || spec.enumValues.includes(value)
        ? { ok: true }
        : { ok: false, reason: `must be one of ${spec.enumValues.join(', ')}` }
    default:
      return { ok: true }
  }
}

export interface EnvEvaluation {
  spec: EnvVarSpec
  status: EnvStatus
  required: boolean
  source: string
  detail?: string
}

/**
 * Evaluate one variable for a deployment environment. Presence is never enough:
 * a whitespace value is missing and a malformed URL is invalid, because both
 * produce a deployment that looks configured and fails at the first request.
 */
export function evaluateVar(
  spec: EnvVarSpec,
  options: { environment?: EnvName; env?: EnvSource } = {}
): EnvEvaluation {
  const env = options.env ?? process.env
  const environment = options.environment ?? normalizeEnvironment(env)
  const effective = resolveEffective(spec.name, env)

  if (spec.retired) {
    return { spec, status: effective.value ? 'RETIRED' : 'NOT_REQUIRED', required: false, source: effective.source,
      detail: effective.value ? 'no longer used; safe to delete' : undefined }
  }
  if (spec.platformManaged) {
    return { spec, status: 'PLATFORM_MANAGED', required: false, source: effective.source,
      detail: effective.value ? undefined : 'injected by the platform at runtime' }
  }

  const requiredHere = spec.requiredIn.includes(environment)
  const featureOn = spec.feature ? isFeatureEnabled(env, spec.feature) : true
  const required = requiredHere || (Boolean(spec.feature) && featureOn && environment !== 'test')

  if (!effective.value) {
    if (!required) return { spec, status: 'NOT_REQUIRED', required: false, source: effective.source }
    return { spec, status: 'MISSING', required: true, source: spec.name, detail: spec.howToFix }
  }

  const format = validateFormat(spec, effective.value)
  if (!format.ok) {
    return { spec, status: 'INVALID', required, source: effective.source, detail: format.reason }
  }

  // Deriving a value from a fallback works, but the operator should know the
  // canonical variable is unset — that is a warning, not a failure.
  if (effective.derived) {
    return { spec, status: 'WARNING', required, source: effective.source,
      detail: `derived from ${effective.source}; set ${spec.name} explicitly to make this deterministic` }
  }

  if (spec.feature && !featureOn && spec.name !== spec.feature.toUpperCase() + '_ENABLED') {
    return { spec, status: 'DISABLED', required: false, source: effective.source,
      detail: 'present but the integration is switched off' }
  }

  return { spec, status: 'CONFIGURED', required, source: effective.source }
}

export function normalizeEnvironment(env: EnvSource = process.env): EnvName {
  if (env.NODE_ENV === 'test') return 'test'
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview') return 'preview'
  return env.NODE_ENV === 'production' ? 'production' : 'development'
}

export function evaluateAll(options: { environment?: EnvName; env?: EnvSource } = {}): EnvEvaluation[] {
  return ENV_REGISTRY.map((spec) => evaluateVar(spec, options))
}

export function blockingEvaluations(options: { environment?: EnvName; env?: EnvSource } = {}): EnvEvaluation[] {
  return evaluateAll(options).filter((e) => e.status === 'MISSING' || e.status === 'INVALID')
}

/** Never print a secret, and never confirm its length beyond plausibility. */
export function describeValue(spec: EnvVarSpec, value: string | undefined): string {
  if (!isPresent(value)) return '(unset)'
  if (spec.secret) return `(set, ${value!.trim().length} characters)`
  return value!.trim()
}
