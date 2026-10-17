// ============================================================================
// Prompt 10 — Financial reconciliation (analytics ⇄ payment ledger)
//
// ONE authoritative revenue source: the Payment ledger (SUCCEEDED rows,
// refunds subtracted), NOT the legacy "sum of completed-appointment service
// prices" estimate. This module computes the financial truth and the
// reconciliation deltas so the analytics engine can (a) report real revenue
// and (b) surface every divergence between appointment outcomes and money
// actually collected.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { dayBoundsFromYMD } from '@/lib/timezone'
import { getBusinessTimezone } from '@/lib/availability'

// Payment kinds that bring money IN. TIP is tracked separately for
// transparency but is part of net revenue.
const REVENUE_KINDS = ['CHARGE', 'DEPOSIT', 'TIP', 'CANCELLATION_FEE', 'NO_SHOW_FEE'] as const

export interface LedgerFinancials {
  /** Gross money in: SUCCEEDED revenue-kind payments in range. */
  grossRevenue: number
  /** Succeeded REFUND rows in range (money back out). */
  refunds: number
  /** Net = gross - refunds. Authoritative revenue figure. */
  netRevenue: number
  /** Tip revenue (gratuity payments are separate ledger rows). */
  tipRevenue: number
  /** Net revenue excluding tips — the service/product number. */
  netRevenueExcludingTips: number
  /** Payment rows broken down by method (CARD / CASH / ...). */
  byMethod: { method: string; payments: number; net: number }[]
}

export interface AppointmentFinancials {
  /** Sum of service prices for COMPLETED appointments (legacy estimate —
   * reported as an ESTIMATE, never as revenue). */
  completedServiceValue: number
  completedCount: number
  /** COMPLETED appointments with no settled payment attached. */
  completedWithoutPayment: { appointmentId: string; startTime: string }[]
}

export interface ReconciliationResult {
  ledger: LedgerFinancials
  appointments: AppointmentFinancials
  /** ledger.netRevenue - appointment estimate. Positive = collected beyond
   * listed service price (tips, upgrades, fees, products); negative =
   * completed visits with no settled payment (comped/pay-later/missing). */
  revenueDelta: number
  averageTicket: number
  /** Shop timezone used for range boundaries (never the server's). */
  timezone: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Reconcile the payment ledger against appointment outcomes for a range. */
export async function reconcileFinancials(
  businessId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<ReconciliationResult> {
  const [payments, completed, timezone] = await Promise.all([
    prisma.payment.findMany({
      where: {
        businessId,
        createdAt: { gte: rangeStart, lt: rangeEnd },
        status: 'SUCCEEDED',
      },
      select: { id: true, kind: true, method: true, amount: true },
    }),
    prisma.appointment.findMany({
      where: {
        businessId,
        status: 'COMPLETED',
        startTime: { gte: rangeStart, lt: rangeEnd },
      },
      select: {
        id: true,
        startTime: true,
        service: { select: { price: true } },
        payments: { where: { status: 'SUCCEEDED' }, select: { id: true } },
      },
    }),
    getBusinessTimezone(businessId),
  ])

  let grossRevenue = 0
  let refunds = 0
  let tipRevenue = 0
  const methodMap = new Map<string, { payments: number; net: number }>()

  for (const p of payments) {
    const m = methodMap.get(p.method) ?? { payments: 0, net: 0 }
    if ((REVENUE_KINDS as readonly string[]).includes(p.kind)) {
      grossRevenue += p.amount
      m.payments++
      m.net += p.amount
      if (p.kind === 'TIP') tipRevenue += p.amount
    } else if (p.kind === 'REFUND') {
      // REFUND rows store positive amounts — subtract.
      refunds += p.amount
      m.net -= p.amount
    }
    methodMap.set(p.method, m)
  }

  const netRevenue = round2(grossRevenue - refunds)
  const completedServiceValue = round2(completed.reduce((sum, a) => sum + (a.service?.price ?? 0), 0))
  const completedWithoutPayment = completed
    .filter((a) => a.payments.length === 0)
    .map((a) => ({ appointmentId: a.id, startTime: a.startTime.toISOString() }))

  return {
    ledger: {
      grossRevenue: round2(grossRevenue),
      refunds: round2(refunds),
      netRevenue,
      tipRevenue: round2(tipRevenue),
      netRevenueExcludingTips: round2(netRevenue - tipRevenue),
      byMethod: Array.from(methodMap.entries())
        .map(([method, v]) => ({ method, payments: v.payments, net: round2(v.net) }))
        .sort((a, b) => b.net - a.net),
    },
    appointments: {
      completedServiceValue,
      completedCount: completed.length,
      completedWithoutPayment,
    },
    revenueDelta: round2(netRevenue - completedServiceValue),
    averageTicket: completed.length > 0 ? round2(netRevenue / completed.length) : 0,
    timezone,
  }
}

// ─── Timezone-safe range helper ─────────────────────────────────────────────

export interface LocalRange {
  start: Date
  end: Date
  timezone: string
}

/** Compute the trailing-N-day range in the SHOP's timezone, not the server's.
 * Server-local day boundaries are a known bug class for UTC-hosted deploys. */
export async function getLocalRange(
  businessId: string,
  rangeDays: number,
  now: Date = new Date()
): Promise<LocalRange> {
  const timezone = await getBusinessTimezone(businessId)
  const todayLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  // en-CA yields YYYY-MM-DD — feed the canonical YMD parser.
  const [y, m, d] = todayLocal.split('-').map(Number)
  const { start: todayStart, end: todayEnd } = dayBoundsFromYMD(timezone, y, m, d)
  return {
    start: new Date(todayStart.getTime() - rangeDays * 86_400_000),
    end: todayEnd,
    timezone,
  }
}
