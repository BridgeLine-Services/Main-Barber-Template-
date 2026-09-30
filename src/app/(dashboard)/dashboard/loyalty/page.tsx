import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { LoyaltyClient } from './LoyaltyClient'
import type { Tier } from './LoyaltyClient'

export default async function LoyaltyPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId
  const userRole = user.role

  if (userRole !== 'OWNER') {
    redirect('/dashboard')
  }

  // Get current loyalty program
  let program: Awaited<ReturnType<typeof prisma.businessRewardProgram.findFirst>> = null
  try {
    program = await prisma.businessRewardProgram.findFirst({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
  } catch (error) {
    console.error('Failed to load loyalty program:', error)
  }

  return (
    <LoyaltyClient
      initialProgram={program ? {
        id: program.id,
        name: program.name,
        type: program.type,
        tiers: Array.isArray(program.config) ? (program.config as unknown as Tier[]) : [],
        pointsPerDollar: program.pointsPerDollar,
        isActive: program.isActive,
      } : null}
    />
  )
}
