import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export const RATE_LIMITS = {
  BOOKING: { windowMs: 60_000, maxRequests: 10 },
  AVAILABILITY: { windowMs: 60_000, maxRequests: 30 },
  LOOKUP: { windowMs: 60_000, maxRequests: 5 },
  CONTACT: { windowMs: 60_000, maxRequests: 3 },
  QUEUE: { windowMs: 60_000, maxRequests: 5 },
  CUSTOMER_ACTION: { windowMs: 60_000, maxRequests: 10 },
  AUTH: { windowMs: 60_000, maxRequests: 5 },
  PASSWORD_RESET: { windowMs: 60_000, maxRequests: 3 },
  PORTAL_LOOKUP: { windowMs: 60_000, maxRequests: 5 },
  DASHBOARD: { windowMs: 60_000, maxRequests: 60 },
  API: { windowMs: 60_000, maxRequests: 30 },
} as const

const hasSharedStore = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
const redis = hasSharedStore ? Redis.fromEnv() : null
const localWindows = new Map<string, { count: number; resetAt: number }>()
const MAX_LOCAL_KEYS = 10_000

export function isAuthorizedCILocalMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.VERCEL !== '1' && env.RATE_LIMIT_CI_IN_MEMORY === 'true'
}

function algorithm(config: RateLimitConfig) {
  return Ratelimit.slidingWindow(config.maxRequests, `${Math.max(1, Math.ceil(config.windowMs / 1000))} s`)
}

function localRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const current = localWindows.get(key)
  if (!current || now >= current.resetAt) {
    if (!current && localWindows.size >= MAX_LOCAL_KEYS) {
      return { allowed: false, remaining: 0, resetAt: now + config.windowMs }
    }
    const next = { count: 1, resetAt: now + config.windowMs }
    localWindows.set(key, next)
    return { allowed: true, remaining: Math.max(0, config.maxRequests - 1), resetAt: next.resetAt }
  }
  if (current.count >= config.maxRequests) return { allowed: false, remaining: 0, resetAt: current.resetAt }
  current.count += 1
  return { allowed: true, remaining: config.maxRequests - current.count, resetAt: current.resetAt }
}

/** Shared Redis limiter. Production fails closed when Redis is unavailable. */
export async function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  if (isAuthorizedCILocalMode()) return localRateLimit(key, config)
  if (!redis) {
    if (process.env.NODE_ENV === 'production' || process.env.APP_MODE === 'production') {
      return { allowed: false, remaining: 0, resetAt: Date.now() + config.windowMs }
    }
    return localRateLimit(key, config)
  }

  try {
    const result = await new Ratelimit({ redis, limiter: algorithm(config), prefix: 'barber:rate-limit' }).limit(key)
    return {
      allowed: result.success,
      remaining: Math.max(0, result.remaining),
      resetAt: result.reset,
    }
  } catch (error) {
    console.error('[rate-limit] shared store unavailable', error instanceof Error ? error.message : 'unknown error')
    return { allowed: false, remaining: 0, resetAt: Date.now() + config.windowMs }
  }
}

export async function isRateLimited(key: string, config: RateLimitConfig): Promise<boolean> {
  const result = await rateLimit(key, config)
  return !result.allowed
}

export function getClientIP(req: Request): string {
  const realIP = req.headers.get('x-real-ip')?.trim()
  if (realIP && isValidAddress(realIP)) return realIP
  if (process.env.VERCEL === '1') {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',').map((value) => value.trim())
    const vercelForwarded = forwarded?.[forwarded.length - 1]
    if (vercelForwarded && isValidAddress(vercelForwarded)) return vercelForwarded
  }
  return 'unknown'
}

function isValidAddress(value: string): boolean {
  return value.length <= 128 && /^[0-9a-fA-F:.]+$/.test(value)
}

export async function checkRateLimit(
  req: Request,
  endpoint: string,
  config: RateLimitConfig
): Promise<null | { status: number; body: { error: string; retryAfter: number } }> {
  const result = await rateLimit(`${getClientIP(req)}:${endpoint}`, config)
  if (!result.allowed) {
    return {
      status: 429,
      body: { error: 'Too many requests. Please try again in a moment.', retryAfter: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)) },
    }
  }
  return null
}
