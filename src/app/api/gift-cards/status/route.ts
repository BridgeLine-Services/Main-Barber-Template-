/**
 * Public gift card status lookup for the website purchase flow.
 *
 * The customer paid online and holds the card code already (returned by the
 * purchase route after payment confirmation). This endpoint lets the success
 * screen poll until the Stripe webhook activates the card. It returns ONLY
 * `{ status }` — never the code, balance, or any card details — so an id
 * alone (an unguessable cuid, but treat it as guessable anyway) leaks
 * nothing usable.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { resolvePublicBusiness } from '@/lib/tenant'
import { getGiftCardStatus } from '@/lib/gift-cards'

export async function GET(request: Request) {
  try {
    const business = await resolvePublicBusiness()
    if (!business) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id || id.length > 64) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const status = await getGiftCardStatus(business.id, id)
    if (!status) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ status })
  } catch (error) {
    return handleApiError(error, 'GET /api/gift-cards/status')
  }
}
