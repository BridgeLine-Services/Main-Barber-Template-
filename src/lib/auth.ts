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

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { business: { select: { name: true } } },
          })

          if (!user) return null

          // Deactivated staff accounts cannot sign in (soft-deactivation)
          if (user.isActive === false) return null

          const passwordValid = await bcrypt.compare(credentials.password, user.passwordHash)
          if (!passwordValid) return null

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
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
        token.role = (user as any).role
        token.businessId = (user as any).businessId
        token.businessName = (user as any).businessName
        token.barberId = (user as any).barberId
      }
      // Self-heal stale claims: an owner who signed in BEFORE creating their
      // business carries businessId=null in the JWT. Once the business exists,
      // resolve it from the DB so tenant-scoped routes (which read the claim)
      // work immediately after onboarding — no re-login required.
      if ((!token.businessId || ((token.role as string) === 'BARBER' && !token.barberId)) && token.sub) {
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
        if ((token.role as string) === 'BARBER' && !token.barberId && dbUser?.barberId) {
          token.barberId = dbUser.barberId
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        // token.sub is the user's DB id (NextAuth default) — expose it so
        // API routes can resolve the DB user authoritatively.
        ;(session.user as any).id = token.sub
        ;(session.user as any).role = token.role
        ;(session.user as any).businessId = token.businessId
        ;(session.user as any).businessName = token.businessName
        ;(session.user as any).barberId = token.barberId
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
