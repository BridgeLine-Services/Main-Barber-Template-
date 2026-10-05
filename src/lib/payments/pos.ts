/**
 * Payments & POS core (optional, owner-controlled system).
 *
 * All server-side. The owner's PaymentSettings.enabled master switch
 * gates the whole system: when OFF the shop operates in pay-at-shop
 * mode exactly like before (booking never requires payment, no payment
 * UI, no Stripe dependency). When ON this module powers checkout,
 * tips, fees, receipts, reconciliation and the owner's financial
 * dashboard — always tenant-isolated by businessId.
 */
import { prisma } from '@/lib/prisma'
import { createCommissionsForCheckout } from '@/lib/commissions'
import type { PaymentSettings, Barber, Appointment, Service } from '@prisma/client'

export type PosSettings = PaymentSettings

const DEFAULT_TIP_PRESETS = [15, 18, 20, 25]

/** Resolve settings, creating the safe default row on first read. */
export async function getPosSettings(businessId: string): Promise<PosSettings> {
  const existing = await prisma.paymentSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return prisma.paymentSettings.create({ data: { businessId } })
}

export function isPosEnabled(settings: PosSettings): boolean {
  return settings.enabled
}

/** Owner: everything. Business admin: what existing role allows (history,
 * checkout, no shop-wide financial reports). Barber: own checkout only. */
export function canViewShopFinancials(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

export function canManageSettings(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

export function canRunCheckout(
  session: { role: string; businessId?: string | null; barberId?: string | null },
  settings: PosSettings,
  appointment?: { businessId: string; barberId: string } | null,
): { ok: boolean; reason?: string } {
  if (!settings.enabled) return { ok: false, reason: 'Payments & POS is disabled for this shop' }
  if (session.role === 'OWNER' || session.role === 'PLATFORM_OWNER' || session.role === 'BUSINESS_ADMIN') {
    if (!appointment || appointment.businessId === session.businessId) return { ok: true }
    return { ok: false, reason: 'Appointment belongs to another shop' }
  }
  if (session.role === 'BARBER') {
    if (!settings.allowBarberCheckout) return { ok: false, reason: 'Owner has not enabled barber checkout' }
    if (!appointment) return { ok: false, reason: 'Barbers may only run checkout on appointments' }
    if (appointment.businessId !== session.businessId) return { ok: false, reason: 'Appointment belongs to another shop' }
    if (appointment.barberId !== session.barberId) return { ok: false, reason: 'Barbers may only check out their own appointments' }
    return { ok: true }
  }
  return { ok: false, reason: 'Not permitted to run checkout' }
}

export function tipPresets(settings: PosSettings): number[] {
  const raw = settings.tipPresets
  if (Array.isArray(raw)) {
    const parsed = raw
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100)
    if (parsed.length) return parsed.slice(0, 6)
  }
  return DEFAULT_TIP_PRESETS
}

// ─── Checkout summary ──────────────────────────────────────────────────────

export interface CheckoutLineItem {
  name: string
  amount: number
  kind: 'PRODUCT' | 'CUSTOM'
  inventoryItemId?: string
}

export interface CheckoutSummary {
  appointment: {
    id: string
    confirmationNumber: string
    startTime: string
    endTime: string
    status: string
  }
  customer: { id: string; name: string; email: string | null; phone: string | null } | null
  barber: { id: string; name: string; tipsOptOut: boolean } | null
  service: { id: string; name: string; price: number } | null
  subtotal: number
  discountTotal: number
  taxRatePercent: number
  tax: number
  total: number
  paid: number // succeeded non-tip payments minus refunds
  refunded: number
  remainingBalance: number
  tipsPaid: number
  depositPaid: number
  payments: Array<{
    id: string
    kind: string
    method: string
    provider: string
    amount: number
    status: string
    refundedAmount: number
    createdAt: string
  }>
  settings: {
    enabled: boolean
    tipsEnabled: boolean
    tipPresets: number[]
    taxEnabled: boolean
    taxRatePercent: number
    cardOnFileEnabled: boolean
    allowBarberCheckout: boolean
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function buildCheckoutSummary(businessId: string, appointmentId: string): Promise<CheckoutSummary | null> {
  const [settings, appointment] = await Promise.all([
    getPosSettings(businessId),
    prisma.appointment.findFirst({
      where: { id: appointmentId, businessId }, // tenant-scoped
      include: {
        customer: true,
        barber: true,
        service: true,
        payments: { orderBy: { createdAt: 'asc' } },
      },
    }),
  ])
  if (!appointment) return null

  const servicePrice = appointment.service?.price ?? 0
  const subtotal = round2(servicePrice)
  const succeededPayments = appointment.payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
  const paid = round2(
    succeededPayments
      .filter((p) => p.kind !== 'TIP' && p.kind !== 'REFUND')
      .reduce((sum, p) => sum + (p.amount - p.refundedAmount), 0),
  )
  const refunded = round2(
    appointment.payments
      .filter((p) => p.kind === 'REFUND' && p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + Math.abs(p.amount), 0),
  )
  const tax = settings.taxEnabled ? round2((subtotal * settings.taxRatePercent) / 100) : 0
  const total = round2(subtotal + tax)
  const tipsPaid = round2(
    appointment.payments
      .filter((p) => p.kind === 'TIP' && p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amount, 0),
  )
  const depositPaid = round2(
    appointment.payments
      .filter((p) => p.kind === 'DEPOSIT' && p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + (p.amount - p.refundedAmount), 0),
  )

  return {
    appointment: {
      id: appointment.id,
      confirmationNumber: appointment.confirmationNumber,
      startTime: appointment.startTime.toISOString(),
      endTime: appointment.endTime.toISOString(),
      status: appointment.status,
    },
    customer: appointment.customer
      ? {
          id: appointment.customer.id,
          name: [appointment.customer.firstName, appointment.customer.lastName].filter(Boolean).join(' ') || 'Customer',
          email: appointment.customer.email,
          phone: appointment.customer.phone,
        }
      : null,
    barber: appointment.barber ? { id: appointment.barber.id, name: appointment.barber.name, tipsOptOut: appointment.barber.tipsOptOut } : null,
    service: appointment.service
      ? { id: appointment.service.id, name: appointment.service.name, price: servicePrice }
      : null,
    subtotal,
    discountTotal: 0, // applied at checkout completion (see completeCheckout)
    taxRatePercent: settings.taxEnabled ? settings.taxRatePercent : 0,
    tax,
    total,
    paid,
    refunded,
    remainingBalance: round2(Math.max(0, total - paid)),
    tipsPaid,
    depositPaid,
    payments: appointment.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      provider: p.provider,
      amount: p.amount,
      status: p.status,
      refundedAmount: p.refundedAmount,
      createdAt: p.createdAt.toISOString(),
    })),
    settings: {
      enabled: settings.enabled,
      tipsEnabled: settings.tipsEnabled,
      tipPresets: tipPresets(settings),
      taxEnabled: settings.taxEnabled,
      taxRatePercent: settings.taxRatePercent,
      cardOnFileEnabled: settings.cardOnFileEnabled,
      allowBarberCheckout: settings.allowBarberCheckout,
    },
  }
}

// ─── Checkout completion (in-person / cash / manual card) ───────────────────

export interface CompleteCheckoutInput {
  businessId: string
  appointmentId: string
  actorId: string
  actorRole: string
  method: 'CASH' | 'IN_PERSON' | 'CARD'
  /** Optional POS additions: products/custom items with sale prices. */
  lineItems?: CheckoutLineItem[]
  /** Flat discount amount, applied to the service subtotal. */
  discountAmount?: number
  tipAmount?: number
  tipPercent?: number
}

export interface CheckoutResult {
  chargePaymentId: string
  tipPaymentId?: string
  total: number
  tax: number
  tip: number
  /** commission ledger summary (only when the shop's commission system is
   *  enabled and the barber participates) — see src/lib/commissions.ts */
  commission?: { rateLabel: string; amount: number }
  receipt: Record<string, unknown>
}

/**
 * Settle an appointment at the shop (cash / in-person / manual card
 * entry on a terminal). Runs in one transaction. Commission rows (if the
 * shop's commission system is enabled) are created in the same
 * transaction via src/lib/commissions.ts, with a summary snapshot kept
 * on the charge's metadata; tips become a SEPARATE ledger row so tip
 * revenue is never mixed with service revenue.
 */
export async function completeCheckout(input: CompleteCheckoutInput): Promise<CheckoutResult> {
  const settings = await getPosSettings(input.businessId)
  if (!settings.enabled) throw new Error('Payments & POS is disabled for this shop')

  const appointment = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, businessId: input.businessId },
    include: { service: true, barber: true, customer: true, payments: true },
  })
  if (!appointment) throw new Error('Appointment not found')

  const lineItems = (input.lineItems ?? [])
    .filter((li) => li.name?.trim() && Number.isFinite(li.amount) && li.amount > 0)
    .map((li) => ({ name: li.name.trim().slice(0, 120), amount: round2(li.amount), kind: li.kind, inventoryItemId: li.inventoryItemId }))
  const servicePrice = appointment.service?.price ?? 0
  const discount = Math.min(round2(input.discountAmount ?? 0), round2(servicePrice))
  const subtotal = round2(servicePrice + lineItems.reduce((s, li) => s + li.amount, 0))
  const taxable = round2(Math.max(0, subtotal - discount))
  const tax = settings.taxEnabled ? round2((taxable * settings.taxRatePercent) / 100) : 0
  const total = round2(taxable + tax)

  let tip = 0
  if (settings.tipsEnabled && !(appointment.barber as Barber | null)?.tipsOptOut) {
    if (input.tipAmount != null && input.tipAmount > 0) tip = round2(input.tipAmount)
    else if (input.tipPercent != null && input.tipPercent > 0) tip = round2((servicePrice * input.tipPercent) / 100)
  }

  const idempotencyKey = `checkout:${appointment.id}:${Date.now()}:${input.actorId}`

  return prisma.$transaction(async (tx) => {
    const charge = await tx.payment.create({
      data: {
        businessId: input.businessId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        barberId: appointment.barberId,
        kind: 'CHARGE',
        method: input.method,
        provider: 'in_person',
        amount: total,
        taxAmount: tax,
        status: 'SUCCEEDED',
        idempotencyKey,
        metadata: {
          lineItems,
          discount,
          serviceSubtotal: servicePrice,
          completedBy: input.actorId,
          completedByRole: input.actorRole,
        } as never,
      },
    })

    let tipPaymentId: string | undefined
    if (tip > 0) {
      const tipRow = await tx.payment.create({
        data: {
          businessId: input.businessId,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          barberId: appointment.barberId,
          kind: 'TIP',
          method: input.method,
          provider: 'in_person',
          amount: tip,
          status: 'SUCCEEDED',
          idempotencyKey: `${idempotencyKey}:tip`,
          metadata: { completedBy: input.actorId } as never,
        },
      })
      tipPaymentId = tipRow.id
    }

    // Commission ledger (optional, owner-controlled): rows are created in
    // the SAME transaction as the charge so payment and commission always
    // commit together. No-op when the shop's commission system is off.
    const commissionEntries = await createCommissionsForCheckout(tx, {
      businessId: input.businessId,
      barberId: appointment.barberId,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      servicePrice,
      discount,
      lineItems,
      tip,
      chargePaymentId: charge.id,
      tipPaymentId,
    })
    const serviceCommission = commissionEntries.find((e) => e.source === 'SERVICE')
    if (serviceCommission) {
      const label =
        serviceCommission.rateType === 'FIXED'
          ? `$${(serviceCommission.rateFixed ?? 0).toFixed(2)} flat`
          : `${serviceCommission.ratePercent ?? 0}%`
      await tx.payment.update({
        where: { id: charge.id },
        data: {
          metadata: {
            lineItems,
            discount,
            serviceSubtotal: servicePrice,
            commissionRate: label,
            commissionAmount: serviceCommission.commissionAmount,
            completedBy: input.actorId,
            completedByRole: input.actorRole,
          } as never,
        },
      })
    }
    const commission = serviceCommission
      ? { rateLabel: serviceCommission.rateType === 'FIXED'
            ? `$${(serviceCommission.rateFixed ?? 0).toFixed(2)} flat`
            : `${serviceCommission.ratePercent ?? 0}%`,
          amount: serviceCommission.commissionAmount }
      : undefined

    const receipt = await buildReceipt(tx, charge.id, tipPaymentId)
    return { chargePaymentId: charge.id, tipPaymentId, total, tax, tip, commission, receipt }
  })
}

// ─── Fees (cancellation / no-show) ─────────────────────────────────────────

export async function chargeFee(opts: {
  businessId: string
  kind: 'CANCELLATION_FEE' | 'NO_SHOW_FEE'
  amount: number
  appointmentId?: string
  customerId?: string
  method?: 'CASH' | 'IN_PERSON' | 'CARD'
  online?: boolean
}): Promise<{ paymentId: string; clientSecret?: string }> {
  const settings = await getPosSettings(opts.businessId)
  if (!settings.enabled) throw new Error('Payments & POS is disabled for this shop')
  const { resolvePaymentProvider } = await import('./index')
  const provider = opts.online
    ? resolvePaymentProvider({ paymentInPerson: false })
    : resolvePaymentProvider({ paymentInPerson: true })
  const result = await prisma.$transaction(async (tx) =>
    provider.createCharge(
      { businessId: opts.businessId, tx },
      {
        amount: round2(opts.amount),
        kind: opts.kind,
        appointmentId: opts.appointmentId,
        customerId: opts.customerId,
        idempotencyKey: `fee:${opts.kind}:${opts.appointmentId ?? 'shop'}:${Date.now()}`,
        metadata: { feeType: opts.kind },
      },
    ),
  )
  if (!result.ok) throw new Error(result.error ?? 'Fee charge failed')
  const clientSecret = (result.payment.metadata as Record<string, unknown> | null)?.clientSecret as string | undefined
  if (!opts.online) {
    // Cash/manual fee: settle immediately, then commission it if the
    // owner opted into no-show fee commissions (see commissions.ts).
    await prisma.payment.update({ where: { id: result.payment.id }, data: { status: 'SUCCEEDED' } })
    if (opts.kind === 'NO_SHOW_FEE') {
      const { recordCommissionForFeePayment } = await import('@/lib/commissions')
      await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, opts.businessId, result.payment.id))
    }
  }
  return { paymentId: result.payment.id, clientSecret }
}

// ─── Receipt ────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export async function buildReceipt(tx: Tx, paymentId: string, tipPaymentId?: string) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      business: true,
      appointment: { include: { service: true, barber: true, customer: true } },
      customer: true,
    },
  })
  if (!payment) throw new Error('Payment not found')
  const md = (payment.metadata ?? {}) as Record<string, unknown>
  const tipRow = tipPaymentId ? await tx.payment.findUnique({ where: { id: tipPaymentId } }) : null
  const business = payment.business
  return {
    shop: {
      name: business.name,
      phone: business.phone,
      email: business.email,
      address: [business.address, business.city, business.state, business.zipCode].filter(Boolean).join(', ') || null,
    },
    customer: payment.customer ? { name: [payment.customer.firstName, payment.customer.lastName].filter(Boolean).join(' ') || 'Customer', email: payment.customer.email } : null,
    barber: payment.appointment?.barber ? { name: payment.appointment.barber.name } : null,
    appointment: payment.appointment
      ? {
          confirmationNumber: payment.appointment.confirmationNumber,
          startTime: payment.appointment.startTime.toISOString(),
          service: payment.appointment.service?.name ?? null,
        }
      : null,
    services: [{ name: payment.appointment?.service?.name ?? 'Service', amount: (md.serviceSubtotal as number) ?? payment.amount }],
    products: Array.isArray(md.lineItems) ? (md.lineItems as CheckoutLineItem[]) : [],
    discount: (md.discount as number) ?? 0,
    subtotal: (md.serviceSubtotal as number) ?? payment.amount,
    tax: payment.taxAmount,
    tip: tipRow?.amount ?? 0,
    total: payment.amount,
    paymentMethod: payment.method,
    status: payment.status,
    reference: payment.id,
    stripeRef: payment.providerRefId,
    createdAt: payment.createdAt.toISOString(),
  }
}

export type { Service, Appointment }
