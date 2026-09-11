// ============================================================================
// Auth Helpers — Authorization layer for API routes.
// Uses NextAuth session (production).
// ============================================================================

import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { logEvent } from './logger'

export interface AuthResult {
  success: true
  session: any
  user: {
    id: string
    email: string
    name: string
    role: 'OWNER' | 'BARBER'
    businessId: string | null
    barberId?: string | null
  }
  response?: never
}

export interface AuthError {
  success: false
  response: NextResponse
}

/**
 * Require any authenticated user (OWNER or BARBER).
 */
export async function requireAuth(): Promise<AuthResult | AuthError> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // JWT claims are a session cache and may outlive a membership/role change.
  // Resolve the user from the database for every protected API request so a
  // deleted user or moved tenant cannot keep using an old token.
  const sessionUser = session.user as any
  const dbUser = await prisma.user.findUnique({
    where: sessionUser.id ? { id: sessionUser.id } : { email: sessionUser.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      businessId: true,
      barberId: true,
    },
  })
  if (!dbUser) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return {
    success: true,
    session,
    user: dbUser as AuthResult['user'],
  }
}

/**
 * Require OWNER role only. Barbers get 403.
 */
export async function requireOwner(): Promise<AuthResult | AuthError> {
  const auth = await requireAuth()
  if (!auth.success) return auth

  if (auth.user.role !== 'OWNER') {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Forbidden: Owner access required' },
        { status: 403 }
      ),
    }
  }

  return auth
}

/**
 * Require OWNER or BARBER.
 */
export async function requireStaff(
  options?: { restrictToOwnBarber?: boolean }
): Promise<AuthResult | AuthError> {
  const auth = await requireAuth()
  if (!auth.success) return auth

  if (auth.user.role === 'BARBER' && options?.restrictToOwnBarber && !auth.user.barberId) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Barber account not linked to a barber profile' },
        { status: 403 }
      ),
    }
  }
  return auth
}

/**
 * Verify business access — user must belong to the same business.
 */
export async function verifyBusinessAccess(
  userBusinessId: string | null,
  resourceBusinessId: string
): Promise<boolean> {
  if (!userBusinessId) return false
  return userBusinessId === resourceBusinessId
}

/**
 * Log an audit event.
 */
export async function logAudit(params: {
  userId?: string
  businessId?: string
  action: string
  entityType?: string
  entityId?: string
  oldValues?: any
  newValues?: any
  ipAddress?: string
  userAgent?: string
}): Promise<void> {
  // businessId is nullable in the schema: a user without a business yet
  // (e.g. a forced password change during first-owner setup) must still
  // get security events recorded.
  if (params.userId || params.businessId) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          businessId: params.businessId,
          action: params.action as any,
          entityType: params.entityType ?? 'System',
          entityId: params.entityId ?? 'unknown',
          oldValues: params.oldValues ?? undefined,
          newValues: params.newValues ?? undefined,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      })
    } catch (error) {
      logEvent('audit_log_failed', { action: params.action, entityType: params.entityType })
      throw error
    }
  }
}

/**
 * Get the businessId for the current user.
 */
export async function getBusinessIdForUser(user: { businessId?: string | null; role: string }): Promise<string> {
  if (user.businessId) return user.businessId
  throw new Error('Authenticated user is not assigned to a business')
}
