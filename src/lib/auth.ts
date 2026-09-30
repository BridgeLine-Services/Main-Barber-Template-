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
import { rateLimit, isRateLimited, RATE_LIMITS } from './rate-limit'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        // Brute-force protection: per-IP and per-account sliding windows.
        // Counted on every attempt (success or failure) so credential
        // stuffing from one source is throttled regardless of outcome.
        const ip =
          (req?.headers && (req.headers as Record<string, string | string[] | undefined>)['x-forwarded-for']?.toString().split(',')[0].trim()) ||
          (req?.headers && (req.headers as Record<string, string | string[] | undefined>)['x-real-ip']?.toString()) ||
          'unknown'
        // Failed-attempt throttle: successful sign-ins never consume the
        // budget, so normal users and shared-IP offices are unaffected.
        // Per-IP is generous to tolerate shared-IP offices; per-account
        // stops targeted brute force on one login.
        const ipKey = `login-fail-ip:${ip}`
        const accountKey = `login-fail-account:${credentials.email.toLowerCase()}`
        if (
          isRateLimited(ipKey, { windowMs: 60_000, maxRequests: 10 }) ||
          isRateLimited(accountKey, RATE_LIMITS.AUTH)
        ) return null

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { business: { select: { name: true, deactivatedAt: true } } },
          })

          if (!user) {
            rateLimit(ipKey, { windowMs: 60_000, maxRequests: 10 })
            rateLimit(accountKey, RATE_LIMITS.AUTH)
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
            rateLimit(ipKey, { windowMs: 60_000, maxRequests: 10 })
            rateLimit(accountKey, RATE_LIMITS.AUTH)
            return null
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
      if (user) {
        token.role = user.role as typeof token.role
        token.customerId = (user as { customerId?: string | null }).customerId ?? null
        token.businessId = user.businessId as string | null
        token.businessName = user.businessName as string | undefined
        token.barberId = user.barberId as string | null
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
