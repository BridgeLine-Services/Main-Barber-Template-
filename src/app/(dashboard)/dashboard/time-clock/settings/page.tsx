import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManageTimeClock } from '@/lib/time-clock'
import { TimeClockSettingsClient } from './TimeClockSettingsClient'

/**
 * Owner-only Time Clock settings: the master switch (final authority),
 * configurable overtime rules, pay period definition, and per-barber
 * eligibility / team-view authorization. Enforced server-side on every API.
 */
export default async function TimeClockSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!canManageTimeClock(user.role) || !user.businessId) redirect('/dashboard')

  return <TimeClockSettingsClient />
}
