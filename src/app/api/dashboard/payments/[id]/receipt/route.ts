import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import nodemailer from 'nodemailer'
import { getSmtpFromAddress } from '@/lib/app-config'
import { prisma } from '@/lib/prisma'
import { buildReceipt, getPosSettings } from '@/lib/payments/pos'

/** GET receipt — staff can view; barbers only for their own payments. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null; barberId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const { id } = await params
    const payment = await prisma.payment.findFirst({ where: { id, businessId: user.businessId! } })
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (user.role === 'BARBER' && payment.barberId !== user.barberId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const receipt = await prisma.$transaction((tx) => buildReceipt(tx, id))
    return NextResponse.json({ receipt })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments/[id]/receipt')
  }
}

/** POST: email the receipt via the app's existing SMTP configuration. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null; barberId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.receiptsEmailEnabled) {
      return NextResponse.json({ error: 'Receipt emails are disabled in Payments settings' }, { status: 400 })
    }
    const payment = await prisma.payment.findFirst({ where: { id, businessId } })
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (user.role === 'BARBER' && payment.barberId !== user.barberId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!payment.customerId) return NextResponse.json({ error: 'Payment has no customer email on file' }, { status: 400 })

    const receipt = await prisma.$transaction((tx) => buildReceipt(tx, id))
    const customer = receipt.customer as { name?: string; email?: string | null } | null
    if (!customer?.email) return NextResponse.json({ error: 'Customer has no email on file' }, { status: 400 })

    const shop = receipt.shop as { name: string; phone?: string | null; address?: string | null }
    const lines = [
      `${shop.name} — Receipt`,
      shop.address ?? '',
      shop.phone ? `Phone: ${shop.phone}` : '',
      '',
      `Reference: ${receipt.reference}`,
      `Date: ${new Date(receipt.createdAt as string).toLocaleString()}`,
      `Customer: ${customer.name ?? ''}`,
      receipt.barber ? `Barber: ${(receipt.barber as { name: string }).name}` : '',
      '',
      ...(receipt.services as Array<{ name: string; amount: number }>).map((s) => `${s.name}: $${s.amount.toFixed(2)}`),
      ...(receipt.products as Array<{ name: string; amount: number }>).map((p) => `${p.name}: $${p.amount.toFixed(2)}`),
      (receipt.discount as number) > 0 ? `Discount: -$${(receipt.discount as number).toFixed(2)}` : '',
      `Subtotal: $${(receipt.subtotal as number).toFixed(2)}`,
      `Tax: $${(receipt.tax as number).toFixed(2)}`,
      `Tip: $${(receipt.tip as number).toFixed(2)}`,
      `Total: $${(receipt.total as number).toFixed(2)}`,
      `Paid by: ${receipt.paymentMethod}`,
    ].filter(Boolean)

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
    await transporter.sendMail({
      from: getSmtpFromAddress(),
      to: customer.email,
      subject: `Your receipt from ${shop.name} (${receipt.reference})`,
      text: lines.join('\n'),
    })
    return NextResponse.json({ sent: true, to: customer.email })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payments/[id]/receipt')
  }
}
