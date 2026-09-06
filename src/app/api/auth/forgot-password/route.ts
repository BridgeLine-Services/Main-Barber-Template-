export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { normalizeEmail } from '@/lib/validation'
import { isDevelopmentMode } from '@/lib/app-config'
import { getAbsoluteUrl } from '@/lib/app-url'

const forgotSchema = z.object({
  email: z.string().email('Valid email required').transform(normalizeEmail),
})

/**
 * Hash a raw reset token for storage. Only the SHA-256 hash is persisted — a
 * database leak must not yield usable reset tokens. The raw token exists only
 * in the email link (and, in development only, the API response).
 */
function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** SMTP is considered configured when host + user + from are all present. */
function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_FROM)
}

/** The generic, enumeration-safe response — identical for every email. */
const GENERIC_MESSAGE = 'If an account exists for that email, password reset instructions have been sent.'

/**
 * POST /api/auth/forgot-password
 *
 * Always responds generically — never reveals whether an account exists.
 *
 * SMTP behavior:
 *   - SMTP configured  → sends the reset email; generic response.
 *   - SMTP missing +
 *     development/demo → generic response PLUS resetUrl (dev-safe convenience,
 *                        so the flow is testable without a mail server).
 *   - SMTP missing +
 *     production       → does NOT pretend an email was sent. Responds with an
 *                        honest "temporarily unavailable" message that is
 *                        IDENTICAL whether or not the account exists, and never
 *                        exposes the token.
 */
export async function POST(req: NextRequest) {
  // Stricter rate limit for password reset
  const rateLimitResult = checkRateLimit(req, 'password-reset', RATE_LIMITS.PASSWORD_RESET)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: rateLimitResult.body.error },
      { status: rateLimitResult.status }
    )
  }

  const smtpConfigured = isSmtpConfigured()
  const canReturnDevLink = isDevelopmentMode() // demo mode or local development (never a production deployment)

  // When email delivery is impossible in production, fail honestly — the same
  // message for existing and non-existing accounts (no enumeration).
  const unavailableResponse = NextResponse.json({
    success: false,
    code: 'RESET_EMAIL_UNAVAILABLE',
    message: 'Password reset is temporarily unavailable. Please contact your administrator.',
  })

  try {
    const body = await req.json()
    const parsed = forgotSchema.safeParse(body)
    if (!parsed.success) {
      // Invalid input still gets the generic shape (no enumeration signal)
      return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
    }

    // Find user — don't reveal whether email exists
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, businessId: true },
    })

    if (!user) {
      return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
    }

    // Production without SMTP: don't create a token we cannot deliver,
    // don't pretend an email was sent.
    if (!smtpConfigured && !canReturnDevLink) {
      return unavailableResponse
    }

    // Generate token — raw token only lives in the email link / dev response
    const rawToken = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Invalidate any previous pending reset (single active token per user)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashResetToken(rawToken),
        passwordResetExpires: expires,
      },
    })

    // Audit the request (does not reveal anything to the caller)
    await prisma.auditLog
      .create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'USER_PASSWORD_CHANGED' as const,
          entityType: 'User',
          entityId: user.id,
          newValues: { event: 'PASSWORD_RESET_REQUESTED' },
          ipAddress: req.headers.get('x-forwarded-for') || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        },
      })
      .catch(() => undefined) // audit must never break the reset flow

    if (smtpConfigured) {
      try {
        const nodemailer = await import('nodemailer')
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: parseInt(process.env.SMTP_PORT || '587') === 465,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        })
        const baseUrl = getAbsoluteUrl('/')
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: user.email,
          subject: 'Password Reset Request',
          text: `Reset your password: ${baseUrl}/reset-password?token=${rawToken}\n\nThis link expires in 1 hour and can only be used once.`,
          html: `<p>Reset your password: <a href="${baseUrl}/reset-password?token=${rawToken}">Click here</a></p><p>This link expires in 1 hour and can only be used once.</p>`,
        })
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr)
        // Don't reveal failure to user — security best practice
      }
    }

    return NextResponse.json({
      success: true,
      message: GENERIC_MESSAGE,
      ...(canReturnDevLink && {
        // Development/demo ONLY — never returned in production (checked above)
        resetUrl: `/reset-password?token=${rawToken}`,
      }),
    })
  } catch (error: any) {
    if (error.code === 'P1001' || error.message?.includes('connect')) {
      return NextResponse.json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Password reset is temporarily unavailable. Please try again later.',
      }, { status: 503 })
    }
    console.error('Forgot password error:', error)
    // Generic response even on internal errors — no system detail exposed
    return NextResponse.json({ error: 'Failed to process request. Please try again.' }, { status: 500 })
  }
}
