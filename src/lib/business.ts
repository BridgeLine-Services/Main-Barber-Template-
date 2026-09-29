import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveBusinessId as resolveTenantBusinessId, resolveBusiness } from '@/lib/tenant'

// ============================================================================
// Multi-tenant resolution helper
// Production: resolve by domain/slug via tenant.ts
// Authenticated routes: resolve from session.businessId
// ============================================================================

/**
 * @deprecated Use resolveBusiness from @/lib/tenant instead.
 * Kept for backward compatibility with routes that haven't been migrated yet.
 */
export async function getCurrentBusiness() {
  // Try authenticated user first (for dashboard routes)
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const businessId = (session.user as any).businessId
    if (businessId) {
      const business = await prisma.business.findUnique({ where: { id: businessId } })
      if (business) return business
    }
  }

  // Public routes: use production tenant resolution
  return resolveBusiness()
}

/**
 * @deprecated Use resolveBusinessId from @/lib/tenant instead.
 */
export async function getCurrentBusinessId(): Promise<string> {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const businessId = (session.user as any).businessId
    if (businessId) return businessId
  }

  // Production tenant resolution — throws if no business configured
  return resolveTenantBusinessId()
}

/**
 * For API routes: resolve businessId from session (dashboard) or
 * tenant resolution (public routes).
 * @deprecated Use resolveBusinessId from @/lib/tenant for public routes.
 */
export async function resolveBusinessIdFromRequest(_req?: Request): Promise<string> {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const businessId = (session.user as any).businessId
    if (businessId) return businessId
  }

  // Production tenant resolution
  return resolveTenantBusinessId()
}

/**
 * Backward-compatible export name matching original function signature.
 */
export async function resolveBusinessId(req?: Request): Promise<string> {
  return resolveBusinessIdFromRequest(req)
}
