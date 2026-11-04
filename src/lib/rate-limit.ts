import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

/**
 * Why a limit decision came out the way it did. "exceeded" means the caller
 * genuinely used up the window; the store reasons mean we could not ask, which
 * is a different problem and must not be reported to the person as "you have
 * tried too many times".
 */
export type RateLimitReason = 'ok' | 'exceeded' | 'store_unavailable' | 'store_not_configured'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  reason: RateLimitReason
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
let redis = hasSharedStore ? Redis.fromEnv() : null

/**
 * Test seam: substitutes the shared store so a suite can simulate a provider
 * outage without real credentials. Refuses to exist in production, and only the
 * process it runs in is affected.
 */
export function setRateLimitStoreForTest(client: unknown) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setRateLimitStoreForTest is not available in production')
  }
  redis = (client as typeof redis) ?? null
}
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
      return { allowed: false, remaining: 0, resetAt: now + config.windowMs, reason: 'store_unavailable' }
    }
    const next = { count: 1, resetAt: now + config.windowMs }
    localWindows.set(key, next)
    return { allowed: true, remaining: Math.max(0, config.maxRequests - 1), resetAt: next.resetAt, reason: 'ok' }
  }
  if (current.count >= config.maxRequests) return { allowed: false, remaining: 0, resetAt: current.resetAt, reason: 'exceeded' }
  current.count += 1
  return { allowed: true, remaining: config.maxRequests - current.count, resetAt: current.resetAt, reason: 'ok' }
}

/** Shared Redis limiter. Production fails closed when Redis is unavailable. */
export async function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  if (isAuthorizedCILocalMode()) return localRateLimit(key, config)
  if (!redis) {
    if (process.env.NODE_ENV === 'production' || process.env.APP_MODE === 'production') {
      // Fail closed for safety, but say WHY: the person has not exceeded
      // anything, the deployment is missing its shared store.
      return { allowed: false, remaining: 0, resetAt: Date.now() + config.windowMs, reason: 'store_not_configured' }
    }
    return localRateLimit(key, config)
  }

  try {
    const result = await new Ratelimit({ redis, limiter: algorithm(config), prefix: 'barber:rate-limit' }).limit(key)
    return {
      allowed: result.success,
      remaining: Math.max(0, result.remaining),
      resetAt: result.reset,
      reason: result.success ? 'ok' : 'exceeded',
    }
  } catch (error) {
    console.error('[rate-limit] shared store unavailable', error instanceof Error ? error.message : 'unknown error')
    return { allowed: false, remaining: 0, resetAt: Date.now() + config.windowMs, reason: 'store_unavailable' }
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

export interface RateLimitDenial {
  status: 429 | 503
  body: { error: string; retryAfter: number }
  /** Informational: why the request was denied. */
  reason: Exclude<RateLimitReason, 'ok'>
  headers: { 'Retry-After': string }
}

/**
 * Map a limiter result to an HTTP answer.
 *
 * 429 means the caller really used up the window. 503 means we could not consult
 * the shared store — the visitor has done nothing wrong, and telling them they
 * "tried too many times" would be a lie that also hides an outage from the
 * operator. Neither message names Redis or any infrastructure detail.
 */
export function buildRateLimitDenial(result: RateLimitResult, now = Date.now()): RateLimitDenial | null {
  if (result.allowed) return null
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000))
  const reason = result.reason === 'ok' ? 'exceeded' : result.reason

  if (reason === 'exceeded') {
    return {
      status: 429,
      body: { error: 'You have tried too many times in the last minute. Please wait a minute and try again.', retryAfter },
      reason,
      headers: { 'Retry-After': String(retryAfter) },
    }
  }

  // 'store_unavailable' | 'store_not_configured'
  return {
    status: 503,
    body: { error: "We're temporarily unable to complete this request. Please try again in a minute.", retryAfter: Math.max(60, retryAfter) },
    reason,
    headers: { 'Retry-After': String(Math.max(60, retryAfter)) },
  }
}

export async function checkRateLimit(
  req: Request,
  endpoint: string,
  config: RateLimitConfig
): Promise<RateLimitDenial | null> {
  const result = await rateLimit(`${getClientIP(req)}:${endpoint}`, config)
  const denial = buildRateLimitDenial(result)
  if (denial && denial.reason !== 'exceeded') {
    // Operators need the cause; customers must not see it.
    console.error(`[rate-limit] denying ${endpoint}: ${denial.reason}`)
  }
  return denial
}

/** Build the response for a denial, carrying Retry-After. */
export function rateLimitResponse(denial: RateLimitDenial) {
  return NextResponse.json(denial.body, { status: denial.status, headers: denial.headers })
}

// ============================================================================
// Shared-store health
//
// Used by the launch-readiness system, not by request handling. It answers two
// questions an operator needs before selling a deployment: are the credentials
// present, and does the store actually answer? A missing variable and a rejected
// connection are very different problems (one is a form to fill in, the other an
// outage), so they are reported separately.
//
// It never spends a caller's rate-limit allowance: this is a store ping, not a
// window increment.
// ============================================================================

export type RateLimitStoreHealth =
  | { state: 'ok'; configured: true }
  | { state: 'not_configured'; configured: false; missing: string[] }
  | { state: 'unreachable'; configured: true; message: string }

export async function checkRateLimitStoreHealth(): Promise<RateLimitStoreHealth> {
  // CI runs deliberately use the in-memory limiter; there is nothing to ping.
  if (isAuthorizedCILocalMode()) return { state: 'ok', configured: true }

  const missing = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].filter(
    (name) => !process.env[name]?.trim(),
  )
  if (!redis) return { state: 'not_configured', configured: false, missing }

  try {
    // PING is the cheapest round trip Upstash supports.
    const reply = await redis.ping()
    if (String(reply).toUpperCase() === 'PONG') return { state: 'ok', configured: true }
    return { state: 'unreachable', configured: true, message: 'Store answered but not with PONG' }
  } catch (error) {
    // Deliberately generic: this string can reach an owner-facing screen.
    console.error('[rate-limit] health probe failed', error instanceof Error ? error.message : 'unknown error')
    return { state: 'unreachable', configured: true, message: 'Store did not answer' }
  }
}
