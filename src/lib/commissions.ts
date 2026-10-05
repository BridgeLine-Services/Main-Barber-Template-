/**
 * Barber Commissions core (optional, owner-controlled system).
 *
 * Server-side commission engine integrated with the Payment/POS ledger.
 * The OWNER is the final authority: CommissionSettings.enabled is the
 * shop-level master switch. When OFF, every calculation function below
 * is a no-op and commission dashboards hide — but historical
 * CommissionEntry rows are never touched, so financial history survives
 * enable/disable cycles intact.
 *
 * A barber-level participation preference (BarberCommissionParticipation)
 * can only further restrict a barber from commissions; it can NEVER
 * override an owner-disabled shop (owner OFF = everyone OFF).
 *
 * Rate resolution priority (CommissionRule):
 *   (barber + service) > (barber + any service) > (any barber + service)
 *   > CommissionSettings defaults
 */
import { prisma } from '@/lib/prisma'
import type {
  CommissionSettings,
  CommissionRule,
  CommissionEntry,
  Prisma,
} from '@prisma/client'

export type CommissionTx = Prisma.TransactionClient
export type { CommissionSettings, CommissionRule, CommissionEntry }

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── Settings ──────────────────────────────────────────────────────────────

/** Resolve commission settings, creating the safe default (all OFF) on
 *  first read. Mirrors getPosSettings in the payments module. */
export async function getCommissionSettings(businessId: string): Promise<CommissionSettings> {
  const existing = await prisma.commissionSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return prisma.commissionSettings.create({ data: { businessId } })
}

/** Who may manage commission configuration & shop-wide reports.
 *  Business admins get operational tools but NOT shop financials. */
export function canManageCommissions(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

// ─── Rate resolution ────────────────────────────────────────────────────────

export interface ResolvedRate {
  rateType: 'PERCENT' | 'FIXED'
  ratePercent?: number
  rateFixed?: number
  /** human label for reports/UI, e.g. "40%" or "$5.00 per service" */
  label: string
}

export const DEFAULT_RATE_LABEL = 'not configured'

/** Resolve the applicable rate for one barber + service, honoring
 *  rule priority (see module doc). `rules` must be this business's. */
export function resolveRate(
  settings: CommissionSettings,
  rules: CommissionRule[],
  barberId: string | null,
  serviceId: string | null,
): ResolvedRate {
  const scoped = rules.filter(
    (r) => (r.barberId === null || r.barberId === barberId) && (r.serviceId === null || r.serviceId === serviceId),
  )
  // Most specific scope first
  const pick =
    scoped.find((r) => r.barberId !== null && r.serviceId !== null) ??
    scoped.find((r) => r.barberId !== null) ??
    scoped.find((r) => r.serviceId !== null)
  if (pick) {
    return {
      rateType: pick.rateType,
      ratePercent: pick.ratePercent ?? undefined,
      rateFixed: pick.rateFixed ?? undefined,
      label: rateLabel(pick.rateType, pick.ratePercent, pick.rateFixed),
    }
  }
  return {
    rateType: settings.defaultRateType,
    ratePercent: settings.defaultRatePercent,
    rateFixed: settings.defaultRateFixed,
    label: rateLabel(settings.defaultRateType, settings.defaultRatePercent, settings.defaultRateFixed),
  }
}

export function rateLabel(rateType: string, ratePercent?: number | null, rateFixed?: number | null): string {
  if (rateType === 'FIXED') return rateFixed != null ? `$${rateFixed.toFixed(2)} flat` : DEFAULT_RATE_LABEL
  return ratePercent != null ? `${ratePercent}%` : DEFAULT_RATE_LABEL
}

/** Compute a commission amount from a base and a resolved rate. */
export function computeCommission(base: number, rate: ResolvedRate): number {
  if (!(base > 0)) return 0
  if (rate.rateType === 'FIXED') return round2(Math.min(rate.rateFixed ?? 0, base))
  return round2((base * (rate.ratePercent ?? 0)) / 100)
}

/** Is a given barber commissioned? Owner master switch AND (if the barber
 *  has opted out via their participation preference) false. */
export async function isBarberCommissioned(
  tx: CommissionTx,
  settings: CommissionSettings,
  barberId: string | null,
): Promise<boolean> {
  if (!settings.enabled || !barberId) return false
  const participation = await tx.barberCommissionParticipation.findUnique({ where: { barberId } })
  if (participation && !participation.participates) return false
  return true
}

// ─── Checkout integration (Payment/POS) ────────────────────────────────────

export interface CheckoutCommissionInput {
  businessId: string
  barberId: string | null
  appointmentId: string | null
  serviceId: string | null
  /** service list price */
  servicePrice: number
  /** flat discount applied to the service subtotal at checkout */
  discount: number
  /** POS product/custom line items actually charged */
  lineItems: Array<{ name: string; amount: number; kind: string }>
  /** tip actually charged (separate TIP payment row) */
  tip: number
  chargePaymentId: string
  tipPaymentId?: string
}

/**
 * Create CommissionEntry ledger rows for a completed checkout — called
 * INSIDE the checkout transaction so commission and payment commit
 * atomically. No-op (returns []) when commissions are disabled for the
 * shop or the barber is not participating. Never throws for "disabled" —
 * the checkout itself must always succeed.
 */
export async function createCommissionsForCheckout(
  tx: CommissionTx,
  input: CheckoutCommissionInput,
): Promise<CommissionEntry[]> {
  const settings = await getCommissionSettings(input.businessId)
  if (!settings.enabled) return []
  if (!(await isBarberCommissioned(tx, settings, input.barberId))) return []

  const rules = await tx.commissionRule.findMany({ where: { businessId: input.businessId } })
  const created: CommissionEntry[] = []

  // 1. Service commission — commissioned base is the post-discount service
  //    subtotal (never tax, never tips).
  const serviceBase = round2(Math.max(0, input.servicePrice - input.discount))
  if (serviceBase > 0) {
    const rate = resolveRate(settings, rules, input.barberId, input.serviceId)
    const amount = computeCommission(serviceBase, rate)
    if (amount > 0) {
      created.push(
        await tx.commissionEntry.create({
          data: {
            businessId: input.businessId,
            barberId: input.barberId!,
            appointmentId: input.appointmentId,
            paymentId: input.chargePaymentId,
            source: 'SERVICE',
            grossAmount: serviceBase,
            discountAmount: round2(input.discount),
            rateType: rate.rateType,
            ratePercent: rate.ratePercent ?? null,
            rateFixed: rate.rateFixed ?? null,
            commissionAmount: amount,
          },
        }),
      )
    }
  }

  // 2. Product commission — POS product line items only (kind PRODUCT).
  //    Owner opt-in; custom/manual line items are never commissioned.
  if (settings.productCommissionEnabled) {
    const productBase = round2(
      input.lineItems.filter((li) => li.kind === 'PRODUCT').reduce((sum, li) => sum + li.amount, 0),
    )
    if (productBase > 0) {
      const rate: ResolvedRate = {
        rateType: settings.productRateType,
        ratePercent: settings.productRatePercent,
        rateFixed: settings.productRateFixed,
        label: rateLabel(settings.productRateType, settings.productRatePercent, settings.productRateFixed),
      }
      const amount = computeCommission(productBase, rate)
      if (amount > 0) {
        created.push(
          await tx.commissionEntry.create({
            data: {
              businessId: input.businessId,
              barberId: input.barberId!,
              appointmentId: input.appointmentId,
              paymentId: input.chargePaymentId,
              source: 'PRODUCT',
              grossAmount: productBase,
              rateType: rate.rateType,
              ratePercent: rate.ratePercent ?? null,
              rateFixed: rate.rateFixed ?? null,
              commissionAmount: amount,
            },
          }),
        )
      }
    }
  }

  // 3. Tip commission — per the owner's configured tip treatment.
  //    EXCLUDED (default): tips are the barber's own, not shop revenue,
  //    no ledger row. PASS_THROUGH: full tip added to payout. PERCENT:
  //    tips commissioned at tipsCommissionPercent.
  if (input.tip > 0 && input.tipPaymentId) {
    if (settings.tipsMode === 'PASS_THROUGH') {
      created.push(
        await tx.commissionEntry.create({
          data: {
            businessId: input.businessId,
            barberId: input.barberId!,
            appointmentId: input.appointmentId,
            paymentId: input.tipPaymentId,
            source: 'TIP',
            grossAmount: round2(input.tip),
            rateType: 'FIXED',
            rateFixed: round2(input.tip),
            commissionAmount: round2(input.tip),
          },
        }),
      )
    } else if (settings.tipsMode === 'PERCENT' && settings.tipsCommissionPercent > 0) {
      const amount = round2((input.tip * settings.tipsCommissionPercent) / 100)
      if (amount > 0) {
        created.push(
          await tx.commissionEntry.create({
            data: {
              businessId: input.businessId,
              barberId: input.barberId!,
              appointmentId: input.appointmentId,
              paymentId: input.tipPaymentId,
              source: 'TIP',
              grossAmount: round2(input.tip),
              rateType: 'PERCENT',
              ratePercent: settings.tipsCommissionPercent,
              commissionAmount: amount,
            },
          }),
        )
      }
    }
  }

  return created
}

// ─── Refund / void adjustments ─────────────────────────────────────────────

/**
 * Reconcile commission entries against a charge's current refund state.
 * Idempotent by construction: refundAdjustment is recomputed from the
 * payment's refundedAmount, so replays (webhook retries, double calls)
 * converge instead of double-counting. Refunds reduce the commissioned
 * barber's payout proportionally — never below zero.
 */
export async function adjustCommissionsForRefund(
  tx: CommissionTx,
  businessId: string,
  paymentId: string,
): Promise<void> {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId } })
  if (!payment || payment.kind === 'REFUND') return
  const entries = await tx.commissionEntry.findMany({ where: { paymentId, businessId } })
  if (!entries.length) return

  const refunded = Math.max(0, payment.refundedAmount)
  if (refunded <= 0) {
    // Fully re-... a zero refund state means no reversal applies.
    const zeroed = entries.some((e) => e.refundAdjustment !== 0)
    if (zeroed) {
      await tx.commissionEntry.updateMany({
        where: { paymentId, businessId },
        data: { refundAdjustment: 0 },
      })
    }
    return
  }

  const fraction = payment.amount > 0 ? Math.min(1, refunded / payment.amount) : 1
  for (const entry of entries) {
    const target = -round2(entry.commissionAmount * fraction)
    if (Math.abs(entry.refundAdjustment - target) < 0.005) continue
    const status =
      target < 0 && entry.status !== 'PAID' ? ('ADJUSTED' as const) : entry.status
    await tx.commissionEntry.update({
      where: { id: entry.id },
      data: { refundAdjustment: target, ...(status !== entry.status ? { status } : {}) },
    })
  }
}

// ─── Fee commissions (no-show, opt-in) ─────────────────────────────────────

/** Commission a settled NO_SHOW_FEE payment when the owner opted in
 *  (includeNoShowFees). Cancellation fees are shop income and are never
 *  commissioned. */
export async function recordCommissionForFeePayment(
  tx: CommissionTx,
  businessId: string,
  paymentId: string,
): Promise<CommissionEntry | null> {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId } })
  if (!payment || payment.kind !== 'NO_SHOW_FEE' || payment.status !== 'SUCCEEDED') return null
  const settings = await getCommissionSettings(businessId)
  if (!settings.enabled || !settings.includeNoShowFees) return null

  let barberId = payment.barberId
  let serviceId: string | null = null
  if (payment.appointmentId) {
    const appt = await tx.appointment.findFirst({
      where: { id: payment.appointmentId, businessId },
      select: { barberId: true, serviceId: true },
    })
    if (appt) {
      barberId = appt.barberId
      serviceId = appt.serviceId
    }
  }
  if (!barberId || !(await isBarberCommissioned(tx, settings, barberId))) return null

  const rules = await tx.commissionRule.findMany({ where: { businessId } })
  const rate = resolveRate(settings, rules, barberId, serviceId)
  const amount = computeCommission(round2(payment.amount), rate)
  if (amount <= 0) return null
  return tx.commissionEntry.create({
    data: {
      businessId,
      barberId,
      appointmentId: payment.appointmentId,
      paymentId: payment.id,
      source: 'SERVICE',
      grossAmount: round2(payment.amount),
      rateType: rate.rateType,
      ratePercent: rate.ratePercent ?? null,
      rateFixed: rate.rateFixed ?? null,
      commissionAmount: amount,
      notes: 'No-show fee commission (owner opt-in)',
    },
  })
}

// ─── Unpaid completions (owner opt-in) ─────────────────────────────────────

/**
 * calculateOnUnpaid hook: when the owner opts in, a completed appointment
 * earns commission even if it was never charged through POS (pay-later
 * shops). Idempotent — skips if any entry already exists for the
 * appointment's service commission. Cancelled / no-show appointments
 * never reach this path (only COMPLETED transitions call it).
 */
export async function recordCommissionForUnpaidCompletion(
  businessId: string,
  appointmentId: string,
): Promise<CommissionEntry | null> {
  return prisma.$transaction(async (tx) => {
    const settings = await getCommissionSettings(businessId)
    if (!settings.enabled || !settings.calculateOnUnpaid) return null
    const appointment = await tx.appointment.findFirst({
      where: { id: appointmentId, businessId, status: 'COMPLETED' },
      include: { service: true },
    })
    if (!appointment?.barberId || !appointment.service) return null
    if (!(await isBarberCommissioned(tx, settings, appointment.barberId))) return null

    const existing = await tx.commissionEntry.findFirst({
      where: { appointmentId, businessId, source: 'SERVICE' },
    })
    if (existing) return null // POS checkout already commissioned this

    const rules = await tx.commissionRule.findMany({ where: { businessId } })
    const rate = resolveRate(settings, rules, appointment.barberId, appointment.serviceId)
    const base = round2(appointment.service.price)
    const amount = computeCommission(base, rate)
    if (amount <= 0) return null
    return tx.commissionEntry.create({
      data: {
        businessId,
        barberId: appointment.barberId,
        appointmentId,
        source: 'SERVICE',
        grossAmount: base,
        rateType: rate.rateType,
        ratePercent: rate.ratePercent ?? null,
        rateFixed: rate.rateFixed ?? null,
        commissionAmount: amount,
        notes: 'Completed appointment (unpaid-commission mode)',
      },
    })
  })
}

// ─── Effective payout ───────────────────────────────────────────────────────

/** Net commission owed for an entry (original ± corrections). */
export function entryPayout(entry: Pick<CommissionEntry, 'commissionAmount' | 'adjustment' | 'refundAdjustment'>): number {
  return round2(entry.commissionAmount + entry.adjustment + entry.refundAdjustment)
}

// ─── Reporting (owner-only at the API layer) ────────────────────────────────

export interface CommissionReportBarber {
  barberId: string
  name: string
  serviceRevenue: number
  productRevenue: number
  tips: number
  rateLabel: string
  commission: number
  adjustments: number
  shopShare: number
  payout: number
  pendingPayout: number
  paidPayout: number
  entryCount: number
}

export interface CommissionReport {
  from: string
  to: string
  currency: string
  totals: {
    serviceRevenue: number
    productRevenue: number
    tips: number
    commission: number
    adjustments: number
    shopShare: number
    payout: number
    pendingPayout: number
    paidPayout: number
  }
  barbers: CommissionReportBarber[]
}

/**
 * Aggregate the commission ledger over a date range (entries created in
 * [from, to)), optionally for one barber. Tenant-scoped by businessId —
 * callers must have verified OWNER authority first.
 *
 * Shop share = service + product revenue − net service/product
 * commission. Tips are the barber's own unless the owner configured tip
 * commissioning; tip commission flows to the payout but is NOT subtracted
 * from shop revenue.
 */
export async function buildCommissionReport(
  businessId: string,
  opts: { from: Date; to: Date; barberId?: string | null },
): Promise<CommissionReport> {
  const [settings, entries, barbers] = await Promise.all([
    getCommissionSettings(businessId),
    prisma.commissionEntry.findMany({
      where: {
        businessId,
        ...(opts.barberId ? { barberId: opts.barberId } : {}),
        createdAt: { gte: opts.from, lt: opts.to },
      },
      include: { barber: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.barber.findMany({
      where: { businessId, ...(opts.barberId ? { id: opts.barberId } : {}), isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])
  const rules = await prisma.commissionRule.findMany({ where: { businessId } })

  const byBarber = new Map<string, CommissionReportBarber>()
  for (const b of barbers) {
    byBarber.set(b.id, {
      barberId: b.id,
      name: b.name,
      serviceRevenue: 0,
      productRevenue: 0,
      tips: 0,
      rateLabel: describeBarberRate(settings, rules, b.id),
      commission: 0,
      adjustments: 0,
      shopShare: 0,
      payout: 0,
      pendingPayout: 0,
      paidPayout: 0,
      entryCount: 0,
    })
  }

  for (const e of entries) {
    let row = byBarber.get(e.barberId)
    if (!row) {
      row = {
        barberId: e.barberId,
        name: e.barber?.name ?? 'Barber',
        serviceRevenue: 0,
        productRevenue: 0,
        tips: 0,
        rateLabel: '',
        commission: 0,
        adjustments: 0,
        shopShare: 0,
        payout: 0,
        pendingPayout: 0,
        paidPayout: 0,
        entryCount: 0,
      }
      byBarber.set(e.barberId, row)
    }
    const payout = entryPayout(e)
    row.commission = round2(row.commission + e.commissionAmount)
    row.adjustments = round2(row.adjustments + e.adjustment + e.refundAdjustment)
    row.payout = round2(row.payout + payout)
    if (e.status === 'PAID') row.paidPayout = round2(row.paidPayout + payout)
    else row.pendingPayout = round2(row.pendingPayout + payout)
    row.entryCount++
    if (e.source === 'SERVICE') row.serviceRevenue = round2(row.serviceRevenue + e.grossAmount)
    else if (e.source === 'PRODUCT') row.productRevenue = round2(row.productRevenue + e.grossAmount)
    else row.tips = round2(row.tips + e.grossAmount)
  }

  const rows = [...byBarber.values()]
  for (const row of rows) {
    // Net service/product commission (tips handled separately in payout)
    const svcCommission = round2(
      entries
        .filter((e) => e.barberId === row.barberId && e.source !== 'TIP')
        .reduce((sum, e) => sum + entryPayout(e), 0),
    )
    row.shopShare = round2(row.serviceRevenue + row.productRevenue - svcCommission)
  }

  const totals = rows.reduce(
    (acc, r) => ({
      serviceRevenue: round2(acc.serviceRevenue + r.serviceRevenue),
      productRevenue: round2(acc.productRevenue + r.productRevenue),
      tips: round2(acc.tips + r.tips),
      commission: round2(acc.commission + r.commission),
      adjustments: round2(acc.adjustments + r.adjustments),
      shopShare: round2(acc.shopShare + r.shopShare),
      payout: round2(acc.payout + r.payout),
      pendingPayout: round2(acc.pendingPayout + r.pendingPayout),
      paidPayout: round2(acc.paidPayout + r.paidPayout),
    }),
    {
      serviceRevenue: 0,
      productRevenue: 0,
      tips: 0,
      commission: 0,
      adjustments: 0,
      shopShare: 0,
      payout: 0,
      pendingPayout: 0,
      paidPayout: 0,
    },
  )

  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    currency: 'USD',
    totals,
    barbers: rows.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function describeBarberRate(
  settings: CommissionSettings,
  rules: CommissionRule[],
  barberId: string,
): string {
  const barberWide = rules.find((r) => r.barberId === barberId && r.serviceId === null)
  if (barberWide) return rateLabel(barberWide.rateType, barberWide.ratePercent, barberWide.rateFixed)
  if (rules.some((r) => r.barberId === barberId)) return 'varies by service'
  return rateLabel(settings.defaultRateType, settings.defaultRatePercent, settings.defaultRateFixed)
}

// ─── CSV export ─────────────────────────────────────────────────────────────

const money = (n: number) => `$${n.toFixed(2)}`

/** Per-barber summary CSV matching the documented report layout:
 *  one row per barber, a TOTAL row, then per-barber detail blocks in the
 *  style of the commission report example. */
export function commissionReportCsv(report: CommissionReport): string {
  const lines: string[] = []
  const from = new Date(report.from)
  const to = new Date(report.to)
  lines.push(`Commission Report,${from.toISOString().slice(0, 10)},to,${to.toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push('Barber,Services,Products,Tips,Commission Rate,Commission,Adjustments,Shop Share,Est. Payout,Status Pending,Status Paid')

  for (const b of report.barbers) {
    lines.push(
      [
        csv(b.name),
        money(b.serviceRevenue),
        money(b.productRevenue),
        money(b.tips),
        b.rateLabel,
        money(b.commission),
        money(b.adjustments),
        money(b.shopShare),
        money(b.payout),
        money(b.pendingPayout),
        money(b.paidPayout),
      ].join(','),
    )
  }
  const t = report.totals
  lines.push(
    [
      'TOTAL',
      money(t.serviceRevenue),
      money(t.productRevenue),
      money(t.tips),
      '',
      money(t.commission),
      money(t.adjustments),
      money(t.shopShare),
      money(t.payout),
      money(t.pendingPayout),
      money(t.paidPayout),
    ].join(','),
  )

  lines.push('')
  for (const b of report.barbers) {
    lines.push('')
    lines.push(`Week of ${from.toISOString().slice(0, 10)}`)
    lines.push(csv(b.name))
    lines.push(`Services: ${money(b.serviceRevenue + b.productRevenue)}`)
    lines.push(`Tips: ${money(b.tips)}`)
    lines.push(`Commission: ${money(b.commission + b.adjustments)}`)
    lines.push(`Shop Share: ${money(b.shopShare)}`)
  }
  return lines.join('\n')
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// ─── Date-range presets ─────────────────────────────────────────────────────

export function commissionRange(preset: string, now = new Date(), tz = 'UTC'): { from: Date; to: Date } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const day = (d: Date) => fmt.format(d) // YYYY-MM-DD in shop timezone
  const startOf = (d: Date) => new Date(`${day(d)}T00:00:00Z`)

  const today = startOf(now)
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)

  if (preset === 'today') return { from: today, to: tomorrow }
  if (preset === 'week') {
    const dow = today.getUTCDay() // 0=Sunday
    const monday = new Date(today.getTime() - ((dow + 6) % 7) * 24 * 3600 * 1000)
    return { from: monday, to: new Date(monday.getTime() + 7 * 24 * 3600 * 1000) }
  }
  if (preset === 'month') {
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) }
  }
  throw new Error('preset must be today | week | month')
}
