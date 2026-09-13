// ============================================================================
// Rate Limiting — In-memory sliding window per IP.
// For production with multiple serverless instances, upgrade to Redis or
// @upstash/ratelimit. This provides basic protection for a single instance.
// ============================================================================

interface RateLimitEntry {
  count: number
  resetTime: number
}

const limits = new Map<string, RateLimitEntry>()

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
 * Get client IP from request, accounting for Vercel's proxy headers.
 */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
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
