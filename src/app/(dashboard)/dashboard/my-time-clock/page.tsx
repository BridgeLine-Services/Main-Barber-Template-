import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getBarberAccess, getTimeClockSettings } from '@/lib/time-clock'
import { MyTimeClockClient } from './MyTimeClockClient'

/**
 * Barber self-service Time Clock: clock in/out, breaks, and own hours.
 * Only meaningful when the owner has the feature ON and this barber is
 * eligible — otherwise a quiet "not available" state (never an error).
 * The barber sees their own records only; other barbers' hours are
 * never exposed here.
 */
export default async function MyTimeClockPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (user.role !== 'BARBER' || !user.barberId || !user.businessId) redirect('/dashboard')

  const settings = await getTimeClockSettings(user.businessId)
  const access = await getBarberAccess(user.businessId, user.barberId)
  const available = settings.enabled && access.eligible

  return <MyTimeClockClient available={available} />
}
