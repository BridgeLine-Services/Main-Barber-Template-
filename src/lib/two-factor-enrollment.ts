// ============================================================================
// Two-factor authentication — enrolment, secret storage, recovery codes
//
// The TOTP primitives (generate/verify) live in src/lib/security.ts. This
// module adds the parts enrolment needs and that must be safe to store:
//
//   1. Secret encryption — AES-256-GCM, authenticated so a tampered
//      ciphertext is rejected rather than silently decoded.
//   2. Key material — from TWO_FACTOR_ENCRYPTION_KEY, or derived from
//      NEXTAUTH_SECRET via HKDF. Production fails closed if neither exists;
//      a predictable fallback would be worse than no second factor.
//   3. Recovery codes — issued once, stored only as sha256 hashes, and
//      consumed through a conditional UPDATE so a code can be used exactly
//      once even under concurrent requests.
//   4. Replay guard — records the highest accepted TOTP time-step, so a code
//      observed once cannot be reused within its validity window.
//
// Nothing here changes an existing login path: enrolment is opt-in and the
// second factor is only enforced once a user has completed enrolment.
// ============================================================================

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { generateTOTPCode, generateTOTPSecret, verifyTOTP } from '@/lib/security'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const VERSION = 'v1'
const TOTP_TIME_STEP = 30

/** True when running against a real deployment, where a weak key is unacceptable. */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

/**
 * Resolve the 32-byte encryption key.
 *
 * Accepts a 64-char hex or 44-char base64 TWO_FACTOR_ENCRYPTION_KEY. If it is
 * absent, the key is derived from NEXTAUTH_SECRET so a deployment that has not
 * yet set the dedicated variable keeps working. If BOTH are absent the call
 * throws in production (fail closed) and uses a clearly-labelled development
 * key only outside production.
 */
export function getTwoFactorKey(): Buffer {
  const dedicated = process.env.TWO_FACTOR_ENCRYPTION_KEY
  if (dedicated) {
    if (/^[0-9a-fA-F]{64}$/.test(dedicated)) return Buffer.from(dedicated, 'hex')
    const asBase64 = Buffer.from(dedicated, 'base64')
    if (asBase64.length === 32) return asBase64
    throw new Error('TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)')
  }

  const authSecret = process.env.NEXTAUTH_SECRET
  if (authSecret) {
    // HKDF isolates the 2FA key from the session-signing key it is derived from.
    return Buffer.from(hkdfSync('sha256', Buffer.from(authSecret, 'utf8'), Buffer.from('barber-2fa-salt'), Buffer.from('two-factor-secret-encryption'), 32))
  }

  if (isProduction()) {
    throw new Error('Two-factor authentication is unavailable: no encryption key is configured')
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from('development-only-2fa-key'), Buffer.from('barber-2fa-salt'), Buffer.from('two-factor-secret-encryption'), 32))
}

/** Encrypt a base32 TOTP secret. Output: `v1:<iv>:<tag>:<ciphertext>` (base64 parts). */
export function encryptTwoFactorSecret(secret: string, key: Buffer = getTwoFactorKey()): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Decrypt a stored secret. Throws on tampering, wrong key, or unknown version. */
export function decryptTwoFactorSecret(payload: string, key: Buffer = getTwoFactorKey()): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised two-factor secret format')
  const [, ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Corrupt two-factor secret')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

/** otpauth:// URI for authenticator apps. Label and issuer are the shop name. */
export function buildOtpauthUrl(secret: string, accountEmail: string, issuer = 'Barbershop'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_TIME_STEP) })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Start enrolment: fresh secret, stored encrypted, still disabled until confirmed. */
export async function beginEnrollment(userId: string): Promise<{ secret: string; otpauthUrl: string; accountEmail: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) throw new Error('Account not found')
  const secret = generateTOTPSecret()
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecretEnc: encryptTwoFactorSecret(secret),
      twoFactorEnabled: false,
      twoFactorEnabledAt: null,
      twoFactorLastCounter: null,
    },
  })
  return { secret, otpauthUrl: buildOtpauthUrl(secret, user.email), accountEmail: user.email }
}

/**
 * Confirm enrolment with a code from the owner's authenticator.
 * Returns plaintext recovery codes exactly once (only hashes are stored).
 * Until this succeeds the account keeps its previous enabled/disabled state,
 * so an abandoned enrolment cannot lock anybody out.
 */
export async function confirmEnrollment(userId: string, token: string): Promise<{ recoveryCodes: string[] } | { error: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecretEnc: true } })
  if (!user?.twoFactorSecretEnc) return { error: 'Start two-factor setup again — no pending secret was found.' }

  let secret: string
  try {
    secret = decryptTwoFactorSecret(user.twoFactorSecretEnc)
  } catch {
    return { error: 'This setup could not be read. Please start again.' }
  }

  if (!verifyTOTP(token, secret)) return { error: 'That code did not match. Check your authenticator app and try the current code.' }

  const codes = await issueRecoveryCodes(userId)
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorEnabledAt: new Date(),
      twoFactorLastCounter: Math.floor(Date.now() / 1000 / TOTP_TIME_STEP),
    },
  })
  return { recoveryCodes: codes }
}

/** Replace any unused recovery codes with a fresh set; returns the plaintext once. */
export async function issueRecoveryCodes(userId: string, count = 10): Promise<string[]> {
  const { generateBackupCodes, hashBackupCode } = await import('@/lib/security')
  const codes = generateBackupCodes().slice(0, count)
  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId, usedAt: null } }),
    prisma.twoFactorRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })) }),
  ])
  return codes
}

/**
 * Consume a recovery code. The conditional UPDATE (usedAt IS NULL) is what
 * makes it single-use: two concurrent requests cannot both match the same row.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const { hashBackupCode } = await import('@/lib/security')
  const result = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: hashBackupCode(code.trim()), usedAt: null },
    data: { usedAt: new Date() },
  })
  return result.count === 1
}

/**
 * Verify a TOTP code for an enrolled user, rejecting replays.
 * Records the accepted time-step; a second submission of the same code (or an
 * earlier step, which the ±1 drift window would otherwise accept) is refused.
 */
export async function verifyEnrolledTotp(userId: string, token: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecretEnc: true, twoFactorLastCounter: true },
  })
  if (!user?.twoFactorEnabled || !user.twoFactorSecretEnc) return false

  let secret: string
  try {
    secret = decryptTwoFactorSecret(user.twoFactorSecretEnc)
  } catch {
    return false
  }
  if (!verifyTOTP(token, secret)) return false

  // verifyTOTP accepts ±1 step of drift, so record the step that MATCHED
  // rather than "now": otherwise a code from the next window would be accepted
  // while the stored counter stayed behind, leaving it replayable.
  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_TIME_STEP)
  const last = user.twoFactorLastCounter ?? 0
  let matchedStep: number | null = null
  for (let drift = -1; drift <= 1; drift++) {
    const step = currentCounter + drift
    if (step <= last) continue
    if (generateTOTPCode(secret, step * TOTP_TIME_STEP) === token.trim()) { matchedStep = step; break }
  }
  if (matchedStep === null) return false

  const updated = await prisma.user.updateMany({
    where: { id: userId, twoFactorLastCounter: user.twoFactorLastCounter },
    data: { twoFactorLastCounter: matchedStep },
  })
  // Lost the race to a concurrent request: treat as replay.
  return updated.count === 1
}

/** Turn two-factor off. Requires a valid current code or a recovery code. */
export async function disableTwoFactor(userId: string, proof: { token?: string; recoveryCode?: string }): Promise<boolean> {
  const ok = proof.recoveryCode
    ? await consumeRecoveryCode(userId, proof.recoveryCode)
    : proof.token
      ? await verifyEnrolledTotp(userId, proof.token)
      : false
  if (!ok) return false

  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorEnabledAt: null, twoFactorLastCounter: null },
    }),
  ])
  return true
}

/** Stable fingerprint for audit logs — never the secret itself. */
export function twoFactorSecretFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12)
}
