// ============================================================================
// Customer ↔ User linking — the server-side relationship between a CUSTOMER
// user account and its Customer record.
//
// SECURITY INVARIANTS:
//  - The browser can NEVER supply a customerId; resolution starts from the
//    authenticated session user only.
//  - Matching uses the account's verified identity (the email the user
//    signed up and authenticated with) within the business context.
//    Customer records are unique per (businessId, email), so a match is
//    exact — there is no guessing among ambiguous candidates.
//  - If no Customer record exists yet (the user never booked), the link is
//    established automatically on their first booking via the booking
//    transaction. Until then the portal simply shows an empty state.
//  - An existing link is never overwritten, so a user cannot be re-attached
//    to a different customer's record.
// ============================================================================

import { prisma } from './prisma'
import type { Session } from 'next-auth'
import type { Customer } from '@prisma/client'

export interface ResolvedCustomer {
  customer: Customer
  userId: string
}

/**
 * Resolve the Customer record for an authenticated CUSTOMER session within a
 * business context. Returns null when the session is not a CUSTOMER or no
 * customer record matches the account email yet.
 */
export async function resolveSessionCustomer(
  session: Session | null,
  businessId: string
): Promise<ResolvedCustomer | null> {
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined
  if (!user?.id || !user?.email || user.role !== 'CUSTOMER') return null

  // Prefer the explicit account link when it points at this business's
  // customer record; otherwise fall back to exact email matching.
  const linked = await prisma.user.findUnique({
    where: { id: user.id },
    select: { customerId: true, customer: { include: { business: { select: { id: true } } } } },
  })
  if (linked?.customerId && linked.customer && linked.customer.businessId === businessId) {
    return { customer: linked.customer, userId: user.id }
  }

  const customer = await prisma.customer.findUnique({
    where: { businessId_email: { businessId, email: user.email } },
  })
  return customer ? { customer, userId: user.id } : null
}

/**
 * Establish the account → customer-record link (called from the booking
 * transaction path when a CUSTOMER user books for the first time). Only ever
 * fills a missing link — never rewrites an existing association.
 */
export async function linkCustomerToUser(
  userId: string,
  customerId: string,
  businessId: string
): Promise<void> {
  try {
    const updated = await prisma.user.updateMany({
      where: { id: userId, role: 'CUSTOMER', customerId: null },
      data: { customerId },
    })
    if (updated.count > 0) {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId,
          action: 'CUSTOMER_LINKED',
          entityType: 'Customer',
          entityId: customerId,
          newValues: { customerId , description: 'Customer account linked to customer record on first booking' },
        },
      }).catch(() => {})
    }
  } catch {
    // Linking is an optimization — resolution falls back to email matching.
  }
}
