// ============================================================================
// Environment Validation Utility
// Validates that required environment variables are set before the app runs.
// Used by health check and deployment verification.
// ============================================================================

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
export type FeatureName = 'email' | 'sms' | 'google' | 'reminders'

export interface FeatureConfig {
  enabled: boolean
  configured: boolean
  missing: string[]
}

export const REQUIRED_ENV_VARS = [
  { variable: 'DATABASE_URL', description: 'PostgreSQL connection string', category: 'CORE' as const, secret: true },
  { variable: 'NEXTAUTH_SECRET', description: 'NextAuth session encryption secret', category: 'CORE' as const, secret: true },
  { variable: 'NEXTAUTH_URL', description: 'Public URL of the deployment', category: 'CORE' as const, secret: false },
  { variable: 'NEXT_PUBLIC_APP_URL', description: 'Public URL used for canonical links and metadata', category: 'CORE' as const, secret: false },
  { variable: 'NEXT_PUBLIC_APP_NAME', description: 'Public application name', category: 'CORE' as const, secret: false },
]

export const OPTIONAL_ENV_VARS = [
  { variable: 'EMAIL_ENABLED', description: 'Enable email notifications', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'email' as const },
  { variable: 'SMTP_HOST', description: 'Email server host', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'email' as const },
  { variable: 'SMTP_PORT', description: 'Email server port', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'email' as const },
  { variable: 'SMTP_USER', description: 'Email server username', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'email' as const },
  { variable: 'SMTP_PASS', description: 'Email server password', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'email' as const },
  { variable: 'SMTP_FROM', description: 'From email address for notifications', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'email' as const },
  { variable: 'SMS_ENABLED', description: 'Enable SMS notifications', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'sms' as const },
  { variable: 'TWILIO_ACCOUNT_SID', description: 'Twilio account SID', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'sms' as const },
  { variable: 'TWILIO_AUTH_TOKEN', description: 'Twilio authentication token', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'sms' as const },
  { variable: 'TWILIO_PHONE_NUMBER', description: 'Twilio sender phone number', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'sms' as const },
  { variable: 'GOOGLE_ENABLED', description: 'Enable Google Business integration', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'google' as const },
  { variable: 'GOOGLE_CLIENT_ID', description: 'Google OAuth client ID', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'google' as const },
  { variable: 'GOOGLE_CLIENT_SECRET', description: 'Google OAuth client secret', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'google' as const },
  { variable: 'GBP_ACCESS_TOKEN', description: 'Google Business Profile access token', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'google' as const },
  { variable: 'GBP_REFRESH_TOKEN', description: 'Google Business Profile refresh token', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'google' as const },
  { variable: 'GBP_ACCOUNT_ID', description: 'Google Business Profile account ID', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'google' as const },
  { variable: 'GBP_LOCATION_ID', description: 'Google Business Profile location ID', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'google' as const },
  { variable: 'REMINDERS_ENABLED', description: 'Enable scheduled reminders', category: 'OPTIONAL_FEATURE' as const, secret: false, feature: 'reminders' as const },
  { variable: 'CRON_SECRET', description: 'Secret for protecting cron job endpoints', category: 'OPTIONAL_FEATURE' as const, secret: true, feature: 'reminders' as const },
]

export const INTERNAL_ENV_VARS = [
  { variable: 'SINGLE_BUSINESS_ID', description: 'Configured tenant for a single-business deployment', category: 'INTERNAL' as const, secret: false },
  { variable: 'OWNER_REGISTRATION_MODE', description: 'Owner registration policy', category: 'INTERNAL' as const, secret: false },
  { variable: 'APP_MODE', description: 'Demo or production runtime mode', category: 'INTERNAL' as const, secret: false },
]

const FEATURE_REQUIREMENTS: Record<FeatureName, string[]> = {
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
  sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GBP_ACCOUNT_ID', 'GBP_LOCATION_ID'],
  reminders: ['CRON_SECRET'],
}

function isEnabled(variable: string): boolean {
  return process.env[variable]?.trim().toLowerCase() === 'true'
}

export function getFeatureConfig(feature: FeatureName): FeatureConfig {
  const flag = feature === 'email' ? 'EMAIL_ENABLED'
    : feature === 'sms' ? 'SMS_ENABLED'
      : feature === 'google' ? 'GOOGLE_ENABLED' : 'REMINDERS_ENABLED'
  const enabled = isEnabled(flag)
  const missing = enabled ? FEATURE_REQUIREMENTS[feature].filter((name) => !process.env[name]?.trim()) : []
  return { enabled, configured: missing.length === 0, missing }
}

export function checkEnvironment(): {
  allRequiredSet: boolean
  results: EnvCheckResult[]
  missing: string[]
} {
  const results: EnvCheckResult[] = []
  const missing: string[] = []

  for (const { variable, description, category, secret } of REQUIRED_ENV_VARS) {
    const isSet = !!process.env[variable]
    results.push({ variable, set: isSet, required: true, description, category, secret })
    if (!isSet) missing.push(variable)
  }

  for (const { variable, description, category, secret, feature } of OPTIONAL_ENV_VARS) {
    results.push({ variable, set: !!process.env[variable], required: false, description, category, secret, feature })
  }

  for (const { variable, description, category, secret } of INTERNAL_ENV_VARS) {
    results.push({ variable, set: !!process.env[variable], required: false, description, category, secret })
  }

  return {
    allRequiredSet: missing.length === 0,
    results,
    missing,
  }
}
