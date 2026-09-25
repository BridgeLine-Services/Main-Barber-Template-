export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { slugify, validateSlug } from '@/lib/onboarding-constants'
import { FONT_FAMILY_VALUES, isValidHexColor } from '@/lib/theme'
import { bookingSettingsSchema } from '@/lib/validation'
import { checkOnboardingRequirements } from '@/lib/onboarding'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

// ─── Validation schemas ─────────────────────────────────────────────────────

/** Logo value: https URL, absolute path (uploaded asset), or empty to clear. */
const logoSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/.+/.test(v) || v.startsWith('/'), {
    message: 'Logo must be an https URL or an uploaded asset path',
  })
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))

const colorSchema = z
  .string()
  .trim()
  .refine(isValidHexColor, { message: 'Color must be a valid hex value like #d4af37' })

/** Optional/clearable color: '' or null clears the value (theme falls back). */
const optionalColorSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidHexColor(v), {
    message: 'Color must be a valid hex value like #d4af37',
  })
  .nullable()
  .optional()
  .transform((v) => (v === '' || v === null || v === undefined ? null : v))

const basicsSchema = {
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(100).optional(),
  slug: z.string().trim().min(2).max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only')
    .optional(),
  timezone: z.string().trim().min(3).max(64)
    .regex(/^[A-Za-z_\/+-]+$/, 'Invalid timezone')
    .optional(),
  phone: z.string().trim().min(7, 'Phone number is too short').max(30).optional(),
  email: z.string().trim().email('Invalid email address').max(255).optional(),
}

const brandingSchema = {
  logo: logoSchema,
  primaryColor: colorSchema.optional(),
  accentColor: colorSchema.optional(),
  secondaryColor: optionalColorSchema,
  themeMode: z.enum(['dark', 'light']).optional(),
  fontFamily: z
    .string()
    .trim()
    .refine((v) => v === '' || (FONT_FAMILY_VALUES as readonly string[]).includes(v), {
      message: 'Unsupported font family',
    })
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
}

const createSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(100),
  slug: z.string().trim().min(2).max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  timezone: z.string().trim().min(3).max(64).regex(/^[A-Za-z_\/+-]+$/, 'Invalid timezone'),
  phone: z.string().trim().min(7, 'Phone number is too short').max(30),
  email: z.string().trim().email('Invalid email address').max(255),
})

const patchSchema = z.object({
  ...basicsSchema,
  ...brandingSchema,
  // Booking Settings step — stored on the Business record.
  // NOTE: paymentInPerson is intentionally NOT a field here. There is no
  // online payment processing in this product; payment in person is the
  // fixed, default behaviour (Business.paymentInPerson stays true).
  ...bookingSettingsSchema.shape,
  // Advance the wizard through the persisted step order.
  step: z.enum(['branding', 'services', 'team', 'booking', 'review', 'done']).optional(),
})

/** Business fields the wizard works with. */
const businessSubset = {
  id: true,
  name: true,
  slug: true,
  timezone: true,
  phone: true,
  email: true,
  logo: true,
  primaryColor: true,
  accentColor: true,
  secondaryColor: true,
  themeMode: true,
  fontFamily: true,
  onboardingCompleted: true,
  onboardingStep: true,
  onboardingCompletedAt: true,
  // Booking Settings step (all stored on the Business record)
  walkInsWelcome: true,
  firstAvailableBookingEnabled: true,
  paymentInPerson: true,
  customerRescheduleEnabled: true,
  customerRescheduleMinNoticeHours: true,
  customerRescheduleWindowDays: true,
  bookingPolicy: true,
  cancellationPolicy: true,
  latePolicy: true,
  noShowPolicyText: true,
} as const

/**
 * GET /api/dashboard/onboarding
 * Returns the authenticated owner's onboarding state so the wizard can resume
 * exactly where they left off.
 *
 * Query: ?checkSlug=<slug> — also checks slug availability live.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const user = auth.user
    try {
      // Resolve from the DATABASE user record — the session token can be stale
      // (e.g. minted before this owner's business was created), so the claim
      // alone must not decide whether the business exists.
      const dbUser = await prisma.user.findUnique({
        where: user.id ? { id: user.id } : { email: user.email },
        select: { businessId: true },
      })
      const business = dbUser?.businessId
        ? await prisma.business.findUnique({ where: { id: dbUser.businessId }, select: businessSubset })
        : null
      // Optional live slug availability check
      let slugAvailable: boolean | undefined
      const checkSlug = req.nextUrl.searchParams.get('checkSlug')
      if (checkSlug !== null) {
        const slugError = validateSlug(checkSlug)
        if (slugError) {
          slugAvailable = false
        } else {
          const normalizedSlug = slugify(checkSlug)
          const conflict = await prisma.business.findUnique({ where: { slug: normalizedSlug } })
          // Own slug is always "available" for the same business.
          slugAvailable = !conflict || conflict.id === business?.id
        }
      }
      // Live completion-requirement counts (wizard displays these).
      let activeServices = 0
      let activeBarbers = 0
      if (business) {
        ;[activeServices, activeBarbers] = await Promise.all([
          prisma.service.count({ where: { businessId: business.id, isActive: true } }),
          prisma.barber.count({ where: { businessId: business.id, isActive: true } }),
        ])
      }
      return NextResponse.json({
        hasBusiness: !!business,
        business,
        slugAvailable,
        activeServices,
        activeBarbers,
      })
    } catch (error: any) {
      console.error('Onboarding GET error:', error)
      return NextResponse.json({ error: 'Failed to load onboarding state' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/onboarding')
  }
}

/**
 * POST /api/dashboard/onboarding
 * Creates a business for the authenticated owner and links it to their
 * account. Only works if the owner doesn't already have a business linked.
 * Onboarding is NOT completed here — the wizard continues to branding.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const user = auth.user
    try {
      // Check the DATABASE user record — the session claim can be stale
      // (minted before a business existed), which would allow duplicate creates.
      const dbUser = await prisma.user.findUnique({
        where: user.id ? { id: user.id } : { email: user.email },
        select: { businessId: true },
      })
      if (dbUser?.businessId) {
        return NextResponse.json({ error: 'Your shop is already set up' }, { status: 409 })
      }
      const body = await req.json().catch(() => null)
      const parsed = createSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: parsed.error.flatten() },
          { status: 400 }
        )
      }
      const d = parsed.data
      // Normalize + validate the slug the same way the client does
      const slug = slugify(d.slug)
      const slugError = validateSlug(slug)
      if (slugError) {
        return NextResponse.json({ error: slugError }, { status: 400 })
      }
      // Check slug uniqueness
      const existingSlug = await prisma.business.findUnique({ where: { slug } })
      if (existingSlug) {
        return NextResponse.json({ error: 'That URL slug is already taken' }, { status: 409 })
      }
      // Create business + link to existing owner user.
      // Branding starts at template defaults (public site fallback styling);
      // the owner customizes them in the branding step.
      const business = await prisma.business.create({
        data: {
          name: d.businessName,
          slug,
          phone: d.phone,
          email: d.email,
          timezone: d.timezone,
          primaryColor: '#1a1a1a',
          accentColor: '#d4af37',
          secondaryColor: '#2a2a2a',
          themeMode: 'dark',
          hours: {
            monday: { open: '09:00', close: '18:00', isOff: false },
            tuesday: { open: '09:00', close: '18:00', isOff: false },
            wednesday: { open: '09:00', close: '18:00', isOff: false },
            thursday: { open: '09:00', close: '18:00', isOff: false },
            friday: { open: '09:00', close: '18:00', isOff: false },
            saturday: { open: '09:00', close: '16:00', isOff: false },
            sunday: { open: '10:00', close: '15:00', isOff: true },
          },
          aboutText: `Welcome to ${d.businessName}! Update this text in Settings to tell customers about your shop.`,
          bookingPolicy: 'Appointments can be booked online up to 30 days in advance. No deposit required. Payment is collected in person after your service.',
          cancellationPolicy: 'Cancellations or modifications must be made at least 2 hours in advance of your scheduled slot.',
          // Onboarding continues at the branding step; NOT completed yet.
          onboardingCompleted: false,
          onboardingStep: 'branding',
          users: {
            connect: { id: user.id },
          },
        },
        select: businessSubset,
      })
      return NextResponse.json(
        {
          success: true,
          business,
          message: 'Business basics saved',
        },
        { status: 201 }
      )
    } catch (error: any) {
      console.error('Onboarding error:', error)
      if (error?.code === 'P1001' || error?.code === 'P1017') {
        return NextResponse.json(
          { error: 'Onboarding service is temporarily unavailable. Please try again later.' },
          { status: 503 }
        )
      }
      if (error?.code === 'P2002') {
        return NextResponse.json({ error: 'That URL slug is already taken' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Setup failed' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/onboarding')
  }
}

/**
 * PATCH /api/dashboard/onboarding
 * Updates the authenticated owner's OWN business (basics and/or branding)
 * and advances the onboarding step.
 *
 * Tenant safety: the business is resolved from the DATABASE user record —
 * never from the request body — so an owner can only ever modify the
 * business linked to their own account.
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      // Resolve the user from the DB — the businessId there is authoritative
      // (never trust the session claim alone for the update target).
      const dbUser = await prisma.user.findUnique({
        where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
        select: { id: true, businessId: true },
      })
      if (!dbUser?.businessId) {
        return NextResponse.json({ error: 'No business to update' }, { status: 409 })
      }
      const body = await req.json()
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: parsed.error.flatten() },
          { status: 400 }
        )
      }
      const d = parsed.data
      // Slug change → validate + uniqueness (excluding own business)
      if (d.slug !== undefined) {
        const slug = slugify(d.slug)
        const slugError = validateSlug(slug)
        if (slugError) {
          return NextResponse.json({ error: slugError }, { status: 400 })
        }
        const conflict = await prisma.business.findFirst({
          where: { slug, id: { not: dbUser.businessId } },
        })
        if (conflict) {
          return NextResponse.json({ error: 'That URL slug is already taken' }, { status: 409 })
        }
        d.slug = slug
      }
      // Step transition: 'done' completes onboarding. Completion flags are
      // set in the SAME update so the returned business object reflects the
      // final state.
      const completing = d.step === 'done'
      if (completing) {
        // Onboarding cannot finish without a bookable shop. The authoritative
        // requirement list lives in checkOnboardingRequirements() — shared with
        // the Review step so the UI and this gate can never disagree.
        const requirements = await checkOnboardingRequirements(dbUser.businessId!)
        if (!requirements.ok) {
          return NextResponse.json(
            {
              error: 'Before finishing setup, complete the missing requirements listed on the review page.',
              code: 'ONBOARDING_REQUIREMENTS_MISSING',
              missing: requirements.missing,
            },
            { status: 400 }
          )
        }
      }
      const business = await prisma.business.update({
        where: { id: dbUser.businessId },
        data: {
          ...(d.walkInsWelcome !== undefined && { walkInsWelcome: d.walkInsWelcome }),
          ...(d.firstAvailableBookingEnabled !== undefined && { firstAvailableBookingEnabled: d.firstAvailableBookingEnabled }),
          ...(d.customerRescheduleEnabled !== undefined && { customerRescheduleEnabled: d.customerRescheduleEnabled }),
          ...(d.customerRescheduleMinNoticeHours !== undefined && { customerRescheduleMinNoticeHours: d.customerRescheduleMinNoticeHours }),
          ...(d.customerRescheduleWindowDays !== undefined && { customerRescheduleWindowDays: d.customerRescheduleWindowDays }),
          ...(d.bookingPolicy !== undefined && { bookingPolicy: d.bookingPolicy }),
          ...(d.cancellationPolicy !== undefined && { cancellationPolicy: d.cancellationPolicy }),
          ...(d.latePolicy !== undefined && { latePolicy: d.latePolicy }),
          ...(d.noShowPolicyText !== undefined && { noShowPolicyText: d.noShowPolicyText }),
          ...(completing && {
            onboardingCompleted: true,
            onboardingCompletedAt: new Date(),
          }),
          ...(d.businessName !== undefined && { name: d.businessName }),
          ...(d.slug !== undefined && { slug: d.slug }),
          ...(d.timezone !== undefined && { timezone: d.timezone }),
          ...(d.phone !== undefined && { phone: d.phone }),
          ...(d.email !== undefined && { email: d.email }),
          ...(d.logo !== undefined && { logo: d.logo }),
          ...(d.primaryColor !== undefined && { primaryColor: d.primaryColor }),
          ...(d.accentColor !== undefined && { accentColor: d.accentColor }),
          ...(d.secondaryColor !== undefined && d.secondaryColor !== null && { secondaryColor: d.secondaryColor }),
          ...(d.secondaryColor === null && { secondaryColor: null }),
          ...(d.themeMode !== undefined && { themeMode: d.themeMode }),
          ...(d.fontFamily !== undefined && { fontFamily: d.fontFamily }),
          // Persist the wizard step whenever provided — the wizard advances
          // through branding → services → team → booking → done, and the owner
          // must resume exactly where they left off on return.
          ...(d.step && { onboardingStep: d.step }),
        },
        select: businessSubset,
      })
      return NextResponse.json({
        success: true,
        business,
        message: completing ? 'Onboarding complete' : 'Saved',
      })
    } catch (error: any) {
      console.error('Onboarding PATCH error:', error)
      return NextResponse.json({ error: 'Update failed. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/onboarding')
  }
}
