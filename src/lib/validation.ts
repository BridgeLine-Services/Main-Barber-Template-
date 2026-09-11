// ============================================================================
// Validation Schemas (Zod)
// Every API route MUST validate input with these schemas before processing.
// ============================================================================

import { z } from 'zod'

// ─── Booking ───────────────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  barberId: z.string().min(1).optional(), // can be "any"
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  time: z.string().min(1),
  customer: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    phone: z.string().min(7).max(20),
    email: z.string().email().max(100),
    notes: z.string().max(1000).optional(),
    smsConsent: z.boolean().optional(),
    answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())])).optional(),
  }),
  policiesAcceptedAt: z.string().datetime().optional(),
  policyVersion: z.string().max(100).optional(),
})

export const cancelByTokenSchema = z.object({
  reason: z.string().max(500).optional(),
})

export const lookupAppointmentSchema = z.object({
  confirmationNumber: z.string().min(1).max(20),
})

// ─── Dashboard: Appointments ───────────────────────────────────────────────

export const createManualAppointmentSchema = z.object({
  customerId: z.string().optional(),
  customerData: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    phone: z.string().min(7).max(20),
    email: z.string().email().max(100),
    notes: z.string().max(1000).optional(),
    smsConsent: z.boolean().optional(),
  }).optional(),
  barberId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  time: z.string().min(1),
  notes: z.string().max(1000).optional(),
})

export const updateAppointmentSchema = z.object({
  status: z.enum([
    'PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
    'RESCHEDULED',
  ]).optional(),
  startTime: z.string().optional(), // ISO string for reschedule
  cancellationReason: z.string().max(500).optional(),
  noShowReason: z.string().max(500).optional(),
})

// ─── Dashboard: Services ───────────────────────────────────────────────────

export const createServiceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  duration: z.number().int().min(5).max(480), // 5 min to 8 hours
  price: z.number().min(0).max(10000),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
  barberIds: z.array(z.string()).optional(),
})

export const updateServiceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  duration: z.number().int().min(5).max(480).optional(),
  price: z.number().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
  barberIds: z.array(z.string()).optional(),
})

// ─── Dashboard: Barbers ────────────────────────────────────────────────────

export const createBarberSchema = z.object({
  name: z.string().min(1).max(100),
  specialty: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  photo: z.string().url().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
  serviceIds: z.array(z.string()).optional(),
})

export const updateBarberSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  specialty: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  photo: z.string().url().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
  serviceIds: z.array(z.string()).optional(),
})

// ─── Dashboard: Schedule ───────────────────────────────────────────────────

export const scheduleEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:mm'),
  isOff: z.boolean(),
  breaks: z.array(z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
})

// ─── Dashboard: Blocked Time ───────────────────────────────────────────────

export const createBlockedTimeSchema = z.object({
  barberId: z.string().optional().nullable(),
  startTime: z.string(), // ISO string
  endTime: z.string(), // ISO string
  reason: z.string().max(500).optional(),
})

// ─── Dashboard: Customer ───────────────────────────────────────────────────

export const updateCustomerSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: z.string().min(7).max(20).optional(),
  email: z.string().email().max(100).optional(),
  notes: z.string().max(2000).optional(),
  smsConsent: z.boolean().optional(),
})

// ─── Contact Form ──────────────────────────────────────────────────────────

export const contactFormSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(100),
  message: z.string().min(1).max(5000),
})

// ─── Business Settings ─────────────────────────────────────────────────────

export const updateBusinessSchema = z.object({
  // Business identity
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(100).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().max(50).optional(),

  // Branding
  logo: z.string().url().max(2000).optional().or(z.literal('').optional()),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).max(20).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).max(20).optional(),

  // Social media
  instagram: z.string().max(100).optional(),
  facebook: z.string().max(100).optional(),
  tiktok: z.string().max(100).optional(),
  youtube: z.string().max(100).optional(),
  xTwitter: z.string().max(100).optional(),
  googleBusinessProfile: z.string().max(200).optional(),

  // Content
  aboutText: z.string().max(5000).optional(),
  teamSectionLabel: z.string().max(100).optional(),
  teamSectionTitle: z.string().max(500).optional(),
  teamSectionDescription: z.string().max(2000).optional(),
  hours: z.record(z.string(), z.any()).optional(),

  // Policies
  bookingPolicy: z.string().max(5000).optional(),
  cancellationPolicy: z.string().max(5000).optional(),
  latePolicy: z.string().max(5000).optional(),
  noShowPolicyText: z.string().max(5000).optional(),
  paymentPolicy: z.string().max(5000).optional(),
  privacyPolicy: z.string().max(10000).optional(),
  termsPolicy: z.string().max(10000).optional(),
  walkInsWelcome: z.boolean().optional(),
  parkingAvailable: z.boolean().optional(),
  paymentInPerson: z.boolean().optional(),
  customerRescheduleEnabled: z.boolean().optional(),
  customerRescheduleMinNoticeHours: z.number().int().min(0).max(720).optional(),
  customerRescheduleWindowDays: z.number().int().min(1).max(3650).nullable().optional(),
})

export const bookingQuestionSchema = z.object({
  label: z.string().min(1).max(160),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers, and underscores'),
  type: z.enum(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'PHONE', 'EMAIL', 'DATE']),
  required: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  helpText: z.string().max(500).nullable().optional(),
  options: z.array(z.string().min(1).max(100)).max(20).nullable().optional(),
})

export const rescheduleByTokenSchema = z.object({
  startTime: z.string().datetime(),
})

// ─── SEO Settings ───────────────────────────────���───────────────────────────

export const updateBusinessSEOSchema = z.object({
  siteTitle: z.string().max(200).optional(),
  siteDescription: z.string().max(2000).optional(),
  keywords: z.string().max(2000).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(2000).optional(),
  ogImage: z.string().url().max(2000).optional().or(z.literal('').optional()),
  canonicalUrl: z.string().url().max(2000).optional().or(z.literal('').optional()),
  robotsIndex: z.boolean().optional(),
  robotsFollow: z.boolean().optional(),
  googleVerification: z.string().max(200).optional(),
})

// ─── Barber Profile (self-service) ─────────────────────────────────────────

export const updateBarberProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  specialty: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  photo: z.string().url().max(2000).optional().or(z.literal('').optional()),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(100).optional(),
  instagram: z.string().max(100).optional(),
  facebook: z.string().max(100).optional(),
  tiktok: z.string().max(100).optional(),
  website: z.string().url().max(2000).optional().or(z.literal('').optional()),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only').optional(),
})

// ─── Barber Schedule (weekly recurring) ─────────────────────────────────────

export const updateScheduleSchema = z.object({
  schedules: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    isOff: z.boolean().optional(),
    breaks: z.array(z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })).optional(),
  })),
})

// ─── Availability Override (date-specific) ─────────────────────────────────

export const createAvailabilityOverrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  isAvailable: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  breaks: z.array(z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  reason: z.string().max(200).optional(),
})

// ─── Barber Service (price/duration override) ──────────────────────────────

export const updateBarberServiceSchema = z.object({
  serviceId: z.string().min(1),
  priceOverride: z.number().min(0).max(10000).nullable().optional(),
  durationOverride: z.number().int().min(5).max(480).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// ─── Appointment Status Transitions ────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  COMPLETED: [], // terminal
  CANCELLED: [], // terminal
  NO_SHOW: [], // terminal
  RESCHEDULED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
}

export function isValidTransition(from: string, to: string): boolean {
  // Owner override is allowed via forceUpdate param — handled in route
  const allowed = VALID_TRANSITIONS[from] || []
  return allowed.includes(to)
}

export function isTerminalStatus(status: string): boolean {
  return ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status)
}

// ─── Onboarding: Booking Settings ─────────────────────────────────────────
// Stored on the authenticated Business record. Payment-in-person is NOT a
// toggle here — there is no online payment processing; it is always the
// behaviour and surfaced to the owner as a fixed note in the UI.

/** Policy text: optional; '' clears to null (no hardcoded template text). */
const policySchema = z
  .string()
  .max(5000)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))

export const bookingSettingsSchema = z.object({
  walkInsWelcome: z.boolean().optional(),
  customerRescheduleEnabled: z.boolean().optional(),
  customerRescheduleMinNoticeHours: z.number().int().min(0).max(720).optional(),
  customerRescheduleWindowDays: z.number().int().min(1).max(3650).nullable().optional(),
  bookingPolicy: policySchema,
  cancellationPolicy: policySchema,
  latePolicy: policySchema,
  noShowPolicyText: policySchema,
})

// ─── Onboarding: Schedule (weekly hours) ──────────────────────────────────
// Reused by the Team step and the dashboard schedule editor.

export interface ScheduleBreak { start: string; end: string }
export interface ScheduleEntry {
  dayOfWeek: number // 0 = Sunday … 6 = Saturday
  isOff: boolean
  startTime: string // "HH:MM" 24h
  endTime: string   // "HH:MM" 24h
  breaks?: ScheduleBreak[]
}

/** "HH:MM" → minutes since midnight, for comparison. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * Validate a full week of schedule entries.
 * Rules:
 *   - Exactly 7 entries, one per day-of-week 0–6.
 *   - When not a day off: startTime < endTime.
 *   - Each break: start < end, within [startTime, endTime].
 *   - Breaks do not overlap.
 * Returns null when valid, or a human-readable error message.
 */
export function validateScheduleEntries(entries: ScheduleEntry[]): string | null {
  if (entries.length !== 7) return 'A full week (7 days) of hours is required'
  const seenDays = new Set<number>()
  for (const e of entries) {
    if (e.dayOfWeek < 0 || e.dayOfWeek > 6) return 'Invalid day of week'
    if (seenDays.has(e.dayOfWeek)) return 'Duplicate day in schedule'
    seenDays.add(e.dayOfWeek)
    if (e.isOff) continue
    const s = toMinutes(e.startTime)
    const en = toMinutes(e.endTime)
    if (s >= en) return `Working hours invalid: start must be before end`
    for (const b of e.breaks ?? []) {
      const bs = toMinutes(b.start)
      const be = toMinutes(b.end)
      if (bs >= be) return 'A break must start before it ends'
      if (bs < s || be > en) return 'A break falls outside working hours'
    }
    // overlap check
    const sorted = [...(e.breaks ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        return 'Breaks overlap — adjust the times'
      }
    }
  }
  return null
}

// ============================================================================
// PASSWORD POLICY — shared by owner registration, token-based reset, and the
// authenticated change-password flow. One policy everywhere.
// ============================================================================

export const passwordPolicySchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

export const passwordWithConfirmSchema = z
  .object({
    password: passwordPolicySchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

// ============================================================================
// OWNER EMAIL — normalized (trim + lowercase) before any lookup or insert so
// case variants cannot create duplicate accounts.
// ============================================================================

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
