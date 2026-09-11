import { prisma } from '@/lib/prisma'
import {
  checkEnvironment,
  getFeatureConfig,
  type FeatureName,
} from '@/lib/env-check'
import { verifyFactoryReadiness, type FactoryReadinessCheck } from '@/lib/production-readiness'

export type LaunchStatus = 'PASS' | 'BLOCKED' | 'WARNING' | 'DISABLED' | 'MANUAL' | 'NOT_STARTED'
export type LaunchStage =
  | 'NOT_STARTED'
  | 'DEPLOYMENT_PREFLIGHT'
  | 'DATABASE_READY'
  | 'ENVIRONMENT_READY'
  | 'OWNER_SETUP'
  | 'ONBOARDING'
  | 'CONFIGURATION_READY'
  | 'INTEGRATIONS_READY'
  | 'DOMAIN_READY'
  | 'TESTING'
  | 'FINAL_REVIEW'
  | 'READY_TO_LAUNCH'
  | 'LAUNCHED'

export interface LaunchCheck {
  key: string
  category: string
  label: string
  status: LaunchStatus
  required: boolean
  secret: boolean
  detail: string
  remediation: string
}

export interface NextAction {
  key: string
  title: string
  detail: string
  category: string
}

export interface FactoryLaunchReport {
  overall: 'READY' | 'ACTION_REQUIRED' | 'BLOCKED' | 'MANUAL_REVIEW'
  stage: LaunchStage
  counts: { passed: number; blocked: number; warnings: number; manual: number }
  nextAction: NextAction
  checks: LaunchCheck[]
}

const FEATURE_LABELS: Record<FeatureName, string> = {
  email: 'Email',
  sms: 'SMS',
  google: 'Google Business',
  reminders: 'Reminders',
}

export function buildDeploymentPreflight(): LaunchCheck[] {
  const environment = checkEnvironment()
  return environment.results.map((item) => {
    const enabledFeature = item.feature ? getFeatureConfig(item.feature) : null
    const applicable = !item.feature || !enabledFeature || enabledFeature.enabled
    const status: LaunchStatus = !applicable
      ? 'DISABLED'
      : item.required && !item.set
        ? 'BLOCKED'
        : item.set
          ? 'PASS'
          : 'WARNING'
    return {
      key: item.variable,
      category: item.category === 'CORE' ? 'Environment' : item.category,
      label: item.variable,
      status,
      required: item.required || Boolean(item.feature && enabledFeature?.enabled),
      secret: item.secret,
      detail: !applicable ? `${FEATURE_LABELS[item.feature!]} is disabled.` : item.set ? 'Configured.' : 'Not configured.',
      remediation: item.set || !applicable ? 'No action required.' : `Configure ${item.variable} in the production environment.`,
    }
  })
}

export function evaluateDomainReadiness(): LaunchCheck[] {
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const authUrl = process.env.NEXTAUTH_URL?.trim()
  let validPublic = false
  let validAuth = false
  try { validPublic = Boolean(publicUrl && new URL(publicUrl).protocol === 'https:') } catch {}
  try { validAuth = Boolean(authUrl && new URL(authUrl).protocol === 'https:') } catch {}
  const aligned = Boolean(publicUrl && authUrl && publicUrl.replace(/\/$/, '') === authUrl.replace(/\/$/, ''))
  return [
    {
      key: 'public-url', category: 'Domain', label: 'Public URL',
      status: validPublic ? 'PASS' : 'BLOCKED', required: true, secret: false,
      detail: validPublic ? 'Public URL is configured for HTTPS.' : 'A production HTTPS public URL is required.',
      remediation: 'Set NEXT_PUBLIC_APP_URL to the final HTTPS client URL.',
    },
    {
      key: 'auth-url', category: 'Domain', label: 'Authentication URL',
      status: validAuth ? 'PASS' : 'BLOCKED', required: true, secret: false,
      detail: validAuth ? 'Authentication URL is configured for HTTPS.' : 'A production HTTPS authentication URL is required.',
      remediation: 'Set NEXTAUTH_URL to the final HTTPS client URL.',
    },
    {
      key: 'url-alignment', category: 'Domain', label: 'URL alignment',
      status: aligned ? 'PASS' : 'BLOCKED', required: true, secret: false,
      detail: aligned ? 'Public and authentication URLs agree.' : 'Public and authentication URLs do not match.',
      remediation: 'Use the same final client URL for NEXT_PUBLIC_APP_URL and NEXTAUTH_URL.',
    },
    {
      key: 'domain-ownership', category: 'Domain', label: 'Domain ownership and DNS',
      status: 'MANUAL', required: false, secret: false,
      detail: 'The application cannot prove DNS ownership from environment values alone.',
      remediation: 'Verify DNS points to the production deployment and HTTPS is active.',
    },
  ]
}

export function getNextFactoryAction(checks: LaunchCheck[]): NextAction {
  const firstBlocked = checks.find((check) => check.status === 'BLOCKED')
  if (firstBlocked) return { key: firstBlocked.key, title: firstBlocked.label, detail: firstBlocked.remediation, category: firstBlocked.category }
  const manual = checks.find((check) => check.status === 'MANUAL')
  if (manual) return { key: manual.key, title: manual.label, detail: manual.remediation, category: manual.category }
  const warning = checks.find((check) => check.status === 'WARNING')
  if (warning) return { key: warning.key, title: warning.label, detail: warning.remediation, category: warning.category }
  return { key: 'final-review', title: 'Complete the final launch review', detail: 'Confirm the live booking, notification, and customer-facing experience before launch.', category: 'Final review' }
}

export function deriveLaunchStage(checks: LaunchCheck[]): LaunchStage {
  if (checks.some((check) => check.status === 'BLOCKED' && check.category === 'Environment')) return 'DEPLOYMENT_PREFLIGHT'
  if (checks.some((check) => check.status === 'BLOCKED' && check.category === 'Database')) return 'DATABASE_READY'
  if (checks.some((check) => check.status === 'BLOCKED' && check.category === 'Client')) return 'ONBOARDING'
  if (checks.some((check) => check.status === 'BLOCKED')) return 'CONFIGURATION_READY'
  if (checks.some((check) => check.status === 'MANUAL')) return 'FINAL_REVIEW'
  return 'READY_TO_LAUNCH'
}

export function buildFactoryLaunchReport(checks: LaunchCheck[]): FactoryLaunchReport {
  const blocked = checks.filter((check) => check.status === 'BLOCKED').length
  const warnings = checks.filter((check) => check.status === 'WARNING').length
  const manual = checks.filter((check) => check.status === 'MANUAL').length
  const passed = checks.filter((check) => check.status === 'PASS').length
  const overall = blocked > 0 ? 'BLOCKED' : manual > 0 ? 'MANUAL_REVIEW' : warnings > 0 ? 'ACTION_REQUIRED' : 'READY'
  return {
    overall,
    stage: deriveLaunchStage(checks),
    counts: { passed, blocked, warnings, manual },
    nextAction: getNextFactoryAction(checks),
    checks,
  }
}

function readinessChecks(readiness: Awaited<ReturnType<typeof verifyFactoryReadiness>>): LaunchCheck[] {
  return readiness.checks.map((check: FactoryReadinessCheck) => ({
    key: `${check.category.toLowerCase()}-${check.check.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    category: check.category,
    label: check.check,
    status: check.kind === 'optional_disabled' ? 'DISABLED' : check.status === 'FAIL' ? 'BLOCKED' : check.status === 'WARN' ? 'WARNING' : 'PASS',
    required: check.kind !== 'optional_disabled',
    secret: false,
    detail: check.detail,
    remediation: check.status === 'PASS' ? 'No action required.' : check.detail,
  }))
}

export async function verifyFactoryLaunch(businessId: string): Promise<FactoryLaunchReport> {
  const readiness = await verifyFactoryReadiness(businessId)
  const checks = [
    ...buildDeploymentPreflight(),
    ...readinessChecks(readiness),
    {
      key: 'migrations', category: 'Database', label: 'Migration status',
      status: 'MANUAL' as const, required: true, secret: false,
      detail: 'Runtime migration status is not safely determined by the owner dashboard.',
      remediation: 'Run reviewed migrations through the deployment pipeline and confirm the deployment reports success.',
    },
    {
      key: 'tenant-binding', category: 'Tenant', label: 'Deployment binding',
      status: process.env.SINGLE_BUSINESS_ID ? 'PASS' as const : 'MANUAL' as const,
      required: false, secret: false,
      detail: process.env.SINGLE_BUSINESS_ID ? 'A single-business deployment binding is configured.' : 'This deployment is not explicitly bound to one business.',
      remediation: process.env.SINGLE_BUSINESS_ID ? 'No action required.' : 'Confirm hostname-based tenant resolution or configure the deployment binding through an authorized operator workflow.',
    },
    ...evaluateDomainReadiness(),
    {
      key: 'automated-tests', category: 'Testing', label: 'Automated test suite',
      status: 'MANUAL' as const, required: true, secret: false,
      detail: 'The application does not execute the repository test suite from the owner dashboard.',
      remediation: 'Run npm run test:all in the deployment environment and record the result.',
    },
    {
      key: 'live-acceptance', category: 'Testing', label: 'Live acceptance test',
      status: 'MANUAL' as const, required: true, secret: false,
      detail: 'A live booking and notification test requires human approval and cleanup.',
      remediation: 'Create one test appointment, confirm the customer experience, verify the notification, and cancel it.',
    },
  ]
  return buildFactoryLaunchReport(checks)
}
