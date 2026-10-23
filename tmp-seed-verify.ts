import { prisma } from './src/lib/prisma'
import bcrypt from 'bcryptjs'

async function main() {
  const stamp = `${Date.now()}`.slice(-6)
  const slug = `verify-shop-${Date.now()}`
  const b = await prisma.business.create({
    data: {
      name: 'Verification Barbers', slug, timezone: 'America/Los_Angeles',
      onboardingCompleted: true, onboardingStep: 'done', onboardingCompletedAt: new Date(),
      themeMode: 'dark',
      websiteContent: { create: {} },
    },
  })
  const owner = await prisma.user.create({
    data: {
      email: `verify-owner-${stamp}@test.local`, name: 'Very Long Verification Owner Name', role: 'OWNER',
      businessId: b.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  await prisma.user.create({
    data: {
      email: `verify-barber-${stamp}@test.local`, name: 'Rick the Barber', role: 'BARBER',
      businessId: b.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  await prisma.service.create({
    data: { businessId: b.id, name: 'Classic Cut', duration: 30, price: 35, isActive: true, description: 'Sharp cut' },
  })
  console.log(JSON.stringify({ slug, email: owner.email, id: b.id }))
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1) })
