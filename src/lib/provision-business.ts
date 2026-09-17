import bcrypt from 'bcryptjs'
import { Prisma, PrismaClient, UserRole } from '@prisma/client'

export type ProvisionBusinessInput = {
  business: {
    name: string
    slug: string
    email?: string | null
    phone?: string | null
    city?: string | null
    state?: string | null
    timezone?: string
    address?: string | null
    zipCode?: string | null
    hours?: Prisma.InputJsonValue
    primaryColor?: string
    accentColor?: string
    onboardingCompleted?: boolean
  }
  owner: { email: string; name: string; password: string }
  services: Array<{ name: string; description?: string; duration: number; price: number; order?: number }>
  barbers: Array<{ name: string; slug: string; specialty?: string; bio?: string; order?: number }>
  mode?: 'production' | 'demo'
}

export type ProvisionBusinessResult = {
  success: true
  businessId: string
  ownerId: string
  barberIds: string[]
  serviceIds: string[]
  counts: { barberCount: number; serviceCount: number; scheduleCount: number; relationshipCount: number }
}

const defaultHours = {
  monday: { open: '09:00', close: '18:00', isOff: false },
  tuesday: { open: '09:00', close: '18:00', isOff: false },
  wednesday: { open: '09:00', close: '18:00', isOff: false },
  thursday: { open: '09:00', close: '18:00', isOff: false },
  friday: { open: '09:00', close: '18:00', isOff: false },
  saturday: { open: '09:00', close: '16:00', isOff: false },
  sunday: { open: '10:00', close: '15:00', isOff: true },
}

export async function provisionBusiness(
  prisma: PrismaClient,
  input: ProvisionBusinessInput,
): Promise<ProvisionBusinessResult> {
  const passwordHash = await bcrypt.hash(input.owner.password, 10)

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.upsert({
      where: { slug: input.business.slug },
      create: {
        name: input.business.name,
        slug: input.business.slug,
        email: input.business.email,
        phone: input.business.phone,
        city: input.business.city,
        state: input.business.state,
        timezone: input.business.timezone ?? 'America/New_York',
        address: input.business.address,
        zipCode: input.business.zipCode,
        hours: input.business.hours ?? defaultHours,
        primaryColor: input.business.primaryColor ?? '#121212',
        accentColor: input.business.accentColor ?? '#d4af37',
        onboardingCompleted: input.business.onboardingCompleted ?? true,
        onboardingStep: 'done',
        onboardingCompletedAt: new Date(),
      },
      update: {},
    })

    const owner = await tx.user.upsert({
      where: { email: input.owner.email },
      create: {
        email: input.owner.email,
        passwordHash,
        name: input.owner.name,
        role: UserRole.OWNER,
        businessId: business.id,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      update: { businessId: business.id, role: UserRole.OWNER, name: input.owner.name },
    })

    const barbers = await Promise.all(input.barbers.map((barber) => tx.barber.upsert({
      where: { slug: barber.slug },
      create: { ...barber, businessId: business.id },
      update: {},
    })))

    const services = await Promise.all(input.services.map((service) =>
      tx.service.findFirst({ where: { businessId: business.id, name: service.name } }).then((existing) =>
        existing ?? tx.service.create({ data: { ...service, businessId: business.id } }),
      ),
    ))

    await tx.schedule.createMany({
      data: barbers.flatMap((barber) => Array.from({ length: 7 }, (_, dayOfWeek) => ({
        barberId: barber.id,
        dayOfWeek,
        startTime: dayOfWeek === 0 ? '10:00' : '09:00',
        endTime: dayOfWeek === 0 ? '15:00' : dayOfWeek === 6 ? '16:00' : '18:00',
        isOff: dayOfWeek === 0,
        breaks: dayOfWeek === 0 ? [] : [{ start: '12:00', end: '13:00' }],
      }))),
      skipDuplicates: true,
    })

    await tx.barberService.createMany({
      data: barbers.flatMap((barber) => services.map((service) => ({ barberId: barber.id, serviceId: service.id }))),
      skipDuplicates: true,
    })

    const [scheduleCount, relationshipCount] = await Promise.all([
      tx.schedule.count({ where: { barberId: { in: barbers.map(({ id }) => id) } } }),
      tx.barberService.count({ where: { barberId: { in: barbers.map(({ id }) => id) }, serviceId: { in: services.map(({ id }) => id) } } }),
    ])

    return {
      success: true,
      businessId: business.id,
      ownerId: owner.id,
      barberIds: barbers.map(({ id }) => id),
      serviceIds: services.map(({ id }) => id),
      counts: { barberCount: barbers.length, serviceCount: services.length, scheduleCount, relationshipCount },
    }
  }, { timeout: 30000 })
}

export async function verifyProvisionedBusiness(prisma: PrismaClient, businessId: string, expected: { ownerEmail: string; barberCount: number; serviceCount: number }) {
  const [business, owner, barberCount, serviceCount, scheduleCount, relationshipCount] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }),
    prisma.user.findFirst({ where: { businessId, email: expected.ownerEmail, role: UserRole.OWNER }, select: { id: true } }),
    prisma.barber.count({ where: { businessId } }),
    prisma.service.count({ where: { businessId } }),
    prisma.schedule.count({ where: { barber: { businessId } } }),
    prisma.barberService.count({ where: { barber: { businessId }, service: { businessId } } }),
  ])
  return {
    success: Boolean(business && owner && barberCount >= expected.barberCount && serviceCount >= expected.serviceCount && scheduleCount >= barberCount * 7 && relationshipCount >= barberCount * serviceCount),
    businessId,
    ownerId: owner?.id ?? null,
    barberCount,
    serviceCount,
    scheduleCount,
    relationshipCount,
  }
}
