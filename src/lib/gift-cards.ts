/**
 * Gift cards (optional, owner-controlled system).
 *
 * All server-side. The owner's GiftCardSettings.enabled master switch gates
 * purchases and redemptions; when OFF, existing cards and their full
 * transaction history remain intact. Codes are server-generated (globally
 * unique, unambiguous charset, ~79 bits of entropy), never client-chosen.
 * Redemption is race-safe: balances are decremented with a conditional
 * atomic UPDATE (remainingBalance >= amount) inside the surrounding
 * transaction, so two simultaneous redemptions can never overdraw a card.
 *
 * Gift cards integrate with the existing Payment ledger: a redemption is a
 * Payment row (method GIFT_CARD) on the appointment, so receipts, refunds,
 * and financial reporting keep working unchanged. Refunding a redemption
 * restores the card balance (never more than the refunded amount); refunding
 * the purchase payment reduces the card balance.
 *
 * Never a stored-value/payment-provider substitute: this is shop bookkeeping
 * for gift cards the shop itself issues.
 */
import { randomInt } from 'crypto'
import type { Prisma, GiftCard, GiftCardTransaction } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { GiftCardSettings } from '@prisma/client'

type Tx = Prisma.TransactionClient

// ─── Errors ─────────────────────────────────────────────────────────────────

export type GiftCardErrorCode =
  | 'GIFT_CARDS_DISABLED'
  | 'INVALID_CODE'
  | 'INSUFFICIENT_BALANCE'
  | 'CARD_NOT_ACTIVE'
  | 'CARD_EXPIRED'
  | 'CONCURRENT_REDEMPTION'
  | 'INVALID_AMOUNT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'

export class GiftCardError extends Error {
  code: GiftCardErrorCode
  constructor(code: GiftCardErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export const DEFAULT_DENOMINATIONS = [25, 50, 75, 100]
export const MIN_CUSTOM_AMOUNT = 1
export const MAX_CUSTOM_AMOUNT = 5000

/** Shop-level settings, lazily created with the safe defaults (OFF). */
export async function getGiftCardSettings(businessId: string): Promise<GiftCardSettings> {
  const existing = await prisma.giftCardSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return prisma.giftCardSettings.create({ data: { businessId } })
}

export function giftCardDenominations(settings: GiftCardSettings): number[] {
  const raw = settings.denominations as unknown
  if (Array.isArray(raw)) {
    const parsed = raw
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((v) => Number.isFinite(v) && v >= MIN_CUSTOM_AMOUNT && v <= MAX_CUSTOM_AMOUNT)
    if (parsed.length) return Array.from(new Set(parsed)).sort((a, b) => a - b).slice(0, 8)
  }
  return DEFAULT_DENOMINATIONS
}

/** Managing gift cards (settings, manual adjustments, reporting) is OWNER
 * authority. Selling cards in the POS follows the shop's POS checkout
 * permissions (see canSellGiftCards). */
export function canManageGiftCards(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

export function canSellGiftCards(
  session: { role: string },
  posSettings: { allowBarberCheckout: boolean },
): boolean {
  if (canManageGiftCards(session.role) || session.role === 'BUSINESS_ADMIN') return true
  if (session.role === 'BARBER') return posSettings.allowBarberCheckout
  return false
}

// ─── Code generation ────────────────────────────────────────────────────────

// 31-symbol unambiguous alphabet (no 0/O, 1/I/l, no U) — 16 chars ≈ 79 bits.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_GROUPS = 4

/** Server-side code generation. Never accept codes from the client. */
export function generateGiftCardCode(): string {
  const groups: string[] = []
  for (let g = 0; g < CODE_GROUPS; g++) {
    let part = ''
    for (let i = 0; i < 4; i++) part += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    groups.push(part)
  }
  return groups.join('-')
}

export function normalizeGiftCardCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

async function createUniqueCode(tx: Tx): Promise<string> {
  // Retry on the (astronomically unlikely) collision with the unique index.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGiftCardCode()
    const clash = await tx.giftCard.findUnique({ where: { code }, select: { id: true } })
    if (!clash) return code
  }
  throw new GiftCardError('INVALID_CODE', 'Could not generate a unique gift card code')
}

// ─── Validation ─────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

export function validateGiftCardAmount(amount: number): number {
  const n = round2(amount)
  if (!Number.isFinite(n) || n < MIN_CUSTOM_AMOUNT || n > MAX_CUSTOM_AMOUNT) {
    throw new GiftCardError('INVALID_AMOUNT', `Gift card amount must be between $${MIN_CUSTOM_AMOUNT} and $${MAX_CUSTOM_AMOUNT}`)
  }
  return n
}

/** Is this card redeemable right now? (status + expiry, not balance). */
export function isRedeemable(card: Pick<GiftCard, 'status' | 'expiresAt'>, now = new Date()): boolean {
  if (card.status !== 'ACTIVE') return false
  if (card.expiresAt && card.expiresAt.getTime() <= now.getTime()) return false
  return true
}

// ─── Selling (purchase) ─────────────────────────────────────────────────────

export interface SellGiftCardInput {
  businessId: string
  amount: number
  type?: 'DIGITAL' | 'PHYSICAL'
  purchaserName: string
  purchaserEmail?: string | null
  purchaserCustomerId?: string | null
  recipientName?: string | null
  recipientEmail?: string | null
  message?: string | null
  soldByUserId?: string | null
  /** POS sale (cash/in-person/card tender taken at the shop): creates a
   * SUCCEEDED payment and an ACTIVE card in one transaction. */
  purchaseMethod?: 'CASH' | 'IN_PERSON' | 'CARD'
  /** External purchase payment (e.g. a PENDING online Stripe charge).
   * The card is created PENDING and activates when the payment settles
   * (see activateGiftCardForPayment / the Stripe webhook). */
  purchasePaymentId?: string
  tx?: Tx
}

export interface SoldGiftCard {
  giftCard: GiftCard
  purchaseTransaction: GiftCardTransaction
  paymentId: string | null
}

/**
 * Sell a gift card (staff POS sale or customer purchase). Creates, in one
 * transaction: the Payment (unless a paymentId for an existing pending
 * payment is supplied), the GiftCard, and the PURCHASE ledger row.
 *
 * Master switch must be ON; the amount is validated server-side.
 */
export async function sellGiftCard(input: SellGiftCardInput): Promise<SoldGiftCard> {
  const settings = await getGiftCardSettings(input.businessId)
  if (!settings.enabled) throw new GiftCardError('GIFT_CARDS_DISABLED', 'Gift cards are disabled for this shop')

  const amount = validateGiftCardAmount(input.amount)
  const purchaserName = (input.purchaserName ?? '').trim().slice(0, 120)
  if (!purchaserName) throw new GiftCardError('INVALID_AMOUNT', 'Purchaser name is required')

  const expiresAt =
    settings.defaultValidityMonths > 0
      ? new Date(Date.now() + settings.defaultValidityMonths * 30 * 24 * 3600 * 1000)
      : null

  if (!input.purchaseMethod && !input.purchasePaymentId) {
    throw new GiftCardError('INVALID_AMOUNT', 'A purchase payment (POS tender or online charge) is required')
  }

  const run = async (tx: Tx) => {
    let paymentId = input.purchasePaymentId ?? null

    if (!paymentId) {
      const payment = await tx.payment.create({
        data: {
          businessId: input.businessId,
          kind: 'CHARGE',
          method: input.purchaseMethod!,
          provider: 'in_person',
          amount,
          status: 'SUCCEEDED',
          barberId: null,
          appointmentId: null,
          metadata: { giftCardPurchase: true } as never,
        },
      })
      paymentId = payment.id
    }

    const code = await createUniqueCode(tx)
    const giftCard = await tx.giftCard.create({
      data: {
        businessId: input.businessId,
        code,
        type: input.type ?? 'DIGITAL',
        initialValue: amount,
        remainingBalance: amount,
        status: input.purchasePaymentId ? 'PENDING' : 'ACTIVE',
        purchaserName,
        purchaserEmail: input.purchaserEmail?.trim().slice(0, 200) || null,
        purchaserCustomerId: input.purchaserCustomerId ?? null,
        recipientName: input.recipientName?.trim().slice(0, 120) || null,
        recipientEmail: input.recipientEmail?.trim().slice(0, 200) || null,
        message: input.message?.trim().slice(0, 500) || null,
        soldByUserId: input.soldByUserId ?? null,
        purchasePaymentId: paymentId,
        expiresAt,
      },
    })

    const purchaseTransaction = await tx.giftCardTransaction.create({
      data: {
        businessId: input.businessId,
        giftCardId: giftCard.id,
        type: 'PURCHASE',
        amount,
        balanceAfter: amount,
        paymentId,
        actorUserId: input.soldByUserId ?? null,
        note: `Sold ${input.type === 'PHYSICAL' ? 'physical' : 'digital'} card`,
      },
    })

    return { giftCard, purchaseTransaction, paymentId }
  }

  if (input.tx) return run(input.tx)
  return prisma.$transaction(run)
}

/** Activate a PENDING card once its purchase payment settles (online
 * purchases). Idempotent — no-op for already-active/depleted cards. */
export async function activateGiftCardForPayment(paymentId: string): Promise<void> {
  let activated: {
    id: string; businessId: string; code: string; amount: number; expiresAt: Date | null
    purchaserName: string; purchaserEmail: string | null
    recipientName: string | null; recipientEmail: string | null
    message: string | null
  } | null = null

  await prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findFirst({ where: { purchasePaymentId: paymentId } })
    if (!card || card.status !== 'PENDING') return
    await tx.giftCard.update({ where: { id: card.id }, data: { status: 'ACTIVE' } })
    activated = {
      id: card.id, businessId: card.businessId, code: card.code, amount: card.initialValue,
      expiresAt: card.expiresAt, purchaserName: card.purchaserName,
      purchaserEmail: card.purchaserEmail, recipientName: card.recipientName,
      recipientEmail: card.recipientEmail, message: card.message,
    }
  })

  // Digital cards bought online must reach the purchaser — email the card
  // (to the recipient when provided, else the purchaser). Best-effort:
  // a mail outage never rolls back or blocks the activation itself.
  if (activated) {
    const card = activated
    try {
      const to = card.recipientEmail?.trim() || card.purchaserEmail?.trim()
      if (to) {
        const business = await prisma.business.findUnique({
          where: { id: card.businessId },
          select: { name: true },
        })
        const { sendGiftCardDeliveryEmail } = await import('@/lib/notifications')
        await sendGiftCardDeliveryEmail({
          to,
          businessName: business?.name ?? 'the barbershop',
          purchaserName: card.purchaserName,
          recipientName: card.recipientName,
          code: card.code,
          amount: card.amount,
          expiresAt: card.expiresAt,
          message: card.message,
        })
      }
    } catch {
      // Email delivery is best-effort; activation already committed.
    }
  }
}

/**
 * Public status lookup (website purchase flow): returns ONLY the card's
 * status for the given tenant — never the code or balance. Used by the
 * success screen to poll until the payment webhook activates the card.
 */
export async function getGiftCardStatus(
  businessId: string,
  giftCardId: string,
): Promise<'PENDING' | 'ACTIVE' | 'DEPLETED' | null> {
  const card = await prisma.giftCard.findFirst({
    where: { id: giftCardId, businessId },
    select: { status: true },
  })
  return card?.status ?? null
}

// ─── Redemption (race-safe) ──────────────────────────────────────────────────

export interface RedemptionContext {
  businessId: string
  appointmentId?: string | null
  actorUserId?: string | null
}

/**
 * Atomically redeem up to `requested` from a card. Runs inside the caller's
 * transaction (checkout). The balance decrement is a conditional UPDATE
 * (remainingBalance >= applied AND status ACTIVE AND not expired), so two
 * concurrent checkouts can never overdraw the card — the loser gets
 * CONCURRENT_REDEMPTION and the whole checkout rolls back.
 *
 * Creates the GIFT_CARD Payment row so the redemption flows through the
 * existing payment ledger (receipts, refunds, reporting).
 */
export async function redeemGiftCardInTx(
  tx: Tx,
  ctx: RedemptionContext,
  code: string,
  requested: number,
): Promise<{ giftCardId: string; code: string; applied: number; balanceAfter: number; paymentId: string }> {
  const settings = await tx.giftCardSettings.findUnique({ where: { businessId: ctx.businessId } })
  if (!settings?.enabled) throw new GiftCardError('GIFT_CARDS_DISABLED', 'Gift cards are disabled for this shop')

  const normalized = normalizeGiftCardCode(code)
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(normalized)) {
    throw new GiftCardError('INVALID_CODE', 'Invalid gift card code')
  }

  const card = await tx.giftCard.findFirst({ where: { code: normalized, businessId: ctx.businessId } })
  if (!card) throw new GiftCardError('INVALID_CODE', 'Gift card not found')
  if (card.status === 'PENDING') throw new GiftCardError('CARD_NOT_ACTIVE', 'Gift card is not active yet')
  if (card.status === 'DEPLETED') throw new GiftCardError('INSUFFICIENT_BALANCE', 'Gift card has no remaining balance')
  if (card.expiresAt && card.expiresAt.getTime() <= Date.now()) {
    throw new GiftCardError('CARD_EXPIRED', 'Gift card has expired')
  }

  const applied = round2(Math.min(requested, card.remainingBalance))
  if (applied <= 0) throw new GiftCardError('INSUFFICIENT_BALANCE', 'Gift card has no remaining balance')

  // Race-safe conditional decrement — the money is only taken if the
  // balance is still there at UPDATE time.
  const update = await tx.giftCard.updateMany({
    where: {
      id: card.id,
      status: 'ACTIVE',
      remainingBalance: { gte: applied },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: {
      remainingBalance: { decrement: applied },
      ...(applied >= round2(card.remainingBalance) ? { status: 'DEPLETED' as const } : {}),
    },
  })
  if (update.count !== 1) {
    throw new GiftCardError('CONCURRENT_REDEMPTION', 'Gift card balance changed — please retry')
  }

  const balanceAfter = round2(card.remainingBalance - applied)

  const payment = await tx.payment.create({
    data: {
      businessId: ctx.businessId,
      appointmentId: ctx.appointmentId ?? null,
      kind: 'CHARGE',
      method: 'GIFT_CARD',
      provider: 'gift_card',
      amount: applied,
      status: 'SUCCEEDED',
      idempotencyKey: `giftcard:${card.id}:${Date.now()}:${ctx.actorUserId ?? 'web'}`,
      metadata: { giftCardId: card.id, giftCardCode: card.code } as never,
    },
  })

  await tx.giftCardTransaction.create({
    data: {
      businessId: ctx.businessId,
      giftCardId: card.id,
      type: 'REDEMPTION',
      amount: applied,
      balanceAfter,
      paymentId: payment.id,
      appointmentId: ctx.appointmentId ?? null,
      actorUserId: ctx.actorUserId ?? null,
    },
  })

  return { giftCardId: card.id, code: card.code, applied, balanceAfter, paymentId: payment.id }
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/**
 * Keep gift card balances in sync with a refunded Payment. Two cases:
 *   1. A GIFT_CARD redemption was refunded → give the money back to the
 *      card (never more than the refunded amount).
 *   2. A gift card PURCHASE payment was refunded → remove the refunded
 *      value from the card (clamped at 0; the shop owes the purchaser cash).
 * Called inside the refund transaction. Idempotent — recomputed from the
 * payment's refundedAmount.
 */
export async function adjustGiftCardForRefund(tx: Tx, businessId: string, paymentId: string): Promise<void> {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId } })
  if (!payment) return
  const refunded = round2(payment.refundedAmount)

  if (payment.method === 'GIFT_CARD') {
    const card = await tx.giftCard.findFirst({ where: { businessId, code: (payment.metadata as Record<string, unknown> | null)?.giftCardCode as string | undefined } })
    if (!card) return
    const alreadyRestored = await tx.giftCardTransaction.aggregate({
      where: { giftCardId: card.id, type: 'REFUND', paymentId: payment.id },
      _sum: { amount: true },
    })
    const toRestore = round2(Math.max(0, refunded - (alreadyRestored._sum.amount ?? 0)))
    if (toRestore <= 0) return
    await tx.giftCard.update({
      where: { id: card.id },
      data: { remainingBalance: { increment: toRestore }, status: 'ACTIVE' },
    })
    const fresh = await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } })
    await tx.giftCardTransaction.create({
      data: {
        businessId,
        giftCardId: card.id,
        type: 'REFUND',
        amount: toRestore,
        balanceAfter: fresh.remainingBalance,
        paymentId: payment.id,
        note: 'Redemption refunded — balance restored',
      },
    })
    return
  }

  // Refunding the card's purchase payment removes value from the card.
  const card = await tx.giftCard.findFirst({ where: { businessId, purchasePaymentId: payment.id } })
  if (!card) return
  const alreadyRemoved = await tx.giftCardTransaction.aggregate({
    where: { giftCardId: card.id, type: 'REFUND', paymentId: payment.id },
    _sum: { amount: true },
  })
  const toRemove = round2(Math.max(0, refunded - (alreadyRemoved._sum.amount ?? 0)))
  if (toRemove <= 0) return
  const removable = round2(Math.min(toRemove, card.remainingBalance))
  if (removable <= 0) return
  const update = await tx.giftCard.updateMany({
    where: { id: card.id, remainingBalance: { gte: removable } },
    data: { remainingBalance: { decrement: removable } },
  })
  if (update.count !== 1) return
  const fresh = await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } })
  await tx.giftCardTransaction.create({
    data: {
      businessId,
      giftCardId: card.id,
      type: 'REFUND',
      amount: removable,
      balanceAfter: fresh.remainingBalance,
      paymentId: payment.id,
      note: 'Purchase refunded — value removed from card',
    },
  })
}

// ─── Owner manual adjustment ────────────────────────────────────────────────

/**
 * Owner manual balance correction for physical cards (mis-prints, manual
 * gift cards predating the system). Append-only ledger row; the balance
 * itself is clamped to [0, initialValue].
 */
export async function adjustGiftCardBalance(
  businessId: string,
  giftCardId: string,
  amount: number,
  note: string,
  actorUserId: string,
): Promise<GiftCard> {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new GiftCardError('INVALID_AMOUNT', 'Adjustment amount must be nonzero')
  }
  const reason = (note ?? '').trim().slice(0, 300)
  if (!reason) throw new GiftCardError('INVALID_AMOUNT', 'Adjustment reason is required')

  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findFirst({ where: { id: giftCardId, businessId } })
    if (!card) throw new GiftCardError('NOT_FOUND', 'Gift card not found')

    const delta = round2(amount)
    const newBalance = round2(card.remainingBalance + delta)
    if (newBalance < 0) throw new GiftCardError('INVALID_AMOUNT', 'Adjustment would make the balance negative')
    if (newBalance > round2(card.initialValue) && delta > 0) {
      throw new GiftCardError('INVALID_AMOUNT', 'Adjustment would exceed the card\u2019s initial value')
    }

    const updated = await tx.giftCard.update({
      where: { id: card.id },
      data: {
        remainingBalance: newBalance,
        status: newBalance <= 0 ? 'DEPLETED' : 'ACTIVE',
      },
    })
    await tx.giftCardTransaction.create({
      data: {
        businessId,
        giftCardId: card.id,
        type: 'ADJUSTMENT',
        amount: Math.abs(delta),
        balanceAfter: newBalance,
        actorUserId,
        note: `${delta > 0 ? '+' : '-'}$${Math.abs(delta).toFixed(2)} — ${reason}`,
      },
    })
    return updated
  })
}

// ─── Reporting ───────────────────────────────────────────────────────────────

export interface GiftCardSummary {
  soldCount: number
  soldAmount: number
  redeemedCount: number
  redeemedAmount: number
  refundAmount: number
  outstandingLiability: number
  activeCount: number
  pendingCount: number
  depletedCount: number
  expiredCount: number
}

/** Owner reporting: what was sold, what was redeemed, and the shop's
 * outstanding gift card liability (remaining balances of redeemable
 * cards). */
export async function giftCardSummary(businessId: string): Promise<GiftCardSummary> {
  const now = new Date()
  const cards = await prisma.giftCard.findMany({
    where: { businessId },
    select: { status: true, remainingBalance: true, initialValue: true, expiresAt: true },
  })
  const txns = await prisma.giftCardTransaction.groupBy({
    by: ['type'],
    where: { businessId },
    _count: { _all: true },
    _sum: { amount: true },
  })
  const sold = txns.find((t) => t.type === 'PURCHASE')
  const redeemed = txns.find((t) => t.type === 'REDEMPTION')
  const refunded = txns.find((t) => t.type === 'REFUND')

  const expired = (c: (typeof cards)[number]) => !!c.expiresAt && c.expiresAt.getTime() <= now.getTime()
  const isLiability = (c: (typeof cards)[number]) => c.status === 'ACTIVE' && !expired(c)

  const round = (n: number) => Math.round(n * 100) / 100
  return {
    soldCount: sold?._count._all ?? 0,
    soldAmount: round(sold?._sum.amount ?? 0),
    redeemedCount: redeemed?._count._all ?? 0,
    redeemedAmount: round(redeemed?._sum.amount ?? 0),
    refundAmount: round(refunded?._sum.amount ?? 0),
    outstandingLiability: round(
      cards.filter(isLiability).reduce((sum, c) => sum + c.remainingBalance, 0),
    ),
    activeCount: cards.filter((c) => c.status === 'ACTIVE' && !expired(c)).length,
    pendingCount: cards.filter((c) => c.status === 'PENDING').length,
    depletedCount: cards.filter((c) => c.status === 'DEPLETED').length,
    expiredCount: cards.filter(expired).length,
  }
}

/** Owner list with filters, tenant-scoped, newest first. */
export async function listGiftCards(
  businessId: string,
  opts: { status?: 'PENDING' | 'ACTIVE' | 'DEPLETED'; search?: string; limit?: number } = {},
): Promise<Array<GiftCard & { transactionCount: number }>> {
  const where: Prisma.GiftCardWhereInput = { businessId }
  if (opts.status) where.status = opts.status
  if (opts.search?.trim()) {
    const q = opts.search.trim()
    where.OR = [
      { code: { contains: q.toUpperCase() } },
      { purchaserName: { contains: q, mode: 'insensitive' } },
      { recipientName: { contains: q, mode: 'insensitive' } },
    ]
  }
  return prisma.giftCard.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 200, 500),
    include: { _count: { select: { transactions: true } } },
  }).then((rows) => rows.map(({ _count, ...card }) => ({ ...card, transactionCount: _count.transactions })))
}

/** Card detail + transaction history (owner). Tenant-scoped. */
export async function getGiftCardDetail(businessId: string, giftCardId: string): Promise<{
  giftCard: GiftCard
  transactions: Array<GiftCardTransaction>
} | null> {
  const giftCard = await prisma.giftCard.findFirst({
    where: { id: giftCardId, businessId },
  })
  if (!giftCard) return null
  const transactions = await prisma.giftCardTransaction.findMany({
    where: { giftCardId: giftCard.id },
    orderBy: { createdAt: 'asc' },
  })
  return { giftCard, transactions }
}
