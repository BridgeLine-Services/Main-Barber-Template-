'use server'

// Platform console server actions — every action re-verifies the caller
// is a PLATFORM_OWNER directly from the database. UI hiding is never the
// security boundary; a non-platform caller is redirected out.

import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'

async function requirePlatformUser(): Promise<{ id: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const su = session.user as { id?: string; email?: string }
  const dbUser = await prisma.user.findUnique({
    where: su.id ? { id: su.id } : su.email ? { email: su.email } : undefined,
    select: { id: true, role: true },
  })
  if (!dbUser || dbUser.role !== 'PLATFORM_OWNER') redirect('/login')
  return { id: dbUser.id }
}

export async function deactivateBusiness(businessId: string): Promise<void> {
  await requirePlatformUser()
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, deactivatedAt: true } })
  if (!business || business.deactivatedAt) return
  await prisma.business.update({ where: { id: businessId }, data: { deactivatedAt: new Date() } })
  await logAudit({
    businessId,
    action: 'BUSINESS_DEACTIVATED',
    entityType: 'Business',
    entityId: businessId,
    newValues: { by: 'PLATFORM_OWNER', name: business.name },
  })
  revalidatePath('/platform')
}

export async function reactivateBusiness(businessId: string): Promise<void> {
  await requirePlatformUser()
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, deactivatedAt: true } })
  if (!business || !business.deactivatedAt) return
  await prisma.business.update({ where: { id: businessId }, data: { deactivatedAt: null } })
  await logAudit({
    businessId,
    action: 'BUSINESS_REACTIVATED',
    entityType: 'Business',
    entityId: businessId,
    newValues: { by: 'PLATFORM_OWNER', name: business.name },
  })
  revalidatePath('/platform')
}

export interface CreateBusinessState {
  error?: string
  tempPassword?: string
  businessName?: string
}

export async function createBusiness(
  _prev: CreateBusinessState,
  formData: FormData
): Promise<CreateBusinessState> {
  const platformUser = await requirePlatformUser()

  const name = String(formData.get('name') || '').trim()
  const slug = String(formData.get('slug') || '').trim().toLowerCase()
  const ownerEmail = String(formData.get('ownerEmail') || '').trim().toLowerCase()
  const ownerName = String(formData.get('ownerName') || '').trim()

  if (!name || !slug || !ownerEmail || !ownerName) {
    return { error: 'All fields are required.' }
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { error: 'Slug may only contain lowercase letters, digits, and hyphens.' }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
    return { error: 'A valid owner email is required.' }
  }

  const [slugTaken, emailTaken] = await Promise.all([
    prisma.business.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } }),
  ])
  if (slugTaken) return { error: 'That slug is already in use.' }
  if (emailTaken) return { error: 'A user with that email already exists.' }

  const tempPassword = `BL-${crypto.randomUUID().slice(0, 8).toUpperCase()}!`
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  const business = await prisma.business.create({
    data: {
      name,
      slug,
      timezone: 'America/Los_Angeles',
      users: {
        create: { email: ownerEmail, name: ownerName, role: 'OWNER', passwordHash, mustChangePassword: true },
      },
    },
    select: { id: true },
  })

  await logAudit({
    userId: platformUser.id,
    businessId: business.id,
    action: 'PLATFORM_BUSINESS_CREATED',
    entityType: 'Business',
    entityId: business.id,
    newValues: { name, slug, ownerEmail },
  })

  revalidatePath('/platform')
  return { tempPassword, businessName: name }
}
