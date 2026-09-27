/**
 * Payment status machine (Requirement 23).
 *
 * Single source of truth for legal status transitions. Every provider
 * implementation and every API route must go through canTransition /
 * transitionTo — never set `status` directly.
 */
import type { PaymentStatus } from './types'

const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING:    ['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'CANCELED'],
  SUCCEEDED:  ['REFUNDED'],
  FAILED:     ['PENDING'], // retryable
  CANCELED:   [],
  REFUNDED:   [],
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export const TERMINAL_STATUSES: PaymentStatus[] = ['CANCELED', 'REFUNDED']

export function transitionError(from: PaymentStatus, to: PaymentStatus): string {
  return `Illegal payment status transition: ${from} -> ${to}`
}
