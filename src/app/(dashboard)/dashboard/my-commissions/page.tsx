import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getCommissionSettings } from '@/lib/commissions'
import { MyCommissionsClient } from './MyCommissionsClient'

/**
 * Barber self-view of commissions. Only meaningful when the owner has
 * BOTH enabled commissions and allowed the barber self-view — otherwise
 * the page renders a quiet "not available" state (the dashboard is
 * hidden, never an error to the barber).
 */
export default async function MyCommissionsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (user.role !== 'BARBER' || !user.businessId) redirect('/dashboard')

  const settings = await getCommissionSettings(user.businessId)
  const available = settings.enabled && settings.barberSelfViewEnabled

  return <MyCommissionsClient available={available} />
}
