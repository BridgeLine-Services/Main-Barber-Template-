import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/email-marketing'

// ============================================================================
// Email opt-out.
//
// GET does NOT change anything. Corporate mail scanners and link previews fetch
// every URL in a message before a human sees it, so a state-changing GET
// silently unsubscribes customers who never clicked. GET therefore renders the
// confirmation page and the change happens on POST — which also gives us the
// RFC 8058 one-click endpoint that mailbox providers call when the customer
// uses their own "unsubscribe" button.
//
// Existing links keep working: same URL, same signed token, one extra click for
// a human and none at all for a one-click provider.
// ============================================================================

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;line-height:1.6;max-width:34rem;margin:0 auto;color:#111">` +
      `<main><h1 style="font-size:1.5rem;margin-bottom:1rem">${title}</h1>${body}</main></body></html>`,
    { status, headers: HTML_HEADERS },
  )
}

function confirmPage(token: string, businessName: string | null) {
  const escaped = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const shop = businessName ? escapeHtml(businessName) : 'this business'
  return page(
    'Stop receiving promotional emails?',
    `<p>If you no longer want marketing emails from ${shop}, confirm below. Appointment confirmations and reminders are separate and are not affected.</p>` +
      `<form method="post" action="/unsubscribe" style="margin-top:1.5rem">` +
      `<input type="hidden" name="token" value="${escaped}">` +
      `<button type="submit" style="font:inherit;padding:0.7rem 1.2rem;border-radius:0.5rem;border:1px solid #111;background:#111;color:#fff;cursor:pointer">Unsubscribe me</button>` +
      `</form>` +
      `<p style="margin-top:1.5rem;font-size:0.875rem;color:#555">Changed your mind? Just close this page — nothing has been changed yet.</p>`,
  )
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function businessNameFor(businessId: string) {
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } })
    return business?.name ?? null
  } catch {
    return null
  }
}

/** Preview only: shows what will happen, changes nothing. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || ''
  const payload = token ? verifyUnsubscribeToken(token) : null
  if (!payload) {
    return page(
      'This unsubscribe link is invalid or expired',
      `<p>No changes were made. If you would like to stop receiving promotional emails, please contact the business directly and they can update your preferences.</p>`,
      400,
    )
  }
  return confirmPage(token, await businessNameFor(payload.businessId))
}

/** The actual change. Idempotent: repeating it is harmless. */
export async function POST(request: NextRequest) {
  let token = ''
  try {
    const form = await request.formData()
    const value = form.get('token')
    if (typeof value === 'string') token = value
  } catch {
    // A one-click provider may POST without a body; fall back to the query.
  }
  if (!token) token = request.nextUrl.searchParams.get('token') || ''

  const payload = token ? verifyUnsubscribeToken(token) : null
  if (!payload) {
    return page(
      'This unsubscribe link is invalid or expired',
      `<p>No changes were made. Please contact the business directly to update your email preferences.</p>`,
      400,
    )
  }

  // Scoped to this business as well as the customer, so a tampered payload
  // cannot touch another shop's records.
  await prisma.customer.updateMany({
    where: { id: payload.customerId, businessId: payload.businessId },
    data: { emailOptOut: true },
  })

  return page(
    'You have been unsubscribed',
    `<p>You will no longer receive promotional emails from this business. This took effect immediately.</p>` +
      `<p style="margin-top:1rem;color:#555;font-size:0.875rem">Appointment confirmations and reminders are not promotional, so you will still receive those.</p>`,
  )
}
