import { headers } from 'next/headers'
// ============================================================================
// AUTH — NextAuth v4 with Credentials provider (production).
// Uses Prisma to validate email/password against the User table.
// Requires NEXTAUTH_SECRET + NEXTAUTH_URL + DATABASE_URL env vars.
// ============================================================================

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { appConfig } from './app-config'
import { rateLimit, isRateLimited, isAuthorizedCILocalMode, RATE_LIMITS, getClientIP } from './rate-limit'
import { DEAD_CLAIM, PWD_CLAIM, SESSION_START_CLAIM, isSessionInvalidated, isSessionRevoked } from './session-security'
import { SID_CLAIM, createSession, isSessionAllowed, touchSession } from './session-registry'
import { consumeRecoveryCode, verifyEnrolledTotp } from './two-factor-enrollment'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        // Optional second factor. Only consulted when the account has 2FA on.
        twoFactorCode: { label: 'Authentication code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        // Brute-force protection: per-IP and per-account sliding windows.
        // Counted on every attempt (success or failure) so credential
        // stuffing from one source is throttled regardless of outcome.
        const ip = getClientIP(
          new Request('http://localhost', {
            headers: Object.entries((req?.headers || {}) as Record<string, string | string[] | undefined>).reduce(
              (headers, [name, value]) => {
                if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value)
                return headers
              },
              new Headers()
            ),
          })
        )
        // Failed-attempt throttle: successful sign-ins never consume the
        // budget, so normal users and shared-IP offices are unaffected.
        // Per-IP is generous to tolerate shared-IP offices; per-account
        // stops targeted brute force on one login.
        const ipKey = `login-fail-ip:${ip}`
        const accountKey = `login-fail-account:${credentials.email.toLowerCase()}`
        // Production values everywhere. The CI-local mode is separately
        // gated (CI + GITHUB_ACTIONS + RATE_LIMIT_CI_IN_MEMORY, never Vercel or
        // production) and a full regression run signs in from one IP far more
        // often than any human would, so the cap there is raised rather than
        // making the suite flaky. The throttle itself is still exercised by the
        // password-reset and registration suites, which assert their own 429s.
        const ciLocal = isAuthorizedCILocalMode()
        const ipLimit = ciLocal ? { windowMs: 60_000, maxRequests: 400 } : { windowMs: 60_000, maxRequests: 10 }
        const accountLimit = ciLocal ? { windowMs: 60_000, maxRequests: 60 } : RATE_LIMITS.AUTH
        if (
          await isRateLimited(ipKey, ipLimit) ||
          await isRateLimited(accountKey, accountLimit)
        ) return null

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { business: { select: { name: true, deactivatedAt: true } } },
          })

          if (!user) {
            await rateLimit(ipKey, { windowMs: 60_000, maxRequests: 10 })
            await rateLimit(accountKey, RATE_LIMITS.AUTH)
            return null
          }

          // Deactivated staff accounts cannot sign in (soft-deactivation)
          if (user.isActive === false) return null

          // A deactivated business blocks staff sign-in. Owners keep access
          // so they can export data and reactivate the shop.
          // A deactivated business blocks staff sign-in. Owners keep access
          // so they can export data and reactivate the shop. Platform
          // owners are business-independent and always retain access.
          if (user.business?.deactivatedAt && user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER') return null

          const passwordValid = await bcrypt.compare(credentials.password, user.passwordHash)
          if (!passwordValid) {
            await rateLimit(ipKey, { windowMs: 60_000, maxRequests: 10 })
            await rateLimit(accountKey, RATE_LIMITS.AUTH)
            return null
          }

          // Two-factor gate. Password alone is not enough once enrolment is
          // confirmed. A missing or wrong code returns null — the same shape
          // as a wrong password — so the response cannot be used to probe
          // whether an account exists or is protected.
          if (user.twoFactorEnabled) {
            const code = (credentials.twoFactorCode || '').trim()
            if (!code) return null
            const twoFactorOk = /^\d{6}$/.test(code)
              ? await verifyEnrolledTotp(user.id, code)
              : await consumeRecoveryCode(user.id, code)
            if (!twoFactorOk) {
              await rateLimit(`2fa-fail:${user.id}`, { windowMs: 60_000, maxRequests: 6 })
              return null
            }
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            customerId: user.customerId,
            // businessId may be null for owners who haven't completed onboarding yet
            businessId: user.businessId || '',
            businessName: user.business?.name || 'Barber Shop',
            barberId: user.barberId,
            // Session-security stamp: captured into the JWT at sign-in so the
            // jwt callback can detect later password changes and kill stale
            // sessions (see src/lib/session-security.ts).
            passwordChangedAt: user.passwordChangedAt,
          }
        } catch (error) {
          console.error('[auth] credential lookup failed', error instanceof Error ? error.message : 'unknown error')
          throw new Error('Authentication service unavailable')
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // A session already marked dead stays dead — skip all further work.
      if ((token as { [DEAD_CLAIM]?: boolean })[DEAD_CLAIM]) return token
      if (user) {
        token.role = user.role as typeof token.role
        token.customerId = (user as { customerId?: string | null }).customerId ?? null
        token.businessId = user.businessId as string | null
        token.businessName = user.businessName as string | undefined
        token.barberId = user.barberId as string | null
        // Stamp the account's passwordChangedAt at sign-in. Sessions minted
        // before this mechanism have no stamp and are grandfathered.
        ;(token as Record<string, unknown>)[PWD_CLAIM] =
          (user as { passwordChangedAt?: Date | null }).passwordChangedAt?.getTime() ?? null
        // When this session signed in. "Sign out of all devices" kills every
        // session whose start is older than the account's cutoff.
        ;(token as Record<string, unknown>)[SESSION_START_CLAIM] = Date.now()
        // Register this device so the owner can see and end it individually.
        // Failure here must not block a legitimate sign-in: the account-wide
        // controls (password change, sign out everywhere) still protect it.
        if (user.id) {
          try {
            // The jwt callback has no request argument, so the headers come
            // from the current request scope. Absent (edge cases), the device is
            // simply recorded as "Unknown device" — it is a label, not a
            // security decision.
            let userAgent: string | null = null
            let ip: string | null = null
            try {
              const h = await headers()
              userAgent = h.get('user-agent')
              ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')
            } catch {
              // No request scope; leave the labels empty.
            }
            const sessionId = await createSession({ userId: user.id, userAgent, ip })
            ;(token as Record<string, unknown>)[SID_CLAIM] = sessionId
          } catch (error) {
            console.error('[auth] could not register session', error instanceof Error ? error.message : 'unknown')
          }
        }
      }
      // Session invalidation: if the account's password changed AFTER this
      // session was issued, the session is dead (e.g. an attacker holding a
      // pre-change cookie after the owner rotated the password).
      if (token.sub) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { passwordChangedAt: true, sessionsValidAfter: true },
        })
        // Deleted account: no session may outlive the row.
        if (!fresh) return { [DEAD_CLAIM]: true } as typeof token
        // Password changed after this session was minted.
        if (isSessionInvalidated(fresh.passwordChangedAt, (token as Record<string, unknown>)[PWD_CLAIM] as number)) {
          return { [DEAD_CLAIM]: true } as typeof token
        }
        // Explicit revocation ("sign out of all devices"). Deliberately NOT
        // nested inside the password-stamp check: an account that never
        // changed its password has a null stamp, and that must not disable
        // revocation. Sessions minted before the cutoff die; the one that
        // pressed the button survives because its stamp is at or after it.
        if (
          isSessionRevoked(
            fresh.sessionsValidAfter,
            (token as Record<string, unknown>)[SESSION_START_CLAIM] as number | undefined,
          )
        ) {
          return { [DEAD_CLAIM]: true } as typeof token
        }
        // One device revoked from the browser (not a signed-out-everywhere
        // cutoff). Same guarantee: enforced here, so the device dies on its next
        // request rather than whenever its token happens to expire.
        const sessionId = (token as Record<string, unknown>)[SID_CLAIM] as string | undefined
        if (sessionId) {
          if (!(await isSessionAllowed(sessionId, token.sub))) {
            return { [DEAD_CLAIM]: true } as typeof token
          }
          void touchSession(sessionId)
        }
      }
      // Self-heal stale claims: an owner who signed in BEFORE creating their
      // business carries businessId=null in the JWT. Once the business exists,
      // resolve it from the DB so tenant-scoped routes (which read the claim)
      // work immediately after onboarding — no re-login required.
      if ((!token.businessId || (token.role === 'BARBER' && !token.barberId)) && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            businessId: true,
            barberId: true,
            business: { select: { name: true } },
          },
        })
        if (!token.businessId && dbUser?.businessId) {
          token.businessId = dbUser.businessId
          token.businessName = dbUser.business?.name
        }
        // Self-heal barberId the same way: a BARBER whose profile was linked
        // (or created) AFTER they signed in would otherwise carry barberId=null
        // until the next login, making Barber Mode reject them incorrectly.
        if (token.role === 'BARBER' && !token.barberId && dbUser?.barberId) {
          token.barberId = dbUser.barberId
        }
      }
      return token
    },
    async session({ session, token }) {
      // Dead (password-invalidated) sessions resolve to NO session: the null
      // body propagates through getServerSession, so every guard —
      // `!session` and `!session?.user` alike — treats the request as
      // unauthenticated. Never return a user-less session object here: some
      // routes pass session.user.businessId (undefined) into Prisma where
      // it would be dropped from the filter.
      if ((token as { [DEAD_CLAIM]?: boolean })[DEAD_CLAIM]) {
        return null as unknown as typeof session
      }
      if (session.user) {
        // token.sub is the user's DB id (NextAuth default) — expose it so
        // API routes can resolve the DB user authoritatively.
        ;session.user.id = token.sub
        ;session.user.role = token.role
        ;session.user.customerId = token.customerId ?? null
        ;session.user.businessId = token.businessId
        ;session.user.businessName = token.businessName
        ;session.user.barberId = token.barberId
      }
      return session
    },
  },
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  // AUTH AUDIT EVENTS — LOGIN / LOGOUT are recorded for every account type.
  // Audit failures must never break authentication (best-effort writes).
  events: {
    async signIn({ user }) {
      try {
        const u = user as { id?: string; email?: string; businessId?: string | null; role?: string }
        if (!u?.id) return
        await prisma.auditLog.create({
          data: {
            businessId: u.businessId || null,
            userId: u.id,
            action: 'LOGIN_SUCCESS',
            entityType: 'User',
            entityId: u.id,
            newValues: { email: u.email, role: u.role },
            description: `Signed in (${u.role || 'unknown role'})`,
          },
        })
      } catch (e) {
        console.error('[auth] login audit failed', e instanceof Error ? e.message : 'unknown')
      }
    },
    async signOut(message) {
      try {
        const token = (message as { token?: { sub?: string; email?: string; role?: string; businessId?: string | null } }).token
        if (!token?.sub) return
        await prisma.auditLog.create({
          data: {
            businessId: token.businessId || null,
            userId: token.sub,
            action: 'LOGOUT',
            entityType: 'User',
            entityId: token.sub,
            newValues: { email: token.email , description: 'Signed out' },
          },
        })
      } catch (e) {
        console.error('[auth] logout audit failed', e instanceof Error ? e.message : 'unknown')
      }
    },
  },
  // Session secret. In production the app REFUSES to boot with a fallback —
  // a guessable secret would let anyone forge session JWTs.
  secret: (() => {
    if (process.env.NEXTAUTH_SECRET) return process.env.NEXTAUTH_SECRET
    if (appConfig.isProduction) {
      throw new Error(
        'NEXTAUTH_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your environment.'
      )
    }
    // Local development only — never used when APP_MODE=production
    return 'dev-only-secret-not-for-production'
  })(),
}

// Re-export getServerSession for convenience
export { getServerSession } from 'next-auth'
