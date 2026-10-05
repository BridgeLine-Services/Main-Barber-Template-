import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPayrollSettings } from '@/lib/payroll'
import { MyPayrollClient } from './MyPayrollClient'

/**
 * Barber self-view of their OWN payroll summaries. Only meaningful when
 * the owner has payroll reporting ON and granted barber self-view —
 * otherwise a quiet "not available" state (never an error). The barber
 * sees their own periods only; other barbers' wages/hours and shop
 * payroll totals are never exposed here.
 */
export default async function MyPayrollPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (user.role !== 'BARBER' || !user.barberId || !user.businessId) redirect('/dashboard')

  const settings = await getPayrollSettings(user.businessId)
  const available = settings.enabled && settings.barberSelfView

  return <MyPayrollClient available={available} />
}
