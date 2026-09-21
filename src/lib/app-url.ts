const LOCAL_APP_URL = 'http://localhost:3000'

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return LOCAL_APP_URL
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/, '') || LOCAL_APP_URL
}

export function getAppUrl(): URL {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const deploymentUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  const fallbackUrl = process.env.NODE_ENV === 'production'
    ? deploymentUrl
    : LOCAL_APP_URL

  if (!configuredUrl && !fallbackUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL or a Vercel deployment URL is required in production.')
  }

  return new URL(normalizeUrl(configuredUrl || fallbackUrl || LOCAL_APP_URL))
}

export function getAppUrlString(): string {
  return getAppUrl().toString().replace(/\/$/, '')
}

export function getAbsoluteUrl(path = '/'): string {
  return new URL(path, getAppUrl()).toString()
}

export function getConfiguredAppUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined
}
