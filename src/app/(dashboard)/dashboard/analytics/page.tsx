import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getAnalytics } from '@/lib/analytics'
import { canManageBusiness } from '@/lib/permissions'
import { AnalyticsClient } from './AnalyticsClient'

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  let initialData = null
  try {
    initialData = await getAnalytics(user.businessId, 30)
  } catch (error) {
    console.error('Failed to load analytics:', error)
  }

  return <AnalyticsClient initialData={initialData} />
}
