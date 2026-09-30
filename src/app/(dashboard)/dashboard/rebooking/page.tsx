import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getRebookingTasks } from '@/lib/rebooking-engine'
import { getRetentionDashboardMetrics } from '@/lib/retention-dashboard'
import { RebookingDashboardClient } from './RebookingDashboardClient'
import type { RebookingTask as SerializedRebookingTask } from './RebookingDashboardClient'

export default async function RebookingDashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId

  let tasks: SerializedRebookingTask[] = []
  let metrics = null
  try {
    ;[tasks, metrics] = await Promise.all([
      getRebookingTasks(businessId).then(list =>
        list.map(t => ({
          ...t,
          lastVisit: t.lastVisit.toISOString(),
          predictedNextDate: t.predictedNextDate.toISOString(),
        }))
      ),
      getRetentionDashboardMetrics(businessId),
    ])
  } catch (error) {
    console.error('Failed to load retention dashboard:', error)
  }

  return <RebookingDashboardClient initialTasks={tasks} initialMetrics={metrics} />
}
