// Prepares a local seeded database for E2E runs: sets the seeded OWNER to a
// known E2E password and clears the forced password change. Test-DB only.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
const prisma = new PrismaClient()

async function main() {
  const E2E_PASSWORD = 'E2eOwner!Passw0rd'
  const hash = await bcrypt.hash(E2E_PASSWORD, 12)
  const owners = await prisma.user.findMany({ where: { role: 'OWNER' } })
  for (const owner of owners) {
    await prisma.user.update({
      where: { id: owner.id },
      data: { mustChangePassword: false, passwordHash: hash },
    })
    console.log('e2e-ready owner:', owner.email, 'businessId:', owner.businessId)
  }
  const businesses = await prisma.business.findMany({ select: { id: true, slug: true, name: true, deactivatedAt: true } })
  console.log('businesses:', JSON.stringify(businesses))
}
main().finally(() => prisma.$disconnect())
