export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { contactFormSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getSmtpFromAddress } from '@/lib/app-config'
import { getFeatureConfig } from '@/lib/env-check'

export async function POST(req: NextRequest) {
  // Rate limit contact form — 3 per minute per IP
  const rateLimitResult = checkRateLimit(req, 'contact', RATE_LIMITS.CONTACT)
  if (rateLimitResult) {
    return NextResponse.json(
      { success: false, error: 'Too many messages. Please try again in a minute.' },
      { status: rateLimitResult.status }
    )
  }

  try {
    const body = await req.json()

    // Validate with Zod
    const parseResult = contactFormSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, email, message } = parseResult.data

    // Log without PII for production safety
    console.info('[Contact Form] New submission received')

    const emailConfig = getFeatureConfig('email')
    if (emailConfig.enabled && !emailConfig.configured) {
      return NextResponse.json(
        { success: false, error: `Email notifications are enabled but missing required configuration: ${emailConfig.missing.join(', ')}` },
        { status: 503 }
      )
    }

    // Contact submissions remain available when optional email is disabled.
    if (emailConfig.enabled) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: parseInt(process.env.SMTP_PORT || '587') === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        })

        await transporter.sendMail({
          from: getSmtpFromAddress(),
          to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
          subject: `New Contact Form Submission from ${name}`,
          text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        })
      } catch (emailErr) {
        console.error('Failed to send contact email:', emailErr)
        // Don't fail the user request if email sending fails
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error handling contact form:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to submit contact form' },
      { status: 500 }
    )
  }
}
