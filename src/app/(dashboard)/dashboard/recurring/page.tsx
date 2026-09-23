import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RecurringPageClient } from './RecurringPageClient'

export const dynamic = 'force-dynamic'

export default async function RecurringPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user as { id?: string; email?: string; role?: string; businessId?: string }
  const identityWhere = user.id ? { id: user.id } : user.email ? { email: user.email } : null
  const dbUser = identityWhere
    ? await prisma.user.findUnique({ where: identityWhere, select: { businessId: true, role: true } })
    : null
  const businessId = dbUser?.businessId || user.businessId
  if (!businessId) redirect('/dashboard/onboarding')

  const [barbers, services] = await Promise.all([
    prisma.barber.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.service.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, duration: true, price: true }, orderBy: { order: 'asc' } }),
  ])

  return <RecurringPageClient barbers={barbers} services={services} />
}
