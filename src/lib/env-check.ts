// ============================================================================
// Environment Validation Utility
// Validates that required environment variables are set before the app runs.
// Used by health check and deployment verification.
// ============================================================================

import { ENV_REGISTRY, evaluateAll, isPresent, type EnvVarSpec } from './env-registry'

type EnvCategory_ = EnvVarSpec['category']
type LegacyCategory = 'CORE' | 'OPTIONAL_FEATURE' | 'INTERNAL' | 'DEVELOPMENT_ONLY'

export interface EnvCheckResult {
  variable: string
  set: boolean
  required: boolean
  description: string
  category: EnvCategory
  secret: boolean
  feature?: FeatureName
}

export type EnvCategory = 'CORE' | 'OPTIONAL_FEATURE' | 'INTERNAL' | 'DEVELOPMENT_ONLY'
export type FeatureName = 'email' | 'sms' | 'google' | 'reminders' | 'observability'

export interface FeatureConfig {
  enabled: boolean
  configured: boolean
  missing: string[]
}

// The lists below are DERIVED from the one environment registry. They used to be
// maintained by hand, which is how Redis came to be mandatory in production while
// being absent from the inventory, why the retired provisioning token still
// appeared in it, and why a whitespace-only value counted as configured.
const legacyCategory = (category: EnvCategory_): LegacyCategory => {
  switch (category) {
    case 'CORE': case 'SECURITY': case 'DATABASE': case 'STORAGE': case 'TENANT_CONFIGURATION':
      return 'CORE'
    case 'INTERNAL': case 'DEVELOPMENT_ONLY': case 'PLATFORM_MANAGED': case 'RETIRED':
      return 'INTERNAL'
    default:
      return 'OPTIONAL_FEATURE'
  }
}

const toLegacy = (spec: EnvVarSpec) => ({
  variable: spec.name,
  description: spec.description,
  category: legacyCategory(spec.category),
  secret: spec.secret,
  ...(spec.feature && spec.feature !== 'rateLimit' && spec.feature !== 'payments' && spec.feature !== 'storage' && spec.feature !== 'twoFactorPolicy'
    ? { feature: spec.feature as FeatureName }
    : {}),
})

export const REQUIRED_ENV_VARS = ENV_REGISTRY.filter((s) => !s.retired && !s.platformManaged && s.requiredIn.length > 0).map(toLegacy)

export const OPTIONAL_ENV_VARS = ENV_REGISTRY.filter(
  (s) => !s.retired && !s.platformManaged && s.requiredIn.length === 0
    && !['INTERNAL', 'DEVELOPMENT_ONLY'].includes(s.category)
).map(toLegacy)

export const INTERNAL_ENV_VARS = ENV_REGISTRY.filter(
  (s) => !s.retired && !s.platformManaged && s.requiredIn.length === 0 && ['INTERNAL', 'DEVELOPMENT_ONLY'].includes(s.category)
).map(toLegacy)

const FEATURE_REQUIREMENTS: Record<FeatureName, string[]> = {
  email: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
  sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GBP_ACCOUNT_ID', 'GBP_LOCATION_ID'],
  reminders: ['CRON_SECRET'],
  observability: [],
}

export function isFeatureEnabled(variable: string): boolean {
  return process.env[variable]?.trim().toLowerCase() === 'true'
}

export function isEmailEnabled(): boolean { return isFeatureEnabled('EMAIL_ENABLED') }
export function isSmsEnabled(): boolean { return isFeatureEnabled('SMS_ENABLED') }
export function isGoogleEnabled(): boolean { return isFeatureEnabled('GOOGLE_ENABLED') }
export function isRemindersEnabled(): boolean { return isFeatureEnabled('REMINDERS_ENABLED') }

export function getFeatureConfig(feature: FeatureName): FeatureConfig {
  // Observability has no separate *_ENABLED flag: setting the webhook URL
  // is what turns error forwarding on.
  if (feature === 'observability') {
    const enabled = isPresent(process.env.OBSERVABILITY_WEBHOOK_URL)
    return { enabled, configured: enabled, missing: [] as string[] }
  }
  const flag = feature === 'email' ? 'EMAIL_ENABLED'
    : feature === 'sms' ? 'SMS_ENABLED'
      : feature === 'google' ? 'GOOGLE_ENABLED' : 'REMINDERS_ENABLED'
  const enabled = isFeatureEnabled(flag)
  const missing = enabled ? FEATURE_REQUIREMENTS[feature].filter((name) => !isPresent(process.env[name])) : []
  return { enabled, configured: missing.length === 0, missing }
}

export function checkEnvironment(): {
  allRequiredSet: boolean
  results: EnvCheckResult[]
  missing: string[]
} {
  const results: EnvCheckResult[] = []
  const missing: string[] = []

  // Evaluate the EFFECTIVE configuration: aliases and documented fallbacks
  // count, whitespace does not, and a malformed value is reported as missing
  // because the deployment will fail on first use either way.
  const evaluations = new Map(evaluateAll().map((e) => [e.spec.name, e]))

  for (const { variable, description, category, secret } of REQUIRED_ENV_VARS) {
    const evaluation = evaluations.get(variable)
    const isSet = evaluation ? evaluation.status === 'CONFIGURED' || evaluation.status === 'VERIFIED' || evaluation.status === 'WARNING' : isPresent(process.env[variable])
    results.push({ variable, set: isSet, required: true, description, category, secret })
    if (!isSet) missing.push(variable)
  }

  for (const { variable, description, category, secret, feature } of OPTIONAL_ENV_VARS) {
    results.push({ variable, set: isPresent(process.env[variable]), required: false, description, category, secret, feature })
  }

  for (const { variable, description, category, secret } of INTERNAL_ENV_VARS) {
    results.push({ variable, set: isPresent(process.env[variable]), required: false, description, category, secret })
  }

  return {
    allRequiredSet: missing.length === 0,
    results,
    missing,
  }
}
