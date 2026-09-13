import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDailyOperationsSnapshot } from '@/lib/daily-operations'
import { getBusinessTimezone } from '@/lib/availability'
import { DailyOperationsClient } from './DailyOperationsClient'

export const dynamic = 'force-dynamic'

export default async function DailyOperationsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user as any
  if (user.role !== 'OWNER') {
    redirect('/dashboard')
  }
  const businessId = user.businessId
  if (!businessId) {
    redirect('/dashboard/onboarding')
  }

  // "Today" in the business's timezone, not the server's.
  let timezone = 'America/New_York'
  let todayStr: string
  try {
    timezone = await getBusinessTimezone(businessId)
  } catch {
    // fall through with default timezone — the snapshot call reports DB issues
  }
  todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  let snapshot: Awaited<ReturnType<typeof getDailyOperationsSnapshot>> | null = null
  let dbAvailable = true
  try {
    snapshot = await getDailyOperationsSnapshot(businessId, todayStr)
  } catch (error) {
    console.error('Failed to load daily operations snapshot:', error)
    dbAvailable = false
  }

  return (
    <DailyOperationsClient
      snapshot={snapshot}
      dbAvailable={dbAvailable}
      timezone={timezone}
    />
  )
}
