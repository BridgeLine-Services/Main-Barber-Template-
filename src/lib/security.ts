// ============================================================================
// Security Utilities
// Two-factor authentication helpers, password hashing, session security
// ============================================================================

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex')
}

// TOTP (RFC 6238) / HOTP (RFC 4226) helpers — standards-compliant HMAC-SHA1.
// NOTE: these are accurate utility functions, but two-factor authentication is
// NOT yet integrated into the authentication flow (no enrollment UI, no User
// schema fields, no session coupling). Do not treat the app as having 2FA until
// that integration is built on top of these helpers.

const TOTP_TIME_STEP = 30
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 encode (no padding), the format authenticator apps expect */
export function base32Encode(input: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

/** RFC 4648 base32 decode (case-insensitive, padding ignored) */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * Generate a TOTP secret for 2FA enrollment.
 * 20 random bytes, base32-encoded — the format Google Authenticator and
 * compatible apps accept directly in an otpauth:// URI.
 */
export function generateTOTPSecret(): string {
  return base32Encode(randomBytes(20))
}

/** HOTP: HMAC-SHA1 over the 8-byte big-endian counter, dynamic truncation (RFC 4226 §5.3) */
export function generateHOTP(secret: Buffer, counter: number, digits: number = 6): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

/** TOTP code for a base32 secret at a given unix time (default: now) — RFC 6238 */
export function generateTOTPCode(secret: string, timestampSeconds: number = Math.floor(Date.now() / 1000), digits: number = 6): string {
  return generateHOTP(base32Decode(secret), Math.floor(timestampSeconds / TOTP_TIME_STEP), digits)
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * Allows ±window time steps of clock drift. Malformed codes are rejected
 * before any comparison; comparisons are constant-time.
 */
export function verifyTOTP(token: string, secret: string, window: number = 1): boolean {
  const code = token.trim()
  if (!/^\d{6}$/.test(code)) return false
  const secretBuffer = base32Decode(secret)
  if (secretBuffer.length === 0) return false
  const counter = Math.floor(Math.floor(Date.now() / 1000) / TOTP_TIME_STEP)
  const codeBuffer = Buffer.from(code, 'utf8')
  for (let offset = -window; offset <= window; offset++) {
    const candidate = Buffer.from(generateHOTP(secretBuffer, counter + offset), 'utf8')
    if (candidate.length === codeBuffer.length && timingSafeEqual(candidate, codeBuffer)) {
      return true
    }
  }
  return false
}

/**
 * Generate backup codes for 2FA
 * Returns 10 single-use codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < 10; i++) {
    codes.push(randomBytes(4).toString('hex').toUpperCase())
  }
  return codes
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Verify a backup code against stored hashes
 */
export function verifyBackupCode(code: string, hashedCodes: string[]): boolean {
  const hash = hashBackupCode(code)
  return hashedCodes.includes(hash)
}

/**
 * Extract client IP from request headers
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIP = request.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

/**
 * Extract user agent from request
 */
export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown'
}

/**
 * Content Security Policy nonce for inline scripts
 */
export function generateCSPNonce(): string {
  return randomBytes(16).toString('base64')
}

/**
 * Password strength checker
 * Returns a score 0-4 and label
 */
export function checkPasswordStrength(password: string): { score: number; label: string; suggestions: string[] } {
  let score = 0
  const suggestions: string[] = []
  
  if (password.length >= 8) score++
  else suggestions.push('Use at least 10 characters')
  
  if (password.length >= 12) score++
  
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  else suggestions.push('Mix uppercase and lowercase letters')
  
  if (/\d/.test(password)) score++
  else suggestions.push('Include numbers')
  
  if (/[^a-zA-Z0-9]/.test(password)) score++
  else suggestions.push('Include special characters')
  
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']
  const clampedScore = Math.min(score, 4)
  
  return { score: clampedScore, label: labels[clampedScore], suggestions }
}

/**
 * Generate a session fingerprint for additional security
 */
export function generateSessionFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex')
}
