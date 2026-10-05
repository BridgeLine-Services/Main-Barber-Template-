import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManageCommissions, getCommissionSettings } from '@/lib/commissions'
import { CommissionsClient } from './CommissionsClient'

/**
 * Owner-only commissions dashboard: master switch, rate rules, the
 * commission ledger and payout actions. Business admins and barbers are
 * redirected — shop-wide commission/financial reporting is OWNER ONLY
 * by default (also enforced server-side on every API).
 */
export default async function CommissionsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!canManageCommissions(user.role) || !user.businessId) redirect('/dashboard')

  // Server-side truth for the first paint: when the owner has disabled
  // commissions the live dashboards stay hidden (calculations stopped);
  // historical ledger rows remain intact and visible below.
  const settings = await getCommissionSettings(user.businessId)

  return <CommissionsClient initialEnabled={settings.enabled} />
}
