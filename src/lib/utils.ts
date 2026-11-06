import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes intelligently */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

import crypto from 'crypto'

/** Generate a unique confirmation number: BRB-XXXXX (6 alphanumeric, crypto-based) */
export function generateConfirmationNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no confusing chars (no 0, O, 1, I)
  // randomInt() rejects values outside the range instead of wrapping, so every
  // character is equally likely. The previous `% chars.length` was unbiased too
  // by luck (32 symbols divide 256 evenly), but it is the pattern that becomes
  // biased the moment the alphabet changes length.
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)]
  }
  return `BRB-${code}`
}

/** Generate a cryptographically secure customer access token (64 hex chars = 256 bits) */
export function generateCustomerAccessToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Format a date as "Saturday, August 15, 2026" */
export function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Format a time as "2:30 PM" */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Format duration as "45 minutes" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h} hour${h > 1 ? 's' : ''}`
  return `${h} hr ${m} min`
}

/** Format price as "$35" */
export function formatPrice(price: number): string {
  return `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`
}

/** Get initials from a name */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Validate email format */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Validate US phone number (loose) */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10
}

/** Normalize phone to E.164-ish */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return phone
}

/** Format phone for display as user types: (555) 123-4567 */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
