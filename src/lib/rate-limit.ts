// ============================================================================
// Rate limiting — bounded in-memory sliding window.
//
// This is intentionally a local fallback because no shared store is enabled
// for this deployment. It protects each instance, but does not provide a
// global counter across serverless instances. Do not treat it as the sole
// control for a high-risk production endpoint until a shared store is added.
// ============================================================================

interface RateLimitEntry {
  count: number
  resetTime: number
}

const limits = new Map<string, RateLimitEntry>()
const MAX_TRACKED_KEYS = 10_000

// Clean expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of limits.entries()) {
    if (now > entry.resetTime) {
      limits.delete(key)
    }
  }
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

// Default presets per endpoint category
export const RATE_LIMITS = {
  // Public booking: 10 per minute per IP
  BOOKING: { windowMs: 60_000, maxRequests: 10 },
  // Availability checks: 30 per minute per IP
  AVAILABILITY: { windowMs: 60_000, maxRequests: 30 },
  // Appointment lookup: 5 per minute per IP (brute-force protection)
  LOOKUP: { windowMs: 60_000, maxRequests: 5 },
  // Contact form: 3 per minute per IP
  CONTACT: { windowMs: 60_000, maxRequests: 3 },
  QUEUE: { windowMs: 60_000, maxRequests: 5 },
  // Cancel/reschedule by token: 10 per minute per IP
  CUSTOMER_ACTION: { windowMs: 60_000, maxRequests: 10 },
  // Auth: 5 per minute per IP
  AUTH: { windowMs: 60_000, maxRequests: 5 },
  // Password reset: 3 per minute per IP (stricter to prevent abuse)
  PASSWORD_RESET: { windowMs: 60_000, maxRequests: 3 },
  // Customer portal lookup: 5 per minute per IP (prevents customer enumeration)
  PORTAL_LOOKUP: { windowMs: 60_000, maxRequests: 5 },
  // Dashboard API: 60 per minute per IP
  DASHBOARD: { windowMs: 60_000, maxRequests: 60 },
  // Generic API: 30 per minute
  API: { windowMs: 60_000, maxRequests: 30 },
} as const

export function rateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup()

  const now = Date.now()
  const entry = limits.get(key)
  if (!entry && limits.size >= MAX_TRACKED_KEYS) {
    // Avoid unbounded memory growth when an attacker rotates identifiers.
    // Fail closed for a new key until expired entries are collected.
    return { allowed: false, remaining: 0, resetAt: now + config.windowMs }
  }

  if (!entry || now > entry.resetTime) {
    // New window
    limits.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    })
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
    }
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetTime,
    }
  }

  entry.count++
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetTime,
  }
}

/**
 * Check whether a key is currently rate limited WITHOUT consuming an
 * attempt. Use for counters that should only increment on failure
 * (e.g. login attempts).
 */
export function isRateLimited(key: string, config: RateLimitConfig): boolean {
  cleanup()
  const entry = limits.get(key)
  return !!entry && entry.count >= config.maxRequests && Date.now() <= entry.resetTime
}

/**
 * Get a stable client identifier without trusting spoofable forwarding headers.
 * Vercel supplies x-real-ip at the edge; x-forwarded-for is only accepted
 * when the runtime explicitly identifies itself as Vercel. Self-hosted
 * deployments therefore use the request's direct peer or an anonymous bucket.
 */
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

/**
 * Apply rate limiting to a request. Returns null if allowed, or a
 * NextResponse with 429 if rate limit exceeded.
 */
export function checkRateLimit(
  req: Request,
  endpoint: string,
  config: RateLimitConfig
): null | { status: number; body: { error: string; retryAfter: number } } {
  const ip = getClientIP(req)
  const key = `${ip}:${endpoint}`
  const result = rateLimit(key, config)

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
    return {
      status: 429,
      body: {
        error: 'Too many requests. Please try again in a moment.',
        retryAfter,
      },
    }
  }

  return null
}
