/**
 * The words on the growth screens.
 *
 * Two rules run through everything here. A number that could not be read is never shown
 * as zero, and never as a dash that reads like zero: it says what happened and what the
 * person can do about it. And every metric carries a sentence explaining what it means,
 * because "referral conversion rate" is not everyday language.
 */

import type { Answer, BarberAnalyticsResult, RevenueBreakdown } from './barber-analytics'
import type { ReferralMetrics } from './referrals'

/** Used everywhere a figure is unknown. One string, so it cannot drift. */
export const UNKNOWN = 'Could not verify'

export interface MetricRow {
  id: string
  label: string
  value: string
  meaning: string
  unknown: boolean
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return UNKNOWN
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatCount(value: number | null): string {
  if (value === null) return UNKNOWN
  return value.toLocaleString('en-US')
}

export function formatPercent(value: number | null): string {
  if (value === null) return UNKNOWN
  return `${value.toLocaleString('en-US')}%`
}

/** On, off, or honestly unknown. Never assume off when the read failed. */
export function describeProgramState(enabled: boolean | null): { label: string; meaning: string; unknown: boolean } {
  if (enabled === null) {
    return {
      label: UNKNOWN,
      meaning: 'We could not read whether your referral program is on. Nothing has been changed.',
      unknown: true,
    }
  }
  return enabled
    ? {
        label: 'On',
        meaning: 'Customers can share their referral link, and new bookings through it are credited to them.',
        unknown: false,
      }
    : {
        label: 'Off',
        meaning: 'No new referral links are being credited. Existing codes and past results stay exactly as they are.',
        unknown: false,
      }
}

export function whatTheProgramDoes(): string {
  return 'When the referral program is on, each customer can share a personal link. A new customer who books through that link is recorded as referred by them, so you can see which customers bring other customers in. Turning it on does not change any existing booking, price or customer record.'
}

export function referralMetricRows(metrics: ReferralMetrics): MetricRow[] {
  return [
    {
      id: 'referred',
      label: 'Customers who came from a referral',
      value: formatCount(metrics.referredCustomers),
      meaning: 'People who booked through a customer’s referral link.',
      unknown: false,
    },
    {
      id: 'converted',
      label: 'Of those, who booked',
      value: formatCount(metrics.converted),
      meaning: 'Referred customers who have at least one completed booking.',
      unknown: false,
    },
    {
      id: 'conversion',
      label: 'Referral conversion',
      value: formatPercent(metrics.conversionRate),
      meaning: 'The share of referred customers who went on to book.',
      unknown: metrics.conversionRate === null,
    },
    {
      id: 'repeat',
      label: 'Referred customers who came back',
      value: formatCount(metrics.repeatBookings),
      meaning: 'Referred customers with more than one completed booking.',
      unknown: false,
    },
    {
      id: 'revenue',
      label: 'Money from referred customers',
      value: formatMoney(metrics.referralRevenueCents),
      meaning: 'What referred customers have paid you, after refunds.',
      unknown: metrics.referralRevenueCents === null,
    },
    {
      id: 'share',
      label: 'Share of your takings',
      value: formatPercent(metrics.shareOfRevenuePercent),
      meaning: 'How much of all the money you took came from referred customers.',
      unknown: metrics.shareOfRevenuePercent === null,
    },
  ]
}

/** What to say when there is nothing to show yet, and what to do next. */
export function referralEmptyState(enabled: boolean | null, metrics: ReferralMetrics): string {
  if (enabled === null) {
    return 'We could not read your referral results just now. Reload the page in a moment; nothing has been changed.'
  }
  if (metrics.referredCustomers === 0) {
    return enabled
      ? 'No referrals yet. Your program is on, so once a customer shares their link and someone books through it, their results will appear here.'
      : 'No referrals yet. The program is off, so no new links are being credited. Turn it on when you are ready, then share a customer’s link.'
  }
  return ''
}

export function revenueRows(revenue: RevenueBreakdown): MetricRow[] {
  return [
    { id: 'gross', label: 'Money taken', value: formatMoney(revenue.grossCents), meaning: 'Everything your customers paid, before refunds.', unknown: revenue.grossCents === null },
    { id: 'refunds', label: 'Refunds', value: formatMoney(revenue.refundsCents), meaning: 'Money you gave back.', unknown: revenue.refundsCents === null },
    { id: 'net', label: 'Money after refunds', value: formatMoney(revenue.netCents), meaning: 'What you actually kept from those payments.', unknown: revenue.netCents === null },
    { id: 'tips', label: 'Tips', value: formatMoney(revenue.tipsCents), meaning: 'Tips recorded against those payments.', unknown: revenue.tipsCents === null },
    { id: 'commission', label: 'Commission owed to staff', value: formatMoney(revenue.commissionsCents), meaning: 'Money that is not yours to keep.', unknown: revenue.commissionsCents === null },
    {
      id: 'expenses',
      label: 'Recorded expenses',
      value: UNKNOWN,
      meaning: 'This template has no expense ledger, so expenses are unknown rather than zero. No profit figure is shown, because profit from unknown expenses would be wrong.',
      unknown: true,
    },
  ]
}

/** Answers, with an unknown one never dressed up as a result. */
export function answerRows(result: BarberAnalyticsResult): Array<{ id: string; question: string; answer: string; basis: string; unknown: boolean }> {
  return result.answers.map((entry: Answer) => ({
    id: entry.id,
    question: entry.question,
    answer: entry.unknown || entry.answer === null
      ? `${UNKNOWN}. ${entry.basis}`
      : entry.answer,
    basis: entry.basis,
    unknown: entry.unknown || entry.answer === null,
  }))
}

/** Range options the analytics API supports today. */
export const PERFORMANCE_RANGES: Array<{ days: number; label: string }> = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
]
