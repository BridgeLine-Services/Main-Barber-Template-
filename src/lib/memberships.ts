/**
 * MEMBERSHIPS — optional, owner-controlled paid membership system.
 * (see docs/MEMBERSHIPS.md)
 *
 * Invariants enforced here (not just in the UI):
 *   1. A membership is NEVER ACTIVE until its first payment is verified
 *      (Stripe webhook or POS settlement). Enrollment creates PENDING rows.
 *   2. Benefits (service discount / included visits) apply only while the
 *      membership is ACTIVE and the current time is inside its period.
 *   3. The same appointment can never redeem the same benefit twice —
 *      enforced by a database unique constraint (membershipId, appointmentId,
 *      benefitType), not just an application check.
 *   4. Everything is tenant-scoped: every query filters by businessId, and
 *      callers must resolve the business from the session (never from
 *      client-supplied ids).
 *   5. The feature is fail-closed: requires BOTH the 'memberships' feature
 *      flag AND MembershipSettings.enabled.
 *
 * Billing model (see docs/MEMBERSHIPS.md for the full state diagram):
 *   - First payment follows the existing payment flow (POS or Stripe
 *     PaymentIntent with metadata.membershipId) and activates the
 *     membership for its first period via activateMembershipForPayment.
 *   - Recurring billing via Stripe Subscriptions is an explicitly documented
 *     setup (STRIPE keys + subscription webhooks). When no provider
 *     subscription is configured, period-end memberships move to PAST_DUE
 *     (grace) and expire — the system never fabricates a successful charge.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type {
  Membership,
  MembershipPlan,
  MembershipSettings,
  MembershipStatus,
} from '@prisma/client'
import { isFeatureEnabledForBusiness } from '@/lib/features'

// ─── Settings ────────────────────────────────────────────────────────────────

export const DEFAULT_RENEWAL_NOTICE_DAYS = 3
export const DEFAULT_PAST_DUE_GRACE_DAYS = 7

export async function getMembershipSettings(businessId: string): Promise<MembershipSettings> {
  let settings = await prisma.membershipSettings.findUnique({ where: { businessId } })
  if (!settings) {
    settings = await prisma.membershipSettings.create({
      data: {
        businessId,
        renewalNoticeDays: DEFAULT_RENEWAL_NOTICE_DAYS,
        pastDueGraceDays: DEFAULT_PAST_DUE_GRACE_DAYS,
      },
    })
  }
  return settings
}

/** The full fail-closed gate: feature flag AND owner master switch. */
export async function isMembershipSystemUsable(businessId: string): Promise<boolean> {
  if (!(await isFeatureEnabledForBusiness(businessId, 'memberships'))) return false
  const settings = await getMembershipSettings(businessId)
  return settings.enabled
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export type PlanInput = {
  name: string
  description?: string | null
  billingInterval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  price: number
  currency?: string
  serviceDiscountPercent?: number
  includedVisitsPerPeriod?: number
  visitWindowDays?: number
  active?: boolean
  sortOrder?: number
}

export function validatePlanInput(input: Partial<PlanInput>): { ok: boolean; error?: string } {
  if (!input.name || input.name.trim().length < 2) return { ok: false, error: 'Plan name must be at least 2 characters' }
  if (input.price === undefined || !Number.isFinite(input.price) || input.price <= 0 || input.price > 100000) {
    return { ok: false, error: 'Price must be a positive amount' }
  }
  const disc = input.serviceDiscountPercent ?? 0
  if (!Number.isFinite(disc) || disc < 0 || disc > 100) {
    return { ok: false, error: 'Service discount must be between 0 and 100 percent' }
  }
  const visits = input.includedVisitsPerPeriod ?? 0
  if (!Number.isInteger(visits) || visits < -1 || visits > 1000) {
    return { ok: false, error: 'Included visits must be 0 (none), -1 (unlimited), or a positive count' }
  }
  const window = input.visitWindowDays ?? 30
  if (!Number.isInteger(window) || window < 1 || window > 365) {
    return { ok: false, error: 'Visit window must be between 1 and 365 days' }
  }
  return { ok: true }
}

export async function listPlans(businessId: string, includeInactive = false): Promise<MembershipPlan[]> {
  return prisma.membershipPlan.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

// ─── Periods ─────────────────────────────────────────────────────────────────

const INTERVAL_MS: Record<'MONTHLY' | 'QUARTERLY' | 'YEARLY', number> = {
  MONTHLY: 30 * 86400000,
  QUARTERLY: 91 * 86400000,
  YEARLY: 365 * 86400000,
}

export function addInterval(from: Date, interval: MembershipPlan['billingInterval']): Date {
  return new Date(from.getTime() + INTERVAL_MS[interval])
}

export function isWithinPeriod(m: Pick<Membership, 'status' | 'currentPeriodEnd'>, now = new Date()): boolean {
  return m.status === 'ACTIVE' && !!m.currentPeriodEnd && m.currentPeriodEnd.getTime() > now.getTime()
}

// ─── Enrollment ───────────────────────────────────────────────────────────────

export const MEMBERSHIP_ERRORS = {
  DISABLED: 'membership system is disabled',
  PLAN_INACTIVE: 'plan is not available for enrollment',
  ALREADY_ACTIVE: 'customer already has an active membership',
} as const

export class MembershipError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'MembershipError'
  }
}

export interface EnrollInput {
  businessId: string
  customerId: string
  planId: string
  now?: Date
}

export type Enrolled = { membership: Membership; paymentRequired: true }

/**
 * Enroll a customer: creates a PENDING membership row. The membership only
 * becomes ACTIVE when its first payment settles (POS or Stripe webhook).
 * Fails when: system disabled, plan inactive/foreign, or the customer
 * already holds an ACTIVE or PENDING membership in this business.
 */
export async function enrollCustomer(input: EnrollInput): Promise<Enrolled> {
  const { businessId, customerId, planId } = input
  if (!(await isMembershipSystemUsable(businessId))) {
    throw new MembershipError(MEMBERSHIP_ERRORS.DISABLED, 'MEMBERSHIP_DISABLED')
  }
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, businessId } })
  if (!plan) throw new MembershipError('Plan not found for this business', 'PLAN_NOT_FOUND')
  if (!plan.active) throw new MembershipError(MEMBERSHIP_ERRORS.PLAN_INACTIVE, 'PLAN_INACTIVE')

  const existing = await prisma.membership.findFirst({
    where: { businessId, customerId, status: { in: ['PENDING', 'ACTIVE'] } },
    select: { id: true },
  })
  if (existing) throw new MembershipError(MEMBERSHIP_ERRORS.ALREADY_ACTIVE, 'ALREADY_ENROLLED')

  const now = input.now ?? new Date()
  const membership = await prisma.membership.create({
    data: {
      businessId,
      customerId,
      planId,
      status: 'PENDING',
      startedAt: now, // provisional until first payment confirms
    },
  })
  return { membership, paymentRequired: true }
}

// ─── Activation (payment confirmation) ────────────────────────────────────────

/**
 * Activate a PENDING membership after its first payment settles.
 * Idempotent: re-activation of an ACTIVE membership is a no-op; a membership
 * that is not PENDING is left untouched. Returns whether activation happened.
 */
export async function activateMembershipForPayment(paymentId: string, now = new Date()): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return false
  const membershipId = (payment.metadata as Record<string, unknown> | null)?.membershipId as string | undefined
  if (!membershipId || payment.status !== 'SUCCEEDED') return false
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, businessId: payment.businessId },
  })
  if (!membership || membership.status !== 'PENDING') return false

  const plan = await prisma.membershipPlan.findUnique({ where: { id: membership.planId } })
  if (!plan) return false

  await prisma.membership.update({
    where: { id: membership.id },
    data: {
      status: 'ACTIVE',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, plan.billingInterval),
    },
  })
  return true
}

// ─── Benefits ────────────────────────────────────────────────────────────────

export interface BenefitQuote {
  membershipId: string
  planName: string
  serviceDiscountPercent: number
  includedVisitsRemaining: number // -1 = unlimited
  /** True when the membership covers this appointment's service fully. */
  visitCovered: boolean
  discountAmount: number
  dueAmount: number
}

/**
 * Quote the benefit for an appointment's service price. Pure calculation —
 * no writes. Returns null when the customer has no in-period membership.
 */
export async function quoteBenefit(
  businessId: string,
  customerId: string,
  servicePrice: number,
  now = new Date()
): Promise<BenefitQuote | null> {
  const membership = await prisma.membership.findFirst({
    where: { businessId, customerId, status: 'ACTIVE' },
    include: { plan: true },
  })
  if (!membership || !isWithinPeriod(membership, now)) return null

  const { plan } = membership
  const visitsRemaining = await includedVisitsRemaining(membership.id, plan, now)
  const visitCovered = plan.includedVisitsPerPeriod === -1
    || (plan.includedVisitsPerPeriod > 0 && visitsRemaining > 0)
  if (visitCovered) {
    return {
      membershipId: membership.id,
      planName: plan.name,
      serviceDiscountPercent: plan.serviceDiscountPercent,
      includedVisitsRemaining: visitsRemaining,
      visitCovered: true,
      discountAmount: servicePrice,
      dueAmount: 0,
    }
  }
  const discountAmount = Math.round(servicePrice * (plan.serviceDiscountPercent / 100) * 100) / 100
  return {
    membershipId: membership.id,
    planName: plan.name,
    serviceDiscountPercent: plan.serviceDiscountPercent,
    includedVisitsRemaining: visitsRemaining,
    visitCovered: false,
    discountAmount,
    dueAmount: Math.max(0, Math.round((servicePrice - discountAmount) * 100) / 100),
  }
}

async function includedVisitsRemaining(
  membershipId: string,
  plan: Pick<MembershipPlan, 'includedVisitsPerPeriod' | 'visitWindowDays'>,
  now: Date
): Promise<number> {
  if (plan.includedVisitsPerPeriod === 0) return 0
  if (plan.includedVisitsPerPeriod === -1) return -1
  const windowStart = new Date(now.getTime() - plan.visitWindowDays * 86400000)
  const used = await prisma.membershipUsage.count({
    where: { membershipId, benefitType: 'INCLUDED_VISIT', usedAt: { gte: windowStart } },
  })
  return Math.max(0, plan.includedVisitsPerPeriod - used)
}

export interface ApplyBenefitInput {
  businessId: string
  customerId: string
  appointmentId: string
  servicePrice: number
  now?: Date
}

/**
 * Apply and RECORD the benefit for a completed appointment checkout.
 * Duplicate redemption for the same appointment is impossible: the unique
 * constraint (membershipId, appointmentId, benefitType) rejects the second
 * attempt. Returns the applied quote, or null when no eligible membership.
 */
export async function applyBenefitForAppointment(input: ApplyBenefitInput): Promise<BenefitQuote | null> {
  const now = input.now ?? new Date()
  const quote = await quoteBenefit(input.businessId, input.customerId, input.servicePrice, now)
  if (!quote) return null

  const benefitType = quote.visitCovered ? 'INCLUDED_VISIT' : 'SERVICE_DISCOUNT'
  try {
    await prisma.membershipUsage.create({
      data: {
        businessId: input.businessId,
        membershipId: quote.membershipId,
        appointmentId: input.appointmentId,
        benefitType,
        amount: quote.discountAmount,
        usedAt: now,
      },
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      // Already redeemed for this appointment — idempotent re-checkout.
      return quote
    }
    throw e
  }
  return quote
}

// ─── Cancellation & lifecycle ────────────────────────────────────────────────

/** Customer/owner cancellation: effective at period end (auto-renew off). */
export async function cancelMembership(
  businessId: string,
  membershipId: string,
  reason: string | null,
  now = new Date()
): Promise<Membership> {
  const membership = await prisma.membership.findFirst({ where: { id: membershipId, businessId } })
  if (!membership) throw new MembershipError('Membership not found', 'NOT_FOUND')
  if (membership.status !== 'PENDING' && membership.status !== 'ACTIVE' && membership.status !== 'PAST_DUE') {
    throw new MembershipError(`Membership is ${membership.status} and cannot be canceled`, 'BAD_STATE')
  }
  // PENDING memberships never activated — end immediately.
  const immediate = membership.status === 'PENDING'
  return prisma.membership.update({
    where: { id: membership.id },
    data: {
      autoRenew: false,
      canceledAt: now,
      cancelReason: reason,
      ...(immediate && { status: 'CANCELED' as MembershipStatus, endedAt: now }),
    },
  })
}

export interface RenewalOutcome {
  processed: number
  renewed: number
  pastDue: number
  expired: number
  canceled: number
}

/**
 * Period-end processing. Run by a scheduled job (see docs/MEMBERSHIPS.md):
 *   ACTIVE + period ended + autoRenew     -> PAST_DUE (verified renewal
 *     requires a provider subscription; until one exists the system NEVER
 *     invents a charge — see docs for the Stripe Subscriptions setup)
 *   ACTIVE + period ended + !autoRenew    -> CANCELED + endedAt
 *   PAST_DUE + grace elapsed              -> EXPIRED
 */
export async function processMembershipPeriodEnds(businessId: string, now = new Date()): Promise<RenewalOutcome> {
  const settings = await getMembershipSettings(businessId)
  const outcome: RenewalOutcome = { processed: 0, renewed: 0, pastDue: 0, expired: 0, canceled: 0 }

  const dueEnd = await prisma.membership.findMany({
    where: {
      businessId,
      status: 'ACTIVE',
      autoRenew: true,
      currentPeriodEnd: { lte: now },
    },
    select: { id: true },
  })
  for (const m of dueEnd) {
    // When a provider subscription exists, its invoice webhooks drive the
    // renewal; here we only mark the period lapsed honestly.
    await prisma.membership.update({ where: { id: m.id }, data: { status: 'PAST_DUE' } })
    outcome.processed++
    outcome.pastDue++
  }

  const dueCancel = await prisma.membership.findMany({
    where: { businessId, status: 'ACTIVE', autoRenew: false, currentPeriodEnd: { lte: now } },
    select: { id: true },
  })
  for (const m of dueCancel) {
    await prisma.membership.update({
      where: { id: m.id },
      data: { status: 'CANCELED', endedAt: now },
    })
    outcome.processed++
    outcome.canceled++
  }

  const graceEnd = new Date(now.getTime() - settings.pastDueGraceDays * 86400000)
  const expired = await prisma.membership.findMany({
    where: { businessId, status: 'PAST_DUE', currentPeriodEnd: { lt: graceEnd } },
    select: { id: true },
  })
  for (const m of expired) {
    await prisma.membership.update({
      where: { id: m.id },
      data: { status: 'EXPIRED', endedAt: now },
    })
    outcome.processed++
    outcome.expired++
  }
  return outcome
}

// ─── Views ────────────────────────────────────────────────────────────────────

export async function listCustomerMemberships(businessId: string, customerId: string): Promise<
  (Membership & { plan: Pick<MembershipPlan, 'id' | 'name' | 'billingInterval' | 'price' | 'serviceDiscountPercent' | 'includedVisitsPerPeriod'> })[]
> {
  return prisma.membership.findMany({
    where: { businessId, customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      plan: {
        select: {
          id: true, name: true, billingInterval: true, price: true,
          serviceDiscountPercent: true, includedVisitsPerPeriod: true,
        },
      },
    },
  })
}

/** Owner dashboard summary. */
export async function membershipStats(businessId: string): Promise<{
  active: number
  pending: number
  pastDue: number
  canceled: number
  expired: number
  plans: number
}> {
  const [byStatus, plans] = await Promise.all([
    prisma.membership.groupBy({
      by: ['status'],
      where: { businessId },
      _count: { _all: true },
    }),
    prisma.membershipPlan.count({ where: { businessId, active: true } }),
  ])
  const counts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<string, number>
  return {
    active: counts.ACTIVE ?? 0,
    pending: counts.PENDING ?? 0,
    pastDue: counts.PAST_DUE ?? 0,
    canceled: counts.CANCELED ?? 0,
    expired: counts.EXPIRED ?? 0,
    plans,
  }
}

// ─── Tx helpers (for POS / webhook integration) ───────────────────────────────

/**
 * Metadata to stamp on the first membership payment so webhook activation can
 * find the membership — mirroring the gift-card purchase flow.
 */
export function membershipPaymentMetadata(membershipId: string): Prisma.InputJsonValue {
  return { membershipId, membershipEnrollment: true }
}
