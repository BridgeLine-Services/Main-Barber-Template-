import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/email-marketing'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const payload = token ? verifyUnsubscribeToken(token) : null
  if (payload) {
    await prisma.customer.updateMany({
      where: { id: payload.customerId, businessId: payload.businessId },
      data: { emailOptOut: true },
    })
  }
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5"><main><h1>Email preferences updated</h1><p>${payload ? 'You will no longer receive promotional emails from this business. This change is effective immediately.' : 'This unsubscribe link is invalid or expired. No changes were made.'}</p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
