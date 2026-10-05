import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getGiftCardSettings } from '@/lib/gift-cards'
import { GiftCardsClient } from './GiftCardsClient'

/**
 * Owner-managed Gift Cards dashboard: enable/disable the shop's gift card
 * system, sell cards (POS), browse cards with their transaction history,
 * apply manual adjustments, and view the reporting summary (sold, redeemed,
 * outstanding liability).
 *
 * Gift cards integrate with the existing Payment ledger and POS checkout:
 * redemption happens at checkout via the gift card code; balances are
 * server-validated and race-safe. This is never a payment processor —
 * cards are issued by the shop itself.
 */
export default async function GiftCardsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!user.businessId || (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER' && user.role !== 'BUSINESS_ADMIN')) {
    redirect('/dashboard')
  }

  const settings = await getGiftCardSettings(user.businessId)

  return <GiftCardsClient enabled={settings.enabled} />
}
