import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManageTimeClock, getTimeClockSettings } from '@/lib/time-clock'
import { TimeClockClient } from './TimeClockClient'

/**
 * Owner-only Time Clock dashboard: live board (in / break / out), hours
 * reports with filters (barber, day, week, pay period), entry corrections
 * with an audit trail, and payroll-ready CSV export. Barbers and admins
 * are redirected — owner APIs enforce the same server-side.
 */
export default async function TimeClockPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!canManageTimeClock(user.role) || !user.businessId) redirect('/dashboard')

  const settings = await getTimeClockSettings(user.businessId)

  return <TimeClockClient enabled={settings.enabled} />
}
