import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canManageBusiness } from '@/lib/permissions'
import { BeforeAfterClient, type BeforeAfterPairItem, type Option, type MediaOption } from './BeforeAfterClient'

export const dynamic = 'force-dynamic'

import type { MediaType } from '@prisma/client'

const PAIRABLE_MEDIA_TYPES: MediaType[] = ['GALLERY', 'BARBER_PORTFOLIO', 'SERVICE_PHOTO', 'SHOP_PHOTO']

export default async function BeforeAfterPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  // Barbers only see pairs attributed to them (or unattributed) — same
  // scoping the API enforces on every write.
  const isBarber = user.role === 'BARBER'
  const pairWhere = {
    businessId: user.businessId,
    ...(isBarber && user.barberId
      ? { OR: [{ barberId: user.barberId }, { barberId: null }] }
      : {}),
  }

  let pairs: BeforeAfterPairItem[] = []
  let barbers: Option[] = []
  let services: Option[] = []
  let media: MediaOption[] = []

  try {
    const [rawPairs, rawBarbers, rawServices, rawMedia] = await Promise.all([
      prisma.beforeAfterPair.findMany({
        where: pairWhere,
        orderBy: { sortOrder: 'asc' },
        include: {
          beforeAsset: { select: { id: true, url: true, altText: true } },
          afterAsset: { select: { id: true, url: true, altText: true } },
          barber: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      }),
      prisma.barber.findMany({
        where: { businessId: user.businessId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.service.findMany({
        where: { businessId: user.businessId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.mediaAsset.findMany({
        where: { businessId: user.businessId, type: { in: PAIRABLE_MEDIA_TYPES } },
        select: { id: true, url: true, type: true, altText: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    pairs = rawPairs.map((p) => ({
      id: p.id,
      beforeAsset: p.beforeAsset,
      afterAsset: p.afterAsset,
      barberId: p.barberId,
      barberName: p.barber?.name ?? null,
      serviceId: p.serviceId,
      serviceName: p.service?.name ?? null,
      caption: p.caption,
      details: p.details,
      sortOrder: p.sortOrder,
      isPublished: p.isPublished,
    }))
    barbers = rawBarbers
    services = rawServices
    media = rawMedia
  } catch (error) {
    console.error('Failed to load before/after pairs:', error)
  }

  // Only owners/admins can publish, reorder, or delete; barbers can still
  // create/edit pairs attributed to themselves (the API enforces it too).
  const canManage = user.role === 'OWNER' || user.role === 'PLATFORM_OWNER' || user.role === 'BUSINESS_ADMIN'

  return (
    <BeforeAfterClient
      initialPairs={pairs}
      barbers={barbers}
      services={services}
      media={media}
      canManage={canManage}
    />
  )
}
